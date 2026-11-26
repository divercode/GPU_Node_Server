#!/usr/bin/env python3
"""星轨算力 · 平台后端（零依赖，容器优先）

入口：
  生产：Nginx(8080) → oauth2-proxy/Dex OIDC → 本服务（仅内网，/api/v1）
  开发：AUTH_MODE=local 时本服务可直接在 8080 提供登录页、SPA 静态文件和 API。

安全边界（对照设计说明书 §5.3 / §9.3 / §13.2）：
  - 生产模式只信任带 X-Portal-Proxy-Secret 的网关请求；
  - 身份头 X-Auth-Request-User / X-Auth-Request-Groups 由 oauth2-proxy 注入；
  - RBAC 在后端服务层完成，前端不参与授权；
  - 标准响应 {code, message, data, request_id}，错误码见 §9.6。
"""
from __future__ import annotations

import argparse
import hmac
import json
import mimetypes
import os
import re
import secrets
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

try:
    from ldap3 import Connection, Server, SUBTREE
except Exception:  # LDAP 可选依赖；不可用时用户目录降级为空
    Connection = Server = SUBTREE = None

import auth as A
from store import Store

ROOT = Path(__file__).resolve().parent
FRONTEND = Path(os.environ.get("PORTAL_FRONTEND_DIR", ROOT.parent / "frontend"))
CONFIG_PATH = Path(os.environ.get("PORTAL_CONFIG_PATH", ROOT / "config.json"))
REAL_DATA = os.environ.get("PORTAL_REAL_DATA", "1").strip().lower() not in ("0", "false", "no")
COMMAND_DIR = Path(os.environ.get("PORTAL_COMMAND_DIR", "/app/portal-commands"))
IP_REGISTRY_PATH = Path(os.environ.get("PORTAL_IP_REGISTRY", "/app/ip_registry.json"))
IP_ALERTS_PATH = Path(os.environ.get("PORTAL_IP_ALERTS", "/app/ip_alerts.jsonl"))
STARTED = time.time()
LOCK = threading.Lock()
COLLECTOR_TOKEN = os.environ.get("PORTAL_COLLECTOR_TOKEN", "")
SECURE_COOKIE = os.environ.get("PORTAL_COOKIE_SECURE", "false").lower() == "true"
LDAP_URL = os.environ.get("PORTAL_LDAP_URL", "").strip()
LDAP_BIND_DN = os.environ.get("PORTAL_LDAP_BIND_DN", "").strip()
LDAP_BIND_PASSWORD = os.environ.get("PORTAL_LDAP_BIND_PASSWORD", "")
LDAP_BASE_DN = os.environ.get("PORTAL_LDAP_BASE_DN", "dc=hpc,dc=internal").strip()
LDAP_USER_CACHE: dict = {"at": 0.0, "rows": []}
CSRF_COOKIE = "starrail_csrf"
PUBLIC_PATHS = {"/healthz", "/api/health", "/api/v1/health", "/login", "/logout"}
STORE = Store()
TELEMETRY: dict[str, dict] = {}  # 仅内存降级使用


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


CONFIG = load_config()


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def server_names() -> list[str]:
    return [s["name"] for s in CONFIG["servers"]]


def _telemetry_fresh(payload: dict | None, max_age: float = 120.0) -> bool:
    """GPU 遥测只在 Agent 持续上报期间有效；过期数据不得当作实时数据展示。"""
    if not payload:
        return False
    ts = payload.get("ts")
    if not ts:
        return False
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds() <= max_age
    except Exception:
        return False


def collect_gpus() -> list[dict]:
    merged: list[dict] = []
    for srv in CONFIG["servers"]:
        name = srv["name"]
        latest = STORE.latest_telemetry(name)
        if not _telemetry_fresh(latest):
            latest = TELEMETRY.get(name)
        if not _telemetry_fresh(latest):
            continue
        if latest.get("gpus"):
            for g in latest["gpus"]:
                merged.append({
                    "server": name, "index": g.get("index"), "uuid": g.get("uuid", ""),
                    "model": CONFIG["gpu_model"], "temperature_c": g.get("temperature_c"),
                    "power_w": g.get("power_w"), "utilization_pct": g.get("utilization_pct"),
                    "memory_used_mb": g.get("memory_used_mb"), "memory_total_mb": g.get("memory_total_mb"),
                    "xid": g.get("xid"), "state": g.get("state", "allocated"),
                    "source": "agent", "updated_at": latest.get("ts", now_iso()),
                })
    return merged


def node_list(gpus: list[dict]) -> list[dict]:
    reported = {g["server"] for g in gpus}
    nodes = []
    for srv in CONFIG["servers"]:
        list_ = [g for g in gpus if g["server"] == srv["name"]]
        err = sum(1 for g in list_ if g.get("state") == "error")
        nodes.append({
            "name": srv["name"], "host": srv.get("host"), "gpus": len(list_),
            "error_gpus": err, "state": "degraded" if err else "online",
            "source": "agent" if srv["name"] in reported else "mock",
        })
    return nodes


def health_payload() -> dict:
    gpus = collect_gpus()
    reported = sorted({g["server"] for g in gpus})
    return {
        "status": "ok", "cluster": CONFIG["cluster"], "self_use": CONFIG.get("self_use", True),
        "gpu_count": len(gpus), "servers": server_names(), "reported_servers": reported,
        "telemetry_interval_seconds": CONFIG["telemetry"]["interval_seconds"],
        "auth_mode": A.AUTH_MODE, "persistence": STORE.status(),
        "uptime_seconds": round(time.time() - STARTED, 1), "time": now_iso(),
    }


JOBS = [
    {"id": 200101, "name": "llama3-8b-sft", "server": "gpu-01", "gpus": 4, "state": "running", "progress": 72, "owner": "zhangqm", "account": "智能计算组", "elapsed": 72000, "partition": "gpu"},
    {"id": 200102, "name": "qwen2-vl-finetune", "server": "gpu-01", "gpus": 3, "state": "running", "progress": 46, "owner": "shenyr", "account": "智能计算组", "elapsed": 81000, "partition": "gpu"},
    {"id": 200103, "name": "diffusion-xl-train", "server": "gpu-02", "gpus": 2, "state": "running", "progress": 88, "owner": "zhangqm", "account": "智能计算组", "elapsed": 50000, "partition": "gpu"},
    {"id": 200104, "name": "bert-bio-ner", "server": "gpu-02", "gpus": 2, "state": "running", "progress": 31, "owner": "shenyr", "account": "智能计算组", "elapsed": 56000, "partition": "gpu"},
    {"id": 200105, "name": "embedding-index", "server": "gpu-02", "gpus": 1, "state": "running", "progress": 64, "owner": "zhangqm", "account": "智能计算组", "elapsed": 84000, "partition": "gpu"},
    {"id": 200106, "name": "vllm-serving-bench", "server": "gpu-02", "gpus": 4, "state": "pending", "progress": 0, "owner": "linya", "account": "平台组", "elapsed": 0, "partition": "gpu"},
]
ALERTS = [
    {"id": "ALT-2401", "severity": "critical", "title": "GPU 掉卡 · XID 79", "server": "gpu-02", "state": "firing", "gpu": "GPU-01-00", "rule": "gpu_xid_fatal"},
    {"id": "ALT-2402", "severity": "critical", "title": "不可纠正 ECC (DBE)", "server": "gpu-01", "state": "acked", "gpu": "GPU-00-05", "rule": "gpu_ecc_dbe"},
    {"id": "ALT-2404", "severity": "warning", "title": "GPU 温度偏高", "server": "gpu-02", "state": "firing", "gpu": "GPU-01-01", "rule": "gpu_temp_high"},
    {"id": "ALT-2405", "severity": "warning", "title": "NVLink CRC 增长", "server": "gpu-02", "state": "firing", "gpu": "GPU-01-01", "rule": "nvlink_crc"},
]

