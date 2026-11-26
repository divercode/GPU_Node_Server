#!/usr/bin/env python3
"""认证、会话与 RBAC（标准库实现）。

生产/容器模式（AUTH_MODE=proxy）：
  网关（Nginx + oauth2-proxy + Dex）完成 OIDC 登录，向后端注入
  X-Auth-Request-User / X-Auth-Request-Groups / X-Portal-Proxy-Secret。
  后端只信任带共享密钥的代理请求，并在服务层做角色与对象级校验。

本地开发模式（AUTH_MODE=local）：
  后端提供 /login 表单，PBKDF2 校验本地账号，HMAC 签名会话 cookie。
  仅用于无 Docker / 无 Dex 环境下的功能验证。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
USERS_PATH = Path(os.environ.get("PORTAL_USERS_FILE", ROOT / "auth_users.json"))

SESSION_TTL_SECONDS = int(os.environ.get("PORTAL_SESSION_TTL_SECONDS", "28800"))
COOKIE_NAME = os.environ.get("PORTAL_SESSION_COOKIE", "portal_session")
CSRF_HEADER = "X-CSRF-Token"
PROXY_SECRET = os.environ.get("PORTAL_PROXY_SECRET", "")
AUTH_MODE = os.environ.get("AUTH_MODE", "proxy").lower()
LOCAL_MODE = AUTH_MODE == "local"

ROLE_ORDER = {"user": 1, "auditor": 2, "pi": 2, "ops": 3, "admin": 4}
ROLE_LABEL = {"admin": "平台管理员", "ops": "运维人员", "pi": "课题组负责人", "user": "普通用户", "auditor": "审计只读"}
NAV_ALLOWED = {
    "dashboard": {"admin", "ops", "pi", "user", "auditor"},
    "catalog": {"admin", "ops", "pi", "user"},
    "jobs": {"admin", "ops", "pi", "user"},
    "monitor": {"admin", "ops", "auditor"},
    "gpus": {"admin", "ops"},
    "alerts": {"admin", "ops"},
    "rules": {"admin", "ops"},
    "usage": {"admin", "ops", "pi", "user", "auditor"},
    "users": {"admin", "ops"},
    "audit": {"admin", "auditor"},
    "system": {"admin", "ops"},
}

_fail_lock = threading.Lock()
_failures: dict[str, list[float]] = {}
MAX_FAILURES = int(os.environ.get("PORTAL_MAX_LOGIN_FAILURES", "5"))
FAILURE_WINDOW = int(os.environ.get("PORTAL_LOGIN_WINDOW_SECONDS", "600"))


class AuthError(Exception):
    def __init__(self, code: str, status: int, message: str):
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def load_users() -> dict[str, dict]:
    if not USERS_PATH.is_file():
        return {}
    data = json.loads(USERS_PATH.read_text("utf-8"))
    users = {}
    for user in data.get("users", []):
        users[user["username"].lower()] = user
    return users


USER_CACHE = load_users()


def find_user(username: str = "", email: str = "") -> dict | None:
    if username:
        user = USER_CACHE.get(username.lower())
        if user:
            return user
        # Dex 可能以邮箱作为 preferred_username / user 头。
        local = username.split("@", 1)[0].lower()
        if local in USER_CACHE:
            return USER_CACHE[local]
    if email:
        for user in USER_CACHE.values():
            if user.get("email", "").lower() == email.lower():
                return user
    return None


def roles_from_groups(groups: list[str]) -> list[str]:
    roles: set[str] = set()
    for group in groups:
        group = group.strip()
        if group == "hpc-admins":
            roles.add("admin")
        elif group == "hpc-ops":
            roles.add("ops")
        elif group == "hpc-finance":
            roles.add("auditor")
        elif group.startswith("hpc-pi-"):
            roles.add("pi")
        elif group == "hpc-users":
            roles.add("user")
    return sorted(roles, key=lambda r: ROLE_ORDER.get(r, 0), reverse=True)


def make_identity(username: str, groups: list[str], email: str = "", auth_mode: str = "proxy",
                  client_ip: str = "") -> dict:
    user = find_user(username=username, email=email) or {}
    display = user.get("display_name") or username.split("@", 1)[0]
    if not groups:
        groups = list(user.get("groups", []))
    roles = roles_from_groups(groups)
    primary = roles[0] if roles else ""
    return {
        "username": user.get("username") or username.split("@", 1)[0],
        "display_name": display,
        "email": email or user.get("email", ""),
        "groups": groups,
        "roles": roles,
        "primary_role": primary,
        "role_label": ROLE_LABEL.get(primary, "未授权"),
        "account": user.get("account", ""),
        "auth_mode": auth_mode,
        "client_ip": client_ip,
    }


def valid_ip(value: str) -> str:
    try:
        return str(ipaddress.ip_address(value.strip()))
    except Exception:
        return ""


def client_ip(headers, remote_addr: str, trust_forwarded: bool = False) -> str:
    """真实来源 IP。

    local 模式只信任 TCP 对端，忽略客户端可伪造的 X-Forwarded-For。
    proxy 模式仅在网关共享密钥已校验后调用，并优先使用 Nginx 覆盖写入的 X-Real-IP。
    """
    remote = valid_ip(remote_addr or "") or "unknown"
    if not trust_forwarded:
        return remote
    real = valid_ip(headers.get("X-Real-IP", ""))
    if real:
        return real
    forwarded = headers.get("X-Forwarded-For", "")
    # Nginx 追加的真实地址在最后；取最右侧合法地址，避免直接信任客户端伪造的第一个值。
    for part in reversed([p.strip() for p in forwarded.split(",") if p.strip()]):
        candidate = valid_ip(part)
        if candidate:
            return candidate
    return remote


def identity_from_proxy(headers, remote_addr: str = "") -> dict:
    expected = PROXY_SECRET
    supplied = headers.get("X-Portal-Proxy-Secret", "")
    if not expected or not hmac.compare_digest(expected, supplied):
        raise AuthError("AUTH_REQUIRED", 401, "未认证：请求未经受信任的网关")
    username = headers.get("X-Auth-Request-User", "").strip()
    email = headers.get("X-Auth-Request-Email", "").strip()
    groups_raw = headers.get("X-Auth-Request-Groups", "").strip()
    groups = [g.strip() for g in groups_raw.split(",") if g.strip()]
    if not username and not email:
        raise AuthError("AUTH_REQUIRED", 401, "未认证：缺少身份头")
    source_ip = client_ip(headers, remote_addr, trust_forwarded=True)
    identity = make_identity(username=username, groups=groups, email=email,
                             auth_mode="proxy", client_ip=source_ip)
    if not identity.get("roles"):
        raise AuthError("FORBIDDEN", 403, "无权限：未映射到平台角色")
    return identity


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, iterations, salt_b64, hash_b64 = encoded.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        salt = _b64d(salt_b64)
        expected = _b64d(hash_b64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def authenticate_local(username: str, password: str, client_key: str) -> dict:
    key = f"{client_key}|{username.lower()}"
    now = time.time()
    with _fail_lock:
        recent = [t for t in _failures.get(key, []) if now - t < FAILURE_WINDOW]
        _failures[key] = recent
        if len(recent) >= MAX_FAILURES:
            raise AuthError("RATE_LIMITED", 429, "登录失败次数过多，请 10 分钟后再试")
    user = find_user(username=username)
    if not user or not verify_password(password, user.get("password_pbkdf2", "")):
        with _fail_lock:
            _failures.setdefault(key, []).append(now)
        raise AuthError("AUTH_REQUIRED", 401, "用户名或密码错误")
    with _fail_lock:
        _failures.pop(key, None)
    return make_identity(username=user["username"], groups=list(user.get("groups", [])),
                         email=user.get("email", ""), auth_mode="local", client_ip=client_key)


def session_secret() -> bytes:
    secret = os.environ.get("PORTAL_SESSION_SECRET", "")
    if not secret:
        # 仅本地开发允许自动生成；容器内必须显式注入。
        secret = "dev-only-" + hashlib.sha256(str(ROOT).encode()).hexdigest()[:24]
    return secret.encode("utf-8")


def issue_session(identity: dict) -> str:
    payload = {
        "sub": identity["username"],
        "name": identity["display_name"],
        "email": identity.get("email", ""),
        "groups": identity.get("groups", []),
        "roles": identity.get("roles", []),
        "account": identity.get("account", ""),
        "iat": int(time.time()),
        "exp": int(time.time()) + SESSION_TTL_SECONDS,
        "jti": secrets.token_urlsafe(24),
        "csrf": secrets.token_urlsafe(24),
    }
    body = _b64e(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())
    sig = _b64e(hmac.new(session_secret(), body.encode(), hashlib.sha256).digest())
    return body + "." + sig


def read_session(cookie_value: str | None) -> dict | None:
    if not cookie_value or "." not in cookie_value:
        return None
    body, sig = cookie_value.rsplit(".", 1)
    expected = _b64e(hmac.new(session_secret(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_b64d(body))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < time.time():
        return None
    return {
        "username": payload["sub"],
        "display_name": payload.get("name", payload["sub"]),
        "email": payload.get("email", ""),
        "groups": payload.get("groups", []),
        "roles": payload.get("roles", []),
        "primary_role": (payload.get("roles") or ["user"])[0],
        "role_label": ROLE_LABEL.get((payload.get("roles") or ["user"])[0], "普通用户"),
        "account": payload.get("account", ""),
        "auth_mode": "local",
        "jti": payload.get("jti", ""),
        "csrf": payload.get("csrf", ""),
    }


def parse_cookies(header: str | None) -> dict[str, str]:
    cookies = {}
    for part in (header or "").split(";"):
        if "=" in part:
            key, value = part.split("=", 1)
            cookies[key.strip()] = value.strip()
    return cookies


def client_key(headers, remote_addr: str) -> str:
    """兼容旧调用；安全逻辑统一走 client_ip()，禁止直接信任 X-Forwarded-For。"""
    return client_ip(headers, remote_addr, trust_forwarded=False)


def has_role(identity: dict, *roles: str) -> bool:
    return bool(set(identity.get("roles", [])) & set(roles))


def require_roles(identity: dict, *roles: str):
    if not has_role(identity, *roles):
        raise AuthError("FORBIDDEN", 403, "无权限访问该资源")