AUDIT_EVENTS = [
    {"id": "AUD-98120", "action": "节点运维", "detail": "对 gpu-02 执行 drain", "object": "gpu-02", "actor": "陈砚舟", "role": "ops", "ip": "10.0.0.18", "mins": 3, "ok": True},
    {"id": "AUD-98121", "action": "资源调整", "detail": "调整 视觉感知组 的 GrpTRES 上限为 gres/gpu=8", "object": "account:vision", "actor": "林予安", "role": "admin", "ip": "10.0.0.10", "mins": 20, "ok": True},
    {"id": "AUD-98122", "action": "告警处置", "detail": "确认告警 ALT-2402 并创建工单 TK-8801", "object": "ALT-2402", "actor": "陈砚舟", "role": "ops", "ip": "10.0.0.18", "mins": 37, "ok": True},
    {"id": "AUD-98123", "action": "账户开通", "detail": "审批通过 uid=10042 的开户申请", "object": "uid:10042", "actor": "张启明", "role": "pi", "ip": "10.0.0.31", "mins": 54, "ok": True},
    {"id": "AUD-98124", "action": "审计导出", "detail": "导出 2026-11 审计摘要（哈希链）", "object": "audit:2026-11", "actor": "林予安", "role": "admin", "ip": "10.0.0.10", "mins": 71, "ok": True},
    {"id": "AUD-98125", "action": "作业操作", "detail": "取消作业 200104（用户申请）", "object": "job:200104", "actor": "陈砚舟", "role": "ops", "ip": "10.0.0.18", "mins": 88, "ok": True},
    {"id": "AUD-98126", "action": "版本变更", "detail": "OOD 4.2.1 升级窗口审批", "object": "ood:4.2.1", "actor": "林予安", "role": "admin", "ip": "10.0.0.10", "mins": 105, "ok": True},
    {"id": "AUD-98127", "action": "告警静默", "detail": "静默 node_down 规则 30 分钟", "object": "rule:node_down", "actor": "陈砚舟", "role": "ops", "ip": "10.0.0.18", "mins": 122, "ok": True},
    {"id": "AUD-98128", "action": "账户停用", "detail": "禁用 uid=10034 并撤销 SSO 会话", "object": "uid:10034", "actor": "林予安", "role": "admin", "ip": "10.0.0.10", "mins": 139, "ok": True},
    {"id": "AUD-98129", "action": "备份恢复", "detail": "执行 slurmdbd 恢复演练", "object": "db:slurmdbd", "actor": "陈砚舟", "role": "ops", "ip": "10.0.0.18", "mins": 156, "ok": False},
]

HEALTH_COMPONENTS = []

PROBE_HOST = os.environ.get("PORTAL_PROBE_HOST", "192.168.112.230")
SLURM_HOST = os.environ.get("PORTAL_SLURM_HOST", PROBE_HOST)
IDENTITY_MODE = os.environ.get("PORTAL_IDENTITY_MODE", "local").strip().lower()
GATEWAY_URL = os.environ.get("PORTAL_GATEWAY_URL", "http://192.168.112.230:8080").rstrip("/")
PROMETHEUS_BASE = os.environ.get("PORTAL_PROMETHEUS_URL", f"http://{PROBE_HOST}:9090").rstrip("/")
_PROBE_SSL = ssl._create_unverified_context()


def _probe_http(url: str, timeout: float = 1.5) -> tuple[bool, int, str]:
    """探测 HTTP 服务；401/302/404 也说明服务端口和 Web 容器已启动。"""
    started = time.perf_counter()
    try:
        req = urllib.request.Request(url, method="HEAD")
        try:
            resp = urllib.request.urlopen(req, timeout=timeout, context=_PROBE_SSL)
            code = int(getattr(resp, "status", 200))
        except urllib.error.HTTPError as exc:
            code = int(exc.code)
    except Exception as exc:
        return False, round((time.perf_counter() - started) * 1000), f"不可达：{type(exc).__name__}"
    latency = round((time.perf_counter() - started) * 1000)
    return code < 500, latency, f"HTTP {code}"


def _probe_tcp(host: str, port: int, timeout: float = 1.5) -> tuple[bool, int, str]:
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            pass
    except Exception as exc:
        return False, round((time.perf_counter() - started) * 1000), f"不可达：{type(exc).__name__}"
    latency = round((time.perf_counter() - started) * 1000)
    return True, latency, f"TCP {port} 可连接"


def _probe_prometheus_job(job: str, timeout: float = 2.0) -> tuple[bool, int, str]:
    """通过 Prometheus up 指标判断某个抓取目标最近一次是否健康。"""
    started = time.perf_counter()
    url = f"{PROMETHEUS_BASE}/api/v1/query?query={quote('up{job=\"' + job + '\"}')}"
    try:
        with urllib.request.urlopen(url, timeout=timeout, context=_PROBE_SSL) as resp:
            body = json.loads(resp.read().decode("utf-8", "replace"))
    except Exception as exc:
        return False, round((time.perf_counter() - started) * 1000), f"查询失败：{type(exc).__name__}"
    latency = round((time.perf_counter() - started) * 1000)
    results = ((body.get("data") or {}).get("result") or [])
    if not results:
        return False, latency, "Prometheus 无该目标 up 指标"
    try:
        value = float(results[0].get("value", [0, "0"])[1])
    except Exception:
        value = 0
    return value == 1, latency, "最近一次抓取成功" if value == 1 else "最近一次抓取失败"


def _component(name: str, role: str, ok: bool, latency: int, detail: str) -> dict:
    return {
        "name": name, "role": role,
        "status": "ok" if ok else "warn",
        "latency": latency, "uptime": "—" if ok else "—",
        "detail": detail,
    }


def current_health_components() -> list[dict]:
    """实时探测 OOD、FreeIPA、Prometheus/DCGM 三个外部组件。"""
    components = [dict(c) for c in HEALTH_COMPONENTS]

    store_status = STORE.status()
    pg_ok = store_status.get("postgres") == "ok"
    components.append(_component(
        "PostgreSQL", "持久层", pg_ok, 2 if pg_ok else 0,
        "SELECT 1 正常 · jobs / alerts / audit" if pg_ok else f"PostgreSQL · {store_status.get('postgres')}",
    ))
    redis_ok = store_status.get("redis") == "ok"
    components.append(_component(
        "Redis", "缓存与会话", redis_ok, 1 if redis_ok else 0,
        "PING 正常 · 遥测缓存" if redis_ok else f"Redis · {store_status.get('redis')}",
    ))

    if IDENTITY_MODE == "gateway":
        dex_ok, dex_ms, dex_detail = _probe_http(f"{GATEWAY_URL}/dex/auth")
        components.append(_component(
            "Dex", "OIDC 身份代理（中心网关）", dex_ok, dex_ms,
            "中心 A 网关 · /dex/auth 可达" if dex_ok else f"中心 A 网关 /dex/auth · {dex_detail}",
        ))
        proxy_ok, proxy_ms, proxy_detail = _probe_http(f"{GATEWAY_URL}/oauth2/sign_in")
        components.append(_component(
            "oauth2-proxy", "会话代理（中心网关）", proxy_ok, proxy_ms,
            "中心 A 网关 · /oauth2/sign_in 可达" if proxy_ok else f"中心 A 网关 /oauth2/sign_in · {proxy_detail}",
        ))
    else:
        dex_ok, dex_ms, dex_detail = _probe_tcp("dex", 5556)
        components.append(_component(
            "Dex", "OIDC 身份代理", dex_ok, dex_ms,
            "dex:5556 · OIDC 正常" if dex_ok else f"dex:5556 · {dex_detail}",
        ))
        proxy_ok, proxy_ms, proxy_detail = _probe_tcp("oauth2-proxy", 4180)
        components.append(_component(
            "oauth2-proxy", "会话代理", proxy_ok, proxy_ms,
            "oauth2-proxy:4180 · HTTP 入口" if proxy_ok else f"oauth2-proxy:4180 · {proxy_detail}",
        ))

    gpus = collect_gpus()
    if gpus:
        servers = sorted({g["server"] for g in gpus})
        components.append(_component(
            "GPU agent", "nvidia-smi 采集", True, 1,
            f"{len(gpus)} 卡已上报" + (f" · {' / '.join(servers)}" if servers else ""),
        ))
    else:
        components.append(_component(
            "GPU agent", "nvidia-smi 采集", False, 0,
            "最近没有 Agent 上报 GPU 指标",
        ))

    slurm_ok, slurm_ms, slurm_detail = _probe_tcp(SLURM_HOST, 6817)
    components.append(_component(
        "Slurm", "作业调度", slurm_ok, slurm_ms,
        "slurmctld :6817 · 21.08.5" if slurm_ok else f"slurmctld :6817 · {slurm_detail}",
    ))
    dbd_ok, dbd_ms, dbd_detail = _probe_tcp(SLURM_HOST, 6819)
    components.append(_component(
        "SlurmDBD", "作业账本", dbd_ok, dbd_ms,
        "slurmdbd :6819 · 作业账本正常" if dbd_ok else f"slurmdbd :6819 · {dbd_detail}",
    ))

    ood_ok, ood_ms, ood_detail = _probe_http(f"http://{PROBE_HOST}/")
    components.append(_component(
        "OOD", "Web 终端/应用", ood_ok, ood_ms,
        "Apache :80 · OIDC 已接入" if ood_ok else f"OOD :80 · {ood_detail}",
    ))

    ipa_ok, ipa_ms, ipa_detail = _probe_tcp(PROBE_HOST, 389)
    components.append(_component(
        "FreeIPA", "LDAP/CA/OTP", ipa_ok, ipa_ms,
        "LDAP :389 · 已接入" if ipa_ok else f"FreeIPA LDAP :389 · {ipa_detail}",
    ))

    prom_ok, prom_ms, prom_detail = _probe_http(f"http://{PROBE_HOST}:9090/-/healthy")
    components.append(_component(
        "DCGM Prometheus", "GPU 指标存储", prom_ok, prom_ms,
        "Prometheus :9090 · DCGM 指标已接入" if prom_ok else f"Prometheus :9090 · {prom_detail}",
    ))
    dcgm_ok, dcgm_ms, dcgm_detail = _probe_prometheus_job("dcgm")
    components.append(_component(
        "DCGM Exporter", "GPU 指标采集", dcgm_ok, dcgm_ms,
        f"Prometheus dcgm 目标 · {dcgm_detail}",
    ))

    am_ok, am_ms, am_detail = _probe_http(f"http://{PROBE_HOST}:9093/-/ready")
    components.append(_component(
        "Alertmanager", "告警路由", am_ok, am_ms,
        "Alertmanager :9093 · 就绪" if am_ok else f"Alertmanager :9093 · {am_detail}",
    ))
    return components


def _first(entry, attr: str) -> str:
    values = entry.entry_attributes_as_dict.get(attr) or []
    return str(values[0]) if values else ""


def _freeipa_user_rows() -> list[dict] | None:
    """Read-only FreeIPA user directory via LDAP."""
    if not LDAP_URL or not LDAP_BIND_DN or not LDAP_BIND_PASSWORD or Connection is None:
        return None
    now = time.time()
    if now - float(LDAP_USER_CACHE.get("at", 0)) < 10:
        return list(LDAP_USER_CACHE.get("rows") or [])
    parsed = urlparse(LDAP_URL)
    try:
        server = Server(
            parsed.hostname or "192.168.112.230",
            port=parsed.port or (636 if parsed.scheme == "ldaps" else 389),
            use_ssl=parsed.scheme == "ldaps",
            connect_timeout=2,
        )
        conn = Connection(
            server, user=LDAP_BIND_DN, password=LDAP_BIND_PASSWORD,
            auto_bind=True, receive_timeout=3, raise_exceptions=False,
        )
        conn.search(
            search_base="cn=users,cn=accounts," + LDAP_BASE_DN,
            search_filter="(&(objectClass=posixAccount)(uid=*))",
            search_scope=SUBTREE,
            attributes=["uid", "cn", "displayName", "mail", "nsAccountLock",
                         "memberOf", "uidNumber", "gidNumber"],
            size_limit=1000,
        )
        rows = []
        for entry in conn.entries:
            uid = _first(entry, "uid")
            if not uid or uid == "dex-bind":
                continue
            groups = []
            for dn in (entry.entry_attributes_as_dict.get("memberOf") or []):
                text = str(dn)
                # 只取普通组，忽略 FreeIPA 权限/角色等 PBAC 条目。
                if ",cn=groups,cn=accounts," not in text:
                    continue
                group = text.split(",", 1)[0]
                if group.startswith("cn="):
                    groups.append(group[3:])
            groups = sorted(set(groups))
            roles = A.roles_from_groups(groups)
            primary = roles[0] if roles else "user"
            locked = _first(entry, "nsAccountLock").lower() == "true"
            uid_number = _first(entry, "uidNumber")
            try:
                uid_int = int(uid_number)
            except ValueError:
                uid_int = 0
            display = _first(entry, "displayName") or _first(entry, "cn") or uid
            group_label = next((g for g in groups if g.startswith("hpc-") and g != "hpc-users"), "")
            if not group_label:
                group_label = "FreeIPA"
            rows.append({
                "username": uid,
                "uid": uid_int,
                "name": display,
                "display_name": display,
                "email": _first(entry, "mail"),
                "role": primary,
                "roles": roles,
                "role_label": A.ROLE_LABEL.get(primary, "普通用户"),
                "group": group_label,
                "account": group_label,
                "groups": groups,
                "status": "locked" if locked else "active",
                "quota": [0, 0],
                "last": 0,
                "source": "freeipa-ldap",
            })
        rows.sort(key=lambda r: (0 if r["role"] == "admin" else 1, r["username"]))
        LDAP_USER_CACHE["at"] = now
        LDAP_USER_CACHE["rows"] = list(rows)
        try:
            conn.unbind()
        except Exception:
            pass
        return rows
    except Exception as exc:
        print(f"[users] FreeIPA LDAP unavailable: {type(exc).__name__}: {exc}", flush=True)
        return None


def user_rows() -> list[dict]:
    if REAL_DATA:
        rows = _freeipa_user_rows()
        # LLM: read-only; account creation/disable/reset is done in FreeIPA.
        return rows or []
    default_quota = [(42, 200), (8, 120), (186, 600), (64, 200)]
    rows = []
    for idx, user in enumerate(A.USER_CACHE.values()):
        roles = A.roles_from_groups(list(user.get("groups", [])))
        primary = roles[0] if roles else "user"
        quota = default_quota[idx % len(default_quota)]
        rows.append({
            "username": user.get("username", ""),
            "uid": 10001 + idx,
            "name": user.get("display_name") or user.get("username", ""),
            "display_name": user.get("display_name") or user.get("username", ""),
            "email": user.get("email", ""),
            "role": primary,
            "roles": roles,
            "role_label": A.ROLE_LABEL.get(primary, primary),
            "group": user.get("account", ""),
            "account": user.get("account", ""),
            "status": "active",
            "quota": [quota[0], quota[1]],
            "last": 2 + idx * 6,
        })
    return rows


AUDIT_SEQ = 0


def record_audit(identity: dict, action: str, detail: str, obj: str, ok: bool = True,
                 request_id: str = "", user_agent: str = "", ip: str | None = None) -> dict:
    """审计写入 PostgreSQL 哈希链；无 DB 时降级到内存链。"""
    return STORE.append_audit(
        actor=identity.get("display_name") or identity.get("username", "—"),
        role=identity.get("primary_role", "user"),
        action=action,
        obj=obj,
        detail=detail,
        ok=bool(ok),
        ip=ip or identity.get("client_ip") or "unknown",
        user_agent=user_agent,
        request_id=request_id,
    )


def record_event(actor: str, role: str, action: str, detail: str, obj: str, ok: bool,
                 ip: str, request_id: str = "", user_agent: str = "") -> dict:
    return STORE.append_audit(actor=actor or "匿名", role=role or "anonymous", action=action,
                              obj=obj, detail=detail, ok=ok, ip=ip,
                              user_agent=user_agent, request_id=request_id)


def init_persistence():
    # 真实环境联调：不向数据库写入演示作业/告警；历史演示数据通过迁移清理。
    seeds = ([], [], []) if REAL_DATA else (JOBS, ALERTS, AUDIT_EVENTS)
    STORE.init(*seeds)
    JOBS[:] = STORE.load_jobs()
    ALERTS[:] = STORE.load_alerts()
    print(f"[persistence] real_data={REAL_DATA} {STORE.status()}")


def visible_jobs(identity: dict) -> list[dict]:
    if A.has_role(identity, "admin", "ops", "auditor"):
        jobs = JOBS
    else:
        jobs = [j for j in JOBS if j["owner"] == identity["username"]]
    return [serialize_job(j) for j in jobs]


def serialize_job(job: dict) -> dict:
    """补齐前端作业数据结构所需字段，保持向后兼容。"""
    user = A.find_user(username=job.get("owner", "")) or {}
    elapsed = int(job.get("elapsed", 0))
    started = job.get("started")
    now_ms = int(time.time() * 1000)
    terminal = {"completed", "failed", "cancelled", "timeout", "node_fail", "preempted", "out_of_memory"}
    exit_code = job.get("exitCode")
    if job.get("state") not in terminal:
        exit_code = None
    submitted_ms = int(job.get("submitted", 0) or 0)
    started_ms = int(started or 0)
    if job.get("wait") is not None:
        wait_minutes = int(job.get("wait") or 0)
    elif submitted_ms > 0:
        wait_minutes = max(0, round(((started_ms or now_ms) - submitted_ms) / 60000))
    else:
        wait_minutes = 0
    return {
        **job,
        "user": user.get("display_name") or job.get("owner", ""),
        "user_display": user.get("display_name") or job.get("owner", ""),
        "username": job.get("owner", ""),
        "uid": user.get("uid", 0),
        "account": job.get("account", user.get("account", "")),
        "accountId": job.get("account", user.get("account", "")),
        "nodes": int(job.get("nodes", 1)),
        "qos": job.get("qos", "normal"),
        "image": job.get("image") or "",
        "wait": wait_minutes,
        "submitted": job.get("submitted", now_ms - elapsed * 1000),
        "started": started if started is not None else (now_ms - elapsed * 1000 if job.get("state") == "running" else None),
        "priority": int(job["priority"]) if job.get("priority") is not None else None,
        "exitCode": exit_code,
    }


def serialize_alert(alert: dict, index: int = 0) -> dict:
    time_ms = int(alert.get("time") or 0)
    if alert.get("mins") is not None:
        mins = int(alert.get("mins") or 0)
    elif time_ms > 0:
        mins = max(0, round((time.time() * 1000 - time_ms) / 60000))
    else:
        mins = 0
    return {
        **alert,
        "sev": alert.get("severity", "info"),
        "node": alert.get("server", ""),
        "jobId": alert.get("jobId"),
        "desc": alert.get("desc") or alert.get("title", ""),
        "mins": mins,
        "time": time_ms,
    }


def catalog_payload() -> list[dict]:
    return [{
        "id": "gpu", "name": "gpu", "model": CONFIG["gpu_model"],
        "nodes": len(CONFIG["servers"]), "gpus": sum(int(s["gpus"]) for s in CONFIG["servers"]),
        "desc": "训练 / 微调 / 推理（单台 GPU 服务器）", "queue_p95_minutes": None, "self_use": True,
    }]


def usage_payload(identity: dict, scope: str) -> dict:
    allowed_global = A.has_role(identity, "admin", "ops", "auditor")
    if scope == "global" and not allowed_global:
        raise A.AuthError("FORBIDDEN", 403, "仅管理员/运维/审计可查看全局用量")

    if REAL_DATA:
        # 真实环境：以 Slurm agent 上报的作业 elapsed/gpus 汇总 GPU·h。
        # 当前作业 + 已归档作业历史，避免作业从 scontrol 消失后用量归零。
        from datetime import date, timedelta, datetime
        cutoff_ms = (datetime.now() - timedelta(days=30)).timestamp() * 1000
        current_ids = {str(j.get("id")) for j in JOBS}
        history = [h for h in STORE.load_job_history() if str(h.get("id")) not in current_ids]
        jobs = [j for j in (list(JOBS) + history)
                if int(j.get("elapsed", 0) or 0) > 0
                and (int(j.get("submitted", 0) or 0) <= 0 or int(j.get("submitted", 0) or 0) >= cutoff_ms)]
        if scope != "global":
            jobs = [j for j in jobs if j.get("owner") == identity.get("username")]
        colors = ["#22d3ee", "#818cf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6"]
        account_map: dict[str, dict] = {}
        for j in jobs:
            name = j.get("account") or "platform"
            rec = account_map.setdefault(name, {
                "id": name, "name": name, "pi": "", "members": 0,
                "model": CONFIG.get("gpu_model", "GPU"), "quota": [0, 0],
                "gpu_hours": 0.0, "color": colors[len(account_map) % len(colors)],
                "usage": 0,
            })
            rec["gpu_hours"] += float(j.get("gpus", 0) or 0) * float(j.get("elapsed", 0) or 0) / 3600.0
        accounts = list(account_map.values())
        labels = []
        day_keys = []
        today = date.today()
        for i in range(29, -1, -1):
            d = today - timedelta(days=i)
            labels.append(f"{d.month}/{d.day}")
            day_keys.append(d.isoformat())
        series = []
        for rec in accounts:
            values = [0.0] * 30
            for j in jobs:
                if (j.get("account") or "platform") != rec["id"]:
                    continue
                submitted = int(j.get("submitted", 0) or 0)
                if submitted:
                    from datetime import datetime
                    try:
                        key = datetime.fromtimestamp(submitted / 1000).date().isoformat()
                        idx = day_keys.index(key)
                    except Exception:
                        idx = 29
                else:
                    idx = 29
                values[idx] += float(j.get("gpus", 0) or 0) * float(j.get("elapsed", 0) or 0) / 3600.0
            series.append({"id": rec["id"], "name": rec["name"], "color": rec["color"],
                           "values": [round(v, 3) for v in values]})
        total = round(sum(rec["gpu_hours"] for rec in accounts), 3)
        for rec in accounts:
            rec["gpu_hours"] = round(rec["gpu_hours"], 3)
        return {
            "scope": "global" if scope == "global" else ("self" if scope == "self" else "group"),
            "range": "30d", "gpu_hours": total,
            "accounts": accounts, "labels": labels, "series": series,
        }

    all_accounts = [
        {"id": "air", "name": "智能计算组", "gpu_hours": 681, "color": "#22d3ee"},
        {"id": "vision", "name": "视觉感知组", "gpu_hours": 670, "color": "#818cf8"},
        {"id": "nlp", "name": "语言智能组", "gpu_hours": 380, "color": "#a78bfa"},
        {"id": "ops", "name": "运维组", "gpu_hours": 703, "color": "#34d399"},
    ]
    if scope == "global" and allowed_global:
        selected = all_accounts
        effective = "global"
    elif scope == "group":
        selected = [a for a in all_accounts if a["name"] == identity.get("account")] or [all_accounts[0]]
        effective = "group"
    else:
        selected = [a for a in all_accounts if a["name"] == identity.get("account")] or [all_accounts[0]]
        effective = "self"

    if REAL_DATA:
        # 真实环境：Slurm/DCGM 未接入时没有真实 GPU·h 数据，返回空序列。
        return {
            "scope": effective, "range": "30d", "gpu_hours": 0,
            "accounts": [], "labels": [], "series": [],
        }

    labels = []
    from datetime import datetime, timedelta
    for i in range(29, -1, -1):
        d = datetime.now() - timedelta(days=i)
        labels.append(f"{d.month}/{d.day}")
    series = []
    for idx, account in enumerate(selected):
        base = max(4, round(account["gpu_hours"] / 30))
        values = [max(0, base + ((i * (idx + 3) + idx * 7) % 9) - 4) for i in range(30)]
        # 让 30 天序列合计与账户 GPU·h 对齐，避免图表合计与顶部 KPI 不一致。
        values[-1] = max(0, values[-1] + account["gpu_hours"] - sum(values))
        series.append({"id": account["id"], "name": account["name"], "color": account["color"], "values": values})
    total = sum(account["gpu_hours"] for account in selected)
    return {
        "scope": effective,
        "range": "30d",
        "gpu_hours": total,
        "accounts": selected,
        "labels": labels,
        "series": series,
    }


def json_bytes(payload) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


LOGIN_PAGE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>登录 · 星轨算力</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 20% 0%,#0e2440,#070b14 60%);color:#e2e8f0;font:14px/1.6 system-ui,"Segoe UI","Microsoft YaHei",sans-serif}
.card{width:min(92vw,400px);padding:30px;border:1px solid rgba(148,163,184,.25);border-radius:20px;background:rgba(15,23,42,.82);box-shadow:0 30px 80px rgba(0,0,0,.5);backdrop-filter:blur(14px)}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.logo{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,#22d3ee,#6366f1 60%,#a855f7);font-weight:800;color:#06121f}
h1{font-size:19px;margin:0 0 2px}p{color:#94a3b8;margin:0 0 20px}
label{display:block;font-size:12px;color:#94a3b8;margin:12px 0 6px}
input{width:100%;padding:11px 13px;border-radius:10px;border:1px solid rgba(148,163,184,.3);background:#0b1220;color:#e2e8f0;outline:none}
input:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.12)}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:10px;background:linear-gradient(135deg,#22d3ee,#6366f1);color:#fff;font-weight:700;font-size:14px;cursor:pointer}
button:hover{filter:brightness(1.08)}.err{padding:10px 12px;border-radius:9px;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.35);color:#fca5a5;font-size:12px;margin-bottom:12px}
.foot{margin-top:18px;font-size:11px;color:#64748b;text-align:center}.foot b{color:#94a3b8}
</style></head><body><form class="card" method="post" action="/login">
<div class="brand"><div class="logo">星</div><div><h1>星轨算力</h1><p style="margin:0">GPU Console · 内部自用平台</p></div></div>
{error}
<input type="hidden" name="next" value="{next}"/>
<label for="u">用户名</label><input id="u" name="username" autocomplete="username" required autofocus/>
<label for="p">密码</label><input id="p" name="password" type="password" autocomplete="current-password" required/>
<button type="submit">登录平台</button>
<div class="foot">身份认证：<b>OIDC / Dex</b> · 会话 2h/8h · 仅限内网访问</div>
</form></body></html>"""


def login_page(next_url: str = "/", error: str = "") -> bytes:
    err_html = f'<div class="err">{error}</div>' if error else ""
    page = LOGIN_PAGE.replace("{error}", err_html).replace("{next}", quote(next_url, safe=""))
    return page.encode("utf-8")


def safe_next(value: str) -> str:
    if value and value.startswith("/") and not value.startswith("//"):
        return value
    return "/"


class Handler(BaseHTTPRequestHandler):
    server_version = "StarRailPortal/0.3"
    protocol_version = "HTTP/1.1"

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError, OSError):
            # 客户端提前断开（SSE / 页面切换）不记录服务器异常。
            pass
        except ValueError as exc:
            if "closed file" in str(exc):
                pass
            else:
                raise

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    # ---------- response helpers ----------
    def _request_id(self) -> str:
        return getattr(self, "_rid", None) or self.headers.get("X-Request-Id") or uuid.uuid4().hex

    def _base_headers(self, content_type="application/json; charset=utf-8"):
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Request-Id", self._request_id())

    def _json(self, payload, status=HTTPStatus.OK):
        body = json_bytes(payload)
        self.send_response(status)
        self._base_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _envelope(self, data, status=HTTPStatus.OK, code="OK", message="ok", extra_headers=None):
        self.send_response(status)
        self._base_headers()
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        body = json_bytes({"code": code, "message": message, "data": data, "request_id": self._request_id()})
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, err: A.AuthError):
        headers = {}
        if err.status == 401:
            headers["WWW-Authenticate"] = 'OIDC realm="starrail"'
        self._envelope(None, status=err.status, code=err.code, message=err.message, extra_headers=headers)

    def _redirect(self, location, status=HTTPStatus.FOUND, cookie=None):
        self.send_response(status)
        self._base_headers("text/plain; charset=utf-8")
        self.send_header("Location", location)
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _cookie(self, value: str, max_age: int = A.SESSION_TTL_SECONDS) -> str:
        parts = [f"{A.COOKIE_NAME}={value}", "Path=/", "HttpOnly", "SameSite=Lax", f"Max-Age={max_age}"]
        if SECURE_COOKIE:
            parts.append("Secure")
        return "; ".join(parts)

    # ---------- identity ----------
    def _client_ip(self, trust_forwarded=False) -> str:
        return A.client_ip(self.headers, self.client_address[0], trust_forwarded=trust_forwarded)

    def _identity(self, optional=False):
        try:
            if A.LOCAL_MODE:
                cookie = A.parse_cookies(self.headers.get("Cookie")).get(A.COOKIE_NAME)
                identity = A.read_session(cookie)
                if not identity:
                    raise A.AuthError("AUTH_REQUIRED", 401, "未认证或会话已过期")
                if not STORE.session_valid(identity.get("jti", "")):
                    raise A.AuthError("AUTH_REQUIRED", 401, "会话已撤销或过期")
                identity["client_ip"] = self._client_ip(trust_forwarded=False)
                return identity
            return A.identity_from_proxy(self.headers, self.client_address[0])
        except A.AuthError as exc:
            if optional:
                return None
            self._error(exc)
            return None

    def _drain_body(self) -> None:
        """Consume a rejected POST body so keep-alive cannot poison the next request."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except (TypeError, ValueError):
            return
        if length > 0:
            try:
                self.rfile.read(min(length, 1024 * 1024))
            except Exception:
                pass

    def _api_rate_limited(self, identity: dict, method: str) -> bool:
        limit = 120 if method == "GET" else 20
        if not STORE.rate_hit(f"api:{identity.get('username','anonymous')}:{method}", limit, 1):
            self._drain_body()
            self._envelope(None, status=429, code="RATE_LIMITED", message="请求过于频繁，请稍后再试")
            return True
        return False

    def _stream(self, identity: dict, path: str):
        """SSE 快照流；前端收到 snapshot 后拉取一次 REST 快照。"""
        self.close_connection = True
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            while True:
                payload = {
                    "time": now_iso(),
                    "cluster": CONFIG.get("cluster", ""),
                    "gpus": collect_gpus(),
                    "nodes": node_list(collect_gpus()),
                    "alerts": [serialize_alert(a, i) for i, a in enumerate(ALERTS)]
                    if A.has_role(identity, "admin", "ops", "auditor") else [],
                    "jobs": visible_jobs(identity),
                }
                data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                self.wfile.write(f"event: snapshot\ndata: {data}\n\n".encode("utf-8"))
                self.wfile.flush()
                time.sleep(3)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.close_connection = True

    def _require_csrf(self, identity: dict) -> bool:
        supplied = self.headers.get(A.CSRF_HEADER, "")
        cookie = A.parse_cookies(self.headers.get("Cookie")).get(CSRF_COOKIE, "")
        if not supplied or not cookie or not hmac.compare_digest(supplied, cookie):
            self._drain_body()
            self._envelope(None, status=403, code="FORBIDDEN", message="CSRF 校验失败")
            return False
        origin = self.headers.get("Origin", "")
        host = self.headers.get("Host", "")
        if origin and host and urlparse(origin).netloc != host:
            self._drain_body()
            self._envelope(None, status=403, code="FORBIDDEN", message="跨站写请求被拒绝")
            return False
        return True

    # ---------- HTTP methods ----------
    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self._base_headers()
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        self._rid = self.headers.get("X-Request-Id") or uuid.uuid4().hex
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/healthz":
            return self._envelope({"status": "ok", "time": now_iso()})
        if path == "/api/health":
            return self._json({"status": "ok", "time": now_iso()})
        if path == "/api/v1/health":
            return self._envelope({**health_payload(), "authenticated": self._identity(optional=True) is not None})
        if path == "/login":
            if not A.LOCAL_MODE:
                return self._redirect("/")
            if self._identity(optional=True):
                return self._redirect("/")
            return self._html(login_page(safe_next(parse_qs(parsed.query).get("next", ["/"])[0])))
        if path == "/logout":
            if A.LOCAL_MODE:
                token = A.parse_cookies(self.headers.get("Cookie")).get(A.COOKIE_NAME)
                parsed = A.read_session(token)
                if parsed:
                    STORE.revoke_session(parsed.get("jti", ""))
                return self._redirect("/login", cookie=self._cookie("", 0))
            return self._redirect("/oauth2/sign_out?rd=/")

        # 静态资源：生产由网关托管；local 模式由后端托管并受登录保护。
        if not path.startswith("/api/"):
            return self._static_or_login(path, parsed.query)

        identity = self._identity()
        if identity is None:
            return None
        if path in ("/api/v1/stream/events", "/api/v1/stream/gpus"):
            return self._stream(identity, path)
        if self._api_rate_limited(identity, "GET"):
            return None
        if path == "/api/v1/me":
            csrf = A.parse_cookies(self.headers.get("Cookie")).get(CSRF_COOKIE, "") or secrets.token_urlsafe(24)
            identity = {**identity, "csrf": csrf}
            cookie = f"{CSRF_COOKIE}={csrf}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800"
            if SECURE_COOKIE:
                cookie += "; Secure"
            return self._envelope(identity, extra_headers={"Set-Cookie": cookie})
        if path in ("/api/v1/cluster", "/api/cluster"):
            return self._envelope({**CONFIG, "gpu_total": len(collect_gpus()), "catalog": catalog_payload()})
        if path == "/api/v1/catalog":
            return self._envelope(catalog_payload())
        if path == "/api/v1/nodes":
            try:
                A.require_roles(identity, "admin", "ops", "auditor")
            except A.AuthError as exc:
                return self._error(exc)
            return self._envelope({"nodes": node_list(collect_gpus()), "time": now_iso()})
        if path == "/api/v1/gpus":
            try:
                A.require_roles(identity, "admin", "ops", "auditor")
            except A.AuthError as exc:
                return self._error(exc)
            return self._envelope({"gpus": collect_gpus(), "time": now_iso()})
        if path == "/api/v1/jobs":
            return self._envelope({"jobs": visible_jobs(identity), "time": now_iso()})
        if path.startswith("/api/v1/jobs/submissions/"):
            request_id = path.rsplit("/", 1)[-1]
            if not re.fullmatch(r"[0-9a-f]{16,64}", request_id):
                return self._envelope(None, status=400, code="INVALID_REQUEST_ID", message="提交请求 ID 无效")
            result_file = COMMAND_DIR / f"result-{request_id}.json"
            try:
                payload = json.loads(result_file.read_text(encoding="utf-8"))
            except FileNotFoundError:
                return self._envelope(None, status=404, code="SUBMISSION_PENDING", message="Slurm 提交结果尚未生成")
            except Exception as exc:
                return self._envelope(None, status=500, code="SUBMISSION_RESULT_ERROR", message=str(exc))
            try:
                result_file.unlink()
            except OSError:
                pass
            return self._envelope(payload)
        if path.startswith("/api/v1/jobs/"):
            job_id = path.rsplit("/", 1)[-1]
            job = next((j for j in JOBS if str(j["id"]) == job_id), None)
            if not job:
                return self._envelope(None, status=404, code="NOT_FOUND", message="作业不存在")
            if not A.has_role(identity, "admin", "ops", "auditor") and job["owner"] != identity["username"]:
                return self._envelope(None, status=403, code="OBJECT_SCOPE_DENIED", message="超出本人数据范围")
            return self._envelope(serialize_job(job))
        if path == "/api/v1/alerts":
            try:
                A.require_roles(identity, "admin", "ops", "auditor")
            except A.AuthError as exc:
                return self._error(exc)
            return self._envelope({"alerts": [serialize_alert(a, i) for i, a in enumerate(ALERTS)], "time": now_iso()})
        if path == "/api/v1/rules":
            try:
                A.require_roles(identity, "admin", "ops", "auditor")
            except A.AuthError as exc:
                return self._error(exc)
            try:
                req = urllib.request.Request(PROMETHEUS_BASE + "/api/v1/rules?type=alert")
                with urllib.request.urlopen(req, timeout=3) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                groups = ((payload.get("data") or {}).get("groups") or [])
                rows = []
                for group in groups:
                    for rule in group.get("rules") or []:
                        if rule.get("type") != "alerting":
                            continue
                        labels = rule.get("labels") or {}
                        annotations = rule.get("annotations") or {}
                        rows.append({
                            "id": f"{group.get('name', 'rules')}/{rule.get('name', 'rule')}",
                            "name": rule.get("name", "Prometheus Rule"),
                            "expr": rule.get("query", ""),
                            "sev": labels.get("severity", "warning"),
                            "dur": f"{int(rule.get('duration') or 0)}s",
                            "on": rule.get("health") != "err",
                            "ver": rule.get("health", "ok"),
                            "updated": str(rule.get("lastEvaluation") or "")[:19].replace("T", " "),
                            "group": group.get("name", ""),
                            "file": group.get("file", ""),
                            "description": annotations.get("description") or annotations.get("summary") or "",
                            "state": rule.get("state", "inactive"),
                        })
                return self._envelope({"rules": rows, "time": now_iso(), "source": "prometheus"})
            except Exception as exc:
                return self._envelope(None, status=503, code="PROMETHEUS_UNAVAILABLE",
                                      message=f"Prometheus 规则不可用：{exc}")
        if path == "/api/v1/trend":
            try:
                A.require_roles(identity, "admin", "ops", "auditor")
            except A.AuthError as exc:
                return self._error(exc)
            range_key = (parse_qs(parsed.query).get("range") or ["24h"])[0]
            if range_key not in ("1h", "24h", "7d"):
                return self._envelope(None, status=400, code="INVALID_RANGE", message="时间范围仅支持 1h / 24h / 7d")
            seconds = {"1h": 3600, "24h": 86400, "7d": 604800}[range_key]
            step = {"1h": 60, "24h": 300, "7d": 1800}[range_key]
            end = int(time.time())
            start = end - seconds
            def query_range(expression: str):
                from urllib.parse import urlencode as _urlencode
                url = PROMETHEUS_BASE + "/api/v1/query_range?" + _urlencode({
                    "query": expression, "start": start, "end": end, "step": step,
                })
                with urllib.request.urlopen(url, timeout=3) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                result = ((payload.get("data") or {}).get("result") or [])
                if not result:
                    return []
                values = result[0].get("values") or []
                return [(int(float(ts)) * 1000, float(value)) for ts, value in values]
            try:
                util_values = query_range("avg(DCGM_FI_DEV_GPU_UTIL)")
                temp_values = query_range("avg(DCGM_FI_DEV_GPU_TEMP)")
            except Exception as exc:
                return self._envelope(None, status=503, code="PROMETHEUS_UNAVAILABLE",
                                      message=f"Prometheus 趋势数据不可用：{exc}")
            labels = []
            for ts, _ in util_values:
                labels.append(datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                              .astimezone(timezone(timedelta(hours=8))).strftime("%H:%M" if range_key != "7d" else "%m-%d"))
            util_lookup = dict(util_values)
            temp_lookup = dict(temp_values)
            points = []
            for ts in sorted(util_lookup):
                points.append({
                    "ts": ts,
                    "util": round(util_lookup.get(ts, 0)),
                    "temp": round(temp_lookup.get(ts, 0)),
                })
            return self._envelope({
                "range": range_key, "labels": labels, "points": points,
                "source": "prometheus", "time": now_iso(),
            })
        if path == "/api/v1/usage":
            scope = parse_qs(parsed.query).get("scope", ["self"])[0]
            try:
                return self._envelope(usage_payload(identity, scope))
            except A.AuthError as exc:
                return self._error(exc)
        if path == "/api/v1/users":
            try:
                A.require_roles(identity, "admin", "ops")
            except A.AuthError as exc:
                return self._error(exc)
            return self._envelope({"users": user_rows(), "time": now_iso()})
        if path == "/api/v1/audit":
            try:
                A.require_roles(identity, "admin", "ops", "auditor")
            except A.AuthError as exc:
                return self._error(exc)
            try:
                limit = int(parse_qs(parsed.query).get("limit", ["200"])[0])
            except ValueError:
                limit = 200
            events = STORE.list_audit(limit)
            if REAL_DATA:
                events = [e for e in events if e.get("request_id") != "seed"]
            return self._envelope({"events": events, "time": now_iso()})
        if path == "/api/v1/audit/verify":
            try:
                A.require_roles(identity, "admin", "ops", "auditor")
            except A.AuthError as exc:
                return self._error(exc)
            return self._envelope(STORE.verify_audit_chain())
        if path == "/api/v1/system/status":
            try:
                A.require_roles(identity, "admin", "ops")
            except A.AuthError as exc:
                return self._error(exc)
            components = current_health_components()
            healthy = sum(1 for c in components if c["status"] != "warn")
            return self._envelope({
                "status": "ok", "components": components,
                "healthy": healthy, "total": len(components), "time": now_iso(),
            })
        if path == "/api/v1/system/ip-status":
            try:
                A.require_roles(identity, "admin", "ops")
            except A.AuthError as exc:
                return self._error(exc)
            registry, alerts = {}, []
            try:
                registry = json.loads(IP_REGISTRY_PATH.read_text(encoding="utf-8"))
            except Exception:
                registry = {}
            try:
                lines = IP_ALERTS_PATH.read_text(encoding="utf-8").splitlines()[-10:]
                alerts = [json.loads(line) for line in lines if line.strip()]
            except Exception:
                alerts = []
            return self._envelope({"registry": registry, "alerts": alerts, "time": now_iso()})
        if path == "/api/v1/sync/status":
            try:
                A.require_roles(identity, "admin", "ops")
            except A.AuthError as exc:
                return self._error(exc)
            return self._envelope({"ldap": "ok", "last_sync": now_iso(), "diff": 0})
        return self._envelope(None, status=404, code="NOT_FOUND", message="接口不存在")

    def do_POST(self):
        self._rid = self.headers.get("X-Request-Id") or uuid.uuid4().hex
        path = urlparse(self.path).path
        if path in ("/login",):
            return self._login_post()
        if path in ("/api/ingest", "/api/v1/collector/ingest"):
            return self._ingest()
        if path == "/api/v1/alerts/webhook":
            return self._alert_webhook()
        identity = self._identity()
        if identity is None:
            return None
        if self._api_rate_limited(identity, "POST"):
            return None
        if path == "/api/v1/jobs":
            if not self._require_csrf(identity):
                return None
            try:
                length = min(int(self.headers.get("Content-Length", "0")), 64 * 1024)
            except ValueError:
                length = 0
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, TypeError):
                return self._envelope(None, status=400, code="INVALID_JSON", message="作业参数不是有效 JSON")
            name = str(body.get("name") or "").strip()[:128] or "portal-job"
            partition = str(body.get("partition") or "gpu").strip()
            job_command = str(body.get("command") or "").strip()
            image = str(body.get("image") or "").strip()[:256]
            try:
                raw_gpus = body.get("gpus", 1)
                gpus = int(raw_gpus)
            except (TypeError, ValueError):
                gpus = 0
            time_limit = str(body.get("time") or "1h").strip()
            if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", name):
                return self._envelope(None, status=400, code="INVALID_JOB_NAME", message="作业名称仅允许字母、数字、下划线、点和短横线")
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", partition):
                return self._envelope(None, status=400, code="INVALID_PARTITION", message="分区名称无效")
            if gpus < 1 or gpus > 8:
                return self._envelope(None, status=400, code="INVALID_GPU_COUNT", message="GPU 数量必须在 1-8 之间")
            if time_limit not in ("1h", "4h", "12h", "24h", "72h"):
                return self._envelope(None, status=400, code="INVALID_TIME_LIMIT", message="运行时长无效")
            if not job_command or len(job_command) > 4096:
                return self._envelope(None, status=400, code="INVALID_COMMAND", message="请填写作业命令（最多 4096 字符）")
            try:
                COMMAND_DIR.mkdir(parents=True, exist_ok=True)
                command = {
                    "command": "sbatch",
                    "name": name,
                    "partition": partition,
                    "gpus": gpus,
                    "time": time_limit,
                    "image": image,
                    "command_line": job_command,
                    "owner": identity.get("username", ""),
                    "requested_by": identity.get("username", ""),
                    "request_id": self._rid,
                    "time_submitted": now_iso(),
                }
                (COMMAND_DIR / f"sbatch-{self._rid}.json").write_text(
                    json.dumps(command, ensure_ascii=False), encoding="utf-8")
            except Exception as exc:
                return self._envelope(None, status=503, code="COMMAND_UNAVAILABLE",
                                      message=f"Slurm 提交通道不可用：{exc}")
            record_audit(identity, "作业操作", f"提交作业 {name}（{gpus} GPU）", f"job:{name}",
                         request_id=self._rid, user_agent=self.headers.get("User-Agent", ""))
            return self._envelope({
                "state": "submitting", "command": "sbatch", "name": name,
                "partition": partition, "gpus": gpus, "time": time_limit,
                "owner": identity.get("username", ""), "request_id": self._rid,
                "message": "已进入 Slurm 提交队列，数秒后刷新作业列表可见真实 JobId",
            }, status=202)
        if path.startswith("/api/v1/jobs/") and path.endswith("/cancel"):
            if not self._require_csrf(identity):
                return None
            job_id = path.split("/")[-2]
            job = next((j for j in JOBS if str(j["id"]) == job_id), None)
            if not job:
                return self._envelope(None, status=404, code="NOT_FOUND", message="作业不存在")
            if not A.has_role(identity, "admin", "ops") and job["owner"] != identity["username"]:
                return self._envelope(None, status=403, code="OBJECT_SCOPE_DENIED", message="只能取消自己的作业")
            if job["state"] in ("completed", "failed", "cancelled"):
                return self._envelope(None, status=409, code="INVALID_STATE", message="当前状态不可取消")
            try:
                COMMAND_DIR.mkdir(parents=True, exist_ok=True)
                command = {
                    "command": "scancel", "job_id": job["id"], "server": job.get("server", ""),
                    "requested_by": identity.get("username", ""), "request_id": self._rid,
                    "time": now_iso(),
                }
                (COMMAND_DIR / f"scancel-{job['id']}-{self._rid}.json").write_text(
                    json.dumps(command, ensure_ascii=False), encoding="utf-8")
            except Exception as exc:
                return self._envelope(None, status=503, code="COMMAND_UNAVAILABLE",
                                      message=f"Slurm 命令通道不可用：{exc}")
            job["state"] = "cancelling"
            STORE.save_job(job)
            record_audit(identity, "作业操作", f"请求取消作业 {job['id']}", f"job:{job['id']}",
                         request_id=self._rid, user_agent=self.headers.get("User-Agent", ""))
            return self._envelope({"id": job["id"], "state": job["state"], "command": "scancel"})
        if path.startswith("/api/v1/alerts/") and path.endswith("/ack"):
            if not self._require_csrf(identity):
                return None
            try:
                A.require_roles(identity, "admin", "ops")
            except A.AuthError as exc:
                return self._error(exc)
            alert_id = unquote(path.split("/")[-2])
            alert = next((a for a in ALERTS if a["id"] == alert_id), None)
            if not alert:
                return self._envelope(None, status=404, code="NOT_FOUND", message="告警不存在")
            alert["state"] = "acked"
            STORE.save_alert(alert)
            record_audit(identity, "告警处置", f"确认告警 {alert['id']}", alert["id"],
                         request_id=self._rid, user_agent=self.headers.get("User-Agent", ""))
            return self._envelope(serialize_alert(alert, ALERTS.index(alert)))
        self._drain_body()
        return self._envelope(None, status=404, code="NOT_FOUND", message="接口不存在")

    # ---------- handlers ----------
    def _login_post(self):
        if not A.LOCAL_MODE:
            return self._envelope(None, status=404, code="NOT_FOUND", message="生产模式请走 OIDC 登录")
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 64 * 1024)
        except ValueError:
            length = 0
        raw = self.rfile.read(length).decode("utf-8", "replace")
        form = parse_qs(raw)
        username = (form.get("username") or [""])[0].strip()
        password = (form.get("password") or [""])[0]
        next_url = safe_next((form.get("next") or ["/"])[0])
        source_ip = self._client_ip(trust_forwarded=False)
        user_agent = self.headers.get("User-Agent", "")
        if not STORE.login_allowed(source_ip, username, limit=5, window=600):
            record_event(username or "匿名", "anonymous", "登录失败", "登录尝试超过限流阈值",
                         "session", False, source_ip, self._rid, user_agent)
            return self._html(login_page(next_url, "登录失败次数过多，请 10 分钟后再试"), status=429)
        try:
            identity = A.authenticate_local(username, password, source_ip)
        except A.AuthError as exc:
            STORE.login_failed(source_ip, username)
            record_event(username or "匿名", "anonymous", "登录失败",
                         f"本地认证失败：{exc.message}", "session", False,
                         source_ip, self._rid, user_agent)
            return self._html(login_page(next_url, exc.message), status=exc.status)
        STORE.login_success(source_ip, username)
        token = A.issue_session(identity)
        parsed = A.read_session(token)
        if parsed:
            STORE.register_session(parsed.get("jti", ""), parsed["username"], A.SESSION_TTL_SECONDS)
        record_audit(identity, "登录", f"本地认证登录：{identity['username']}", "session",
                     request_id=self._rid, user_agent=user_agent)
        return self._redirect(next_url, cookie=self._cookie(token))

    def _alert_webhook(self):
        """Alertmanager webhook：内部 token 校验，写入真实告警。"""
        header_token = self.headers.get("X-Collector-Token", "")
        query_token = (parse_qs(urlparse(self.path).query).get("token") or [""])[0]
        token = header_token or query_token
        if COLLECTOR_TOKEN and not hmac.compare_digest(token, COLLECTOR_TOKEN):
            return self._envelope(None, status=401, code="AUTH_REQUIRED", message="告警 token 无效")
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 1024 * 1024)
            body = json.loads(self.rfile.read(length) or b"{}")
            incoming = body.get("alerts", []) if isinstance(body, dict) else []
            changed = 0
            for item in incoming:
                labels = item.get("labels", {}) or {}
                annotations = item.get("annotations", {}) or {}
                fingerprint = item.get("fingerprint") or labels.get("alertname", "alert")
                aid = f"AM-{str(fingerprint)[:24]}"
                status = item.get("status", body.get("status", "firing"))
                severity = labels.get("severity", "warning")
                if severity not in ("critical", "warning", "info"):
                    severity = "warning"
                title = (annotations.get("summary") or labels.get("alertname", "GPU 告警"))[:200]
                existing = next((a for a in ALERTS if str(a.get("id")) == aid), None)
                record = {
                    "id": aid, "severity": severity, "title": title,
                    "server": (labels.get("instance") or labels.get("node") or "—")[:128],
                    "gpu": (labels.get("gpu") or "—")[:128],
                    "state": "resolved" if status == "resolved" else "firing",
                    "rule": labels.get("alertname", "—")[:128],
                    "desc": (annotations.get("description") or title)[:1000],
                    "mins": 0, "time": int(time.time() * 1000),
                    "source": "alertmanager",
                }
                if existing:
                    existing.update(record)
                else:
                    ALERTS.append(record)
                STORE.save_alert(record)
                changed += 1
            return self._envelope({"received": len(incoming), "changed": changed})
        except Exception as exc:
            return self._envelope(None, status=400, code="VALIDATION_FAILED", message=str(exc))

    def _ingest(self):
        token = self.headers.get("X-Collector-Token", "")
        if COLLECTOR_TOKEN and not hmac.compare_digest(token, COLLECTOR_TOKEN):
            return self._envelope(None, status=401, code="AUTH_REQUIRED", message="采集 token 无效")
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 1024 * 1024)
            body = json.loads(self.rfile.read(length) or b"{}")
            server = body.get("server")
            gpus = body.get("gpus")
            if server not in server_names() or not isinstance(gpus, list):
                return self._envelope(None, status=400, code="VALIDATION_FAILED", message="server 未配置或 gpus 非数组")
            ts_iso = body.get("ts") or now_iso()
            STORE.save_telemetry(server, ts_iso, gpus)
            with LOCK:
                TELEMETRY[server] = {"ts": ts_iso, "gpus": gpus}
            jobs = body.get("jobs")
            if isinstance(jobs, list):
                normalized = []
                for job in jobs:
                    if not isinstance(job, dict) or "id" not in job:
                        continue
                    item = {
                        "id": job.get("id"),
                        "name": job.get("name") or "slurm-job",
                        "owner": job.get("owner") or "unknown",
                        "state": job.get("state") or "pending",
                        "progress": int(job.get("progress") or 0),
                        "priority": int(job["priority"]) if job.get("priority") is not None else None,
                        "partition": job.get("partition") or "gpu",
                        "gpus": int(job.get("gpus") or 0),
                        "nodes": int(job.get("nodes") or 1),
                        "cpus": int(job.get("cpus") or 1),
                        "qos": job.get("qos") if job.get("qos") not in ("(null)", None) else "normal",
                        "account": job.get("account") if job.get("account") not in ("(null)", None) else "platform",
                        "image": job.get("image") or "",
                        "elapsed": int(job.get("elapsed") or 0),
                        "submitted": int(job.get("submitted") or 0),
                        "started": int(job.get("started") or 0),
                        "exitCode": job.get("exitCode"),
                        "reason": job.get("reason") or "",
                        "server": server,
                        "log_tail": job.get("log_tail") if isinstance(job.get("log_tail"), list) else [],
                    }
                    normalized.append(item)
                if isinstance(normalized, list):
                    reported_ids = {str(item["id"]) for item in normalized}
                    terminal = {"completed", "failed", "cancelled", "timeout", "node_fail", "preempted", "out_of_memory"}
                    with LOCK:
                        missing = [j for j in JOBS
                                   if j.get("server") == server
                                   and str(j.get("id")) not in reported_ids
                                   and j.get("state") in terminal]
                        current = [j for j in JOBS if j.get("server") != server]
                        JOBS[:] = current + normalized
                    for job in missing:
                        STORE.save_job_history(job)
                    for item in normalized:
                        STORE.save_job(item)
                    STORE.delete_jobs_except(server, reported_ids)
            return self._envelope({"server": server, "gpus": len(gpus), "jobs": len(jobs) if isinstance(jobs, list) else 0})
        except Exception as exc:
            return self._envelope(None, status=400, code="VALIDATION_FAILED", message=str(exc))

    def _html(self, body: bytes, status=HTTPStatus.OK):
        self.send_response(status)
        self._base_headers("text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static_or_login(self, path: str, query: str):
        if A.LOCAL_MODE and not self._identity(optional=True):
            next_url = safe_next(path + (("?" + query) if query else ""))
            return self._redirect("/login?next=" + quote(next_url, safe=""))
        if A.LOCAL_MODE is False and path not in PUBLIC_PATHS:
            # 生产模式静态资源由网关托管；后端不直接暴露 SPA。
            return self._envelope(None, status=404, code="NOT_FOUND", message="静态资源由网关提供")
        rel = path.lstrip("/")
        if rel.startswith("portal/"):
            rel = rel[len("portal/"):]
        if not rel or rel.endswith("/"):
            rel = "index.html"
        target = (FRONTEND / rel).resolve()
        try:
            target.relative_to(FRONTEND.resolve())
        except ValueError:
            return self._envelope(None, status=403, code="FORBIDDEN", message="非法路径")
        if not target.is_file():
            target = (FRONTEND / "index.html").resolve()
            if not target.is_file():
                return self._envelope(None, status=404, code="NOT_FOUND", message="前端资源不存在")
        ctype, _ = mimetypes.guess_type(str(target))
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self._base_headers(ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="星轨算力平台后端")
    parser.add_argument("--host", default=os.environ.get("PORTAL_BIND", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORTAL_PORT", "8000")))
    args = parser.parse_args()
    init_persistence()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    host, port = httpd.server_address[:2]
    print(f"StarRail portal backend on http://{host}:{port} auth_mode={A.AUTH_MODE}")
    print(f"config={CONFIG_PATH} frontend={FRONTEND}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()


