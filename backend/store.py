#!/usr/bin/env python3
"""持久层：PostgreSQL 业务/审计/遥测 + Redis 缓存/限流/会话撤销。

设计约束：
- 生产容器设置 PORTAL_DB_REQUIRED=1 / PORTAL_REDIS_REQUIRED=1，连接失败启动失败；
- 本地无 DB 时允许内存降级（仅演示），但审计链表、限流、会话撤销逻辑保持同一接口；
- 审计链表使用 PostgreSQL 事务级 advisory lock 串行追加，任何 UPDATE/DELETE 被触发器拒绝；
- Redis 用于登录/API 限流、会话撤销、最新 GPU 遥测缓存。
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

try:
    import psycopg
    from psycopg.types.json import Jsonb
except Exception:  # pragma: no cover - optional local fallback
    psycopg = None
    Jsonb = None

try:
    import redis
except Exception:  # pragma: no cover - optional local fallback
    redis = None

GENESIS_HASH = "0" * 64
AUDIT_LOCK_KEY = "starrail_audit_chain"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def audit_canonical(ts_iso: str, actor: str, role: str, action: str, obj: str,
                    detail: str, ok: bool, ip: str, user_agent: str,
                    request_id: str, prev_hash: str) -> str:
    return json.dumps({
        "ts": ts_iso,
        "actor": actor,
        "role": role,
        "action": action,
        "object": obj,
        "detail": detail,
        "ok": bool(ok),
        "ip": ip,
        "user_agent": user_agent,
        "request_id": request_id,
        "prev_hash": prev_hash,
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def audit_hash(ts_iso: str, actor: str, role: str, action: str, obj: str,
               detail: str, ok: bool, ip: str, user_agent: str,
               request_id: str, prev_hash: str) -> str:
    return sha256_text(audit_canonical(ts_iso, actor, role, action, obj, detail,
                                       ok, ip, user_agent, request_id, prev_hash))


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS jobs (
  id BIGINT PRIMARY KEY,
  owner TEXT NOT NULL,
  state TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_history (
  id BIGINT PRIMARY KEY,
  owner TEXT NOT NULL,
  state TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gpu_telemetry (
  server TEXT PRIMARY KEY,
  ts_iso TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_uid TEXT UNIQUE NOT NULL,
  ts_iso TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  object TEXT NOT NULL,
  detail TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  request_id TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_id_desc ON audit_events (id DESC);

CREATE OR REPLACE FUNCTION starrail_audit_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_append_only ON audit_events;
CREATE TRIGGER trg_audit_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION starrail_audit_append_only();

DROP TRIGGER IF EXISTS trg_audit_no_truncate ON audit_events;
CREATE TRIGGER trg_audit_no_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION starrail_audit_append_only();
"""


class Store:
    def __init__(self):
        self.db_url = os.environ.get("PORTAL_DATABASE_URL", "").strip()
        self.redis_url = os.environ.get("PORTAL_REDIS_URL", "").strip()
        self.db_required = os.environ.get("PORTAL_DB_REQUIRED", "0").lower() in ("1", "true", "yes")
        self.redis_required = os.environ.get("PORTAL_REDIS_REQUIRED", "0").lower() in ("1", "true", "yes")
        self.pg = None
        self.r = None
        self._lock = threading.RLock()
        self._jobs: list[dict] = []
        self._job_history: list[dict] = []
        self._alerts: list[dict] = []
        self._audit: list[dict] = []
        self._telemetry: dict[str, dict] = {}
        self._sessions: dict[str, tuple[str, float]] = {}
        self._rates: dict[str, tuple[int, int]] = {}
        self._started = time.time()

    # ---------------- lifecycle ----------------
    def init(self, seed_jobs: list[dict], seed_alerts: list[dict], seed_audit: list[dict]) -> "Store":
        if self.db_url:
            self._init_pg(seed_jobs, seed_alerts, seed_audit)
        else:
            self._jobs = [dict(j) for j in seed_jobs]
            self._alerts = [dict(a) for a in seed_alerts]
            self._seed_memory_audit(seed_audit)
        if self.redis_url:
            self._init_redis()
        return self

    def _init_pg(self, seed_jobs, seed_alerts, seed_audit):
        if psycopg is None:
            if self.db_required:
                raise RuntimeError("PORTAL_DATABASE_URL is set but psycopg is not installed")
            print("[store] psycopg unavailable; PostgreSQL persistence disabled")
            self._jobs = [dict(j) for j in seed_jobs]
            self._alerts = [dict(a) for a in seed_alerts]
            self._seed_memory_audit(seed_audit)
            return
        last_error = None
        for _ in range(30):
            try:
                with psycopg.connect(self.db_url, connect_timeout=3) as conn:
                    with conn.cursor() as cur:
                        cur.execute(SCHEMA_SQL)
                self.pg = self.db_url
                self._seed_pg(seed_jobs, seed_alerts, seed_audit)
                self._jobs = self.load_jobs()
                self._alerts = self.load_alerts()
                print("[store] PostgreSQL connected")
                return
            except Exception as exc:  # retry while postgres starts
                last_error = exc
                time.sleep(1)
        if self.db_required:
            raise RuntimeError(f"PostgreSQL unavailable: {last_error}")
        print(f"[store] PostgreSQL unavailable, using memory: {last_error}")
        self._jobs = [dict(j) for j in seed_jobs]
        self._alerts = [dict(a) for a in seed_alerts]
        self._seed_memory_audit(seed_audit)

    def _init_redis(self):
        if redis is None:
            if self.redis_required:
                raise RuntimeError("PORTAL_REDIS_URL is set but redis package is not installed")
            print("[store] redis package unavailable; Redis disabled")
            return
        try:
            client = redis.Redis.from_url(self.redis_url, decode_responses=True, socket_timeout=2,
                                          socket_connect_timeout=2)
            client.ping()
            self.r = client
            print("[store] Redis connected")
        except Exception as exc:
            if self.redis_required:
                raise RuntimeError(f"Redis unavailable: {exc}")
            print(f"[store] Redis unavailable, using memory: {exc}")
            self.r = None

    def _seed_pg(self, seed_jobs, seed_alerts, seed_audit):
        with psycopg.connect(self.db_url) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM jobs")
                if cur.fetchone()[0] == 0:
                    for job in seed_jobs:
                        cur.execute(
                            "INSERT INTO jobs (id, owner, state, data) VALUES (%s,%s,%s,%s) "
                            "ON CONFLICT (id) DO NOTHING",
                            (job["id"], job.get("owner", ""), job.get("state", ""), Jsonb(job)),
                        )
                cur.execute("SELECT count(*) FROM alerts")
                if cur.fetchone()[0] == 0:
                    for alert in seed_alerts:
                        cur.execute(
                            "INSERT INTO alerts (id, state, data) VALUES (%s,%s,%s) "
                            "ON CONFLICT (id) DO NOTHING",
                            (alert["id"], alert.get("state", ""), Jsonb(alert)),
                        )
                cur.execute("SELECT count(*) FROM audit_events")
                if cur.fetchone()[0] == 0:
                    # seed 列表按新到旧排列；倒序写入，保证链按时间递增。
                    for event in reversed(seed_audit):
                        ts = datetime.now(timezone.utc) - __import__("datetime").timedelta(
                            minutes=int(event.get("mins", 0)))
                        self._append_audit_pg(
                            conn,
                            ts_iso=ts.isoformat(timespec="microseconds"),
                            event_uid=event.get("id") or f"AUD-{uuid.uuid4().hex[:12].upper()}",
                            actor=event.get("actor", "system"),
                            role=event.get("role", "system"),
                            action=event.get("action", "事件"),
                            obj=event.get("object", ""),
                            detail=event.get("detail", ""),
                            ok=bool(event.get("ok", True)),
                            ip=event.get("ip", "unknown"),
                            user_agent="seed",
                            request_id="seed",
                        )

    def _seed_memory_audit(self, seed_audit):
        now = datetime.now(timezone.utc)
        self._audit = []
        for event in reversed(seed_audit):
            ts = (now - __import__("datetime").timedelta(minutes=int(event.get("mins", 0)))).isoformat(
                timespec="microseconds")
            prev = self._audit[-1]["hash"] if self._audit else GENESIS_HASH
            record = {
                "id": event.get("id") or f"AUD-{uuid.uuid4().hex[:12].upper()}",
                "event_uid": event.get("id") or f"AUD-{uuid.uuid4().hex[:12].upper()}",
                "ts_iso": ts,
                "actor": event.get("actor", "system"),
                "role": event.get("role", "system"),
                "action": event.get("action", ""),
                "object": event.get("object", ""),
                "detail": event.get("detail", ""),
                "ok": bool(event.get("ok", True)),
                "ip": event.get("ip", "unknown"),
                "user_agent": "seed",
                "request_id": "seed",
                "prev_hash": prev,
                "hash": audit_hash(ts, event.get("actor", "system"), event.get("role", "system"),
                                   event.get("action", ""), event.get("object", ""), event.get("detail", ""),
                                   bool(event.get("ok", True)), event.get("ip", "unknown"), "seed", "seed", prev),
            }
            self._audit.append(record)

    # ---------------- jobs/alerts ----------------
    def load_jobs(self) -> list[dict]:
        if not self.pg:
            with self._lock:
                return [dict(j) for j in self._jobs]
        with psycopg.connect(self.pg) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM jobs ORDER BY id")
                return [row[0] for row in cur.fetchall()]

    def load_alerts(self) -> list[dict]:
        if not self.pg:
            with self._lock:
                return [dict(a) for a in self._alerts]
        with psycopg.connect(self.pg) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM alerts ORDER BY id")
                return [row[0] for row in cur.fetchall()]

    def save_job(self, job: dict):
        with self._lock:
            self._jobs = [dict(j) for j in self._jobs]
        if not self.pg:
            return
        with psycopg.connect(self.pg) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO jobs (id, owner, state, data, updated_at) VALUES (%s,%s,%s,%s,now()) "
                    "ON CONFLICT (id) DO UPDATE SET owner=excluded.owner, state=excluded.state, "
                    "data=excluded.data, updated_at=now()",
                    (job["id"], job.get("owner", ""), job.get("state", ""), Jsonb(job)),
                )

    def save_job_history(self, job: dict):
        with self._lock:
            self._job_history = [dict(j) for j in self._job_history if str(j.get("id")) != str(job.get("id"))]
            self._job_history.append(dict(job))
            if len(self._job_history) > 5000:
                self._job_history = self._job_history[-5000:]
        if not self.pg:
            return
        with psycopg.connect(self.pg) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO job_history (id, owner, state, data, updated_at) VALUES (%s,%s,%s,%s,now()) "
                    "ON CONFLICT (id) DO UPDATE SET owner=excluded.owner, state=excluded.state, "
                    "data=excluded.data, updated_at=now()",
                    (job["id"], job.get("owner", ""), job.get("state", ""), Jsonb(job)),
                )
                cur.execute("DELETE FROM job_history WHERE updated_at < now() - interval '30 days'")

    def load_job_history(self, limit: int = 5000) -> list[dict]:
        if not self.pg:
            with self._lock:
                return [dict(j) for j in self._job_history[-limit:]]
        with psycopg.connect(self.pg) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM job_history ORDER BY updated_at DESC LIMIT %s", (limit,))
                return [row[0] for row in cur.fetchall()]

    def delete_jobs_except(self, server: str, keep_ids: set[str]):
        with self._lock:
            self._jobs = [dict(j) for j in self._jobs
                          if j.get("server") != server or str(j.get("id")) in keep_ids]
        if not self.pg:
            return
        ids = list(keep_ids)
        with psycopg.connect(self.pg) as conn:
            with conn.cursor() as cur:
                if ids:
                    cur.execute(
                        "DELETE FROM jobs WHERE data->>'server' = %s AND NOT (id::text = ANY(%s))",
                        (server, ids),
                    )
                else:
                    cur.execute("DELETE FROM jobs WHERE data->>'server' = %s", (server,))

    def save_alert(self, alert: dict):
        if not self.pg:
            return
        with psycopg.connect(self.pg) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO alerts (id, state, data, updated_at) VALUES (%s,%s,%s,now()) "
                    "ON CONFLICT (id) DO UPDATE SET state=excluded.state, data=excluded.data, updated_at=now()",
                    (alert["id"], alert.get("state", ""), Jsonb(alert)),
                )

    # ---------------- telemetry ----------------
    def save_telemetry(self, server: str, ts_iso: str, gpus: list[dict]):
        payload = {"ts": ts_iso, "gpus": gpus}
        if self.pg:
            with psycopg.connect(self.pg) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO gpu_telemetry (server, ts_iso, data, updated_at) VALUES (%s,%s,%s,now()) "
                        "ON CONFLICT (server) DO UPDATE SET ts_iso=excluded.ts_iso, data=excluded.data, updated_at=now()",
                        (server, ts_iso, Jsonb(payload)),
                    )
        if self.r:
            try:
                self.r.setex(f"telemetry:{server}", 120, json.dumps(payload, ensure_ascii=False))
                self.r.sadd("telemetry:servers", server)
            except Exception as exc:
                print(f"[store] redis telemetry write failed: {exc}")
        with self._lock:
            self._telemetry[server] = payload

    def latest_telemetry(self, server: str) -> dict | None:
        if self.r:
            try:
                raw = self.r.get(f"telemetry:{server}")
                if raw:
                    return json.loads(raw)
            except Exception as exc:
                print(f"[store] redis telemetry read failed: {exc}")
        if self.pg:
            with psycopg.connect(self.pg) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT data FROM gpu_telemetry WHERE server=%s", (server,))
                    row = cur.fetchone()
                    return row[0] if row else None
        with self._lock:
            return self._telemetry.get(server)

    def telemetry_servers(self) -> list[str]:
        if self.r:
            try:
                return sorted(self.r.smembers("telemetry:servers"))
            except Exception:
                pass
        if self.pg:
            with psycopg.connect(self.pg) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT server FROM gpu_telemetry ORDER BY server")
                    return [row[0] for row in cur.fetchall()]
        with self._lock:
            return sorted(self._telemetry.keys())

    # ---------------- audit chain ----------------
    def _append_audit_pg(self, conn, *, ts_iso, event_uid, actor, role, action, obj,
                         detail, ok, ip, user_agent, request_id):
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (AUDIT_LOCK_KEY,))
            cur.execute("SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1")
            row = cur.fetchone()
            prev = row[0] if row else GENESIS_HASH
            digest = audit_hash(ts_iso, actor, role, action, obj, detail, ok, ip,
                                user_agent, request_id, prev)
            cur.execute(
                "INSERT INTO audit_events (event_uid, ts_iso, actor, actor_role, action, object, detail, "
                "ok, ip, user_agent, request_id, prev_hash, hash) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (event_uid, ts_iso, actor, role, action, obj, detail, bool(ok), ip,
                 user_agent, request_id, prev, digest),
            )
            row_id = cur.fetchone()[0]
        return row_id, prev, digest

    def append_audit(self, *, actor: str, role: str, action: str, obj: str, detail: str,
                     ok: bool, ip: str, user_agent: str = "", request_id: str = "",
                     ts_iso: str | None = None, event_uid: str | None = None) -> dict:
        ts_iso = ts_iso or utc_now_iso()
        event_uid = event_uid or f"AUD-{uuid.uuid4().hex[:12].upper()}"
        user_agent = user_agent[:300]
        request_id = request_id[:120]
        if self.pg:
            with psycopg.connect(self.pg) as conn:
                row_id, prev, digest = self._append_audit_pg(
                    conn, ts_iso=ts_iso, event_uid=event_uid, actor=actor, role=role,
                    action=action, obj=obj, detail=detail, ok=ok, ip=ip,
                    user_agent=user_agent, request_id=request_id,
                )
            return {"id": event_uid, "event_uid": event_uid, "ts_iso": ts_iso,
                    "actor": actor, "role": role, "action": action, "object": obj,
                    "detail": detail, "ok": bool(ok), "ip": ip,
                    "user_agent": user_agent, "request_id": request_id,
                    "prev_hash": prev, "hash": digest}
        with self._lock:
            prev = self._audit[-1]["hash"] if self._audit else GENESIS_HASH
            digest = audit_hash(ts_iso, actor, role, action, obj, detail, ok, ip,
                                user_agent, request_id, prev)
            record = {"id": event_uid, "event_uid": event_uid, "ts_iso": ts_iso,
                      "actor": actor, "role": role, "action": action, "object": obj,
                      "detail": detail, "ok": bool(ok), "ip": ip,
                      "user_agent": user_agent, "request_id": request_id,
                      "prev_hash": prev, "hash": digest}
            self._audit.append(record)
            self._audit = self._audit[-1000:]
            return record

    def list_audit(self, limit: int = 200) -> list[dict]:
        if self.pg:
            with psycopg.connect(self.pg) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT event_uid, ts_iso, actor, actor_role, action, object, detail, ok, ip, "
                        "user_agent, request_id, prev_hash, hash FROM audit_events ORDER BY id DESC LIMIT %s",
                        (max(1, min(limit, 1000)),),
                    )
                    rows = cur.fetchall()
        else:
            with self._lock:
                rows = [
                    (r["event_uid"], r["ts_iso"], r["actor"], r["role"], r["action"], r["object"],
                     r["detail"], r["ok"], r["ip"], r["user_agent"], r["request_id"],
                     r["prev_hash"], r["hash"])
                    for r in reversed(self._audit[-limit:])
                ]
        out = []
        now = datetime.now(timezone.utc)
        for row in rows:
            uid, ts_iso, actor, role, action, obj, detail, ok, ip, ua, rid, prev, digest = row
            try:
                dt = datetime.fromisoformat(ts_iso)
                mins = max(0, int((now - dt).total_seconds() // 60))
            except Exception:
                mins = 0
            out.append({
                "id": uid, "event_uid": uid, "ts": ts_iso, "mins": mins,
                "actor": actor, "role": role, "action": action, "object": obj,
                "detail": detail, "ok": bool(ok), "ip": ip, "user_agent": ua,
                "request_id": rid, "prev_hash": prev, "hash": digest,
            })
        return out

    def verify_audit_chain(self) -> dict:
        if self.pg:
            with psycopg.connect(self.pg) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT event_uid, ts_iso, actor, actor_role, action, object, detail, ok, ip, "
                        "user_agent, request_id, prev_hash, hash FROM audit_events ORDER BY id"
                    )
                    rows = cur.fetchall()
        else:
            with self._lock:
                rows = [
                    (r["event_uid"], r["ts_iso"], r["actor"], r["role"], r["action"], r["object"],
                     r["detail"], r["ok"], r["ip"], r["user_agent"], r["request_id"],
                     r["prev_hash"], r["hash"])
                    for r in self._audit
                ]
        prev = GENESIS_HASH
        for idx, row in enumerate(rows):
            uid, ts_iso, actor, role, action, obj, detail, ok, ip, ua, rid, stored_prev, stored_hash = row
            expected_prev = prev
            expected_hash = audit_hash(ts_iso, actor, role, action, obj, detail, bool(ok),
                                       ip, ua, rid, expected_prev)
            if stored_prev != expected_prev or stored_hash != expected_hash:
                return {"valid": False, "checked": idx + 1, "broken_at": uid,
                        "expected_hash": expected_hash, "stored_hash": stored_hash}
            prev = stored_hash
        return {"valid": True, "checked": len(rows), "head_hash": prev,
                "postgres": bool(self.pg), "redis": bool(self.r)}

    # ---------------- rate limit / session ----------------
    def rate_hit(self, key: str, limit: int, window: int) -> bool:
        bucket = int(time.time() // max(1, window))
        k = f"rl:{key}:{bucket}"
        if self.r:
            try:
                count = self.r.incr(k)
                if count == 1:
                    self.r.expire(k, window + 2)
                return count <= limit
            except Exception as exc:
                print(f"[store] redis rate limit failed: {exc}")
        with self._lock:
            old_bucket, count = self._rates.get(k, (bucket, 0))
            if old_bucket != bucket:
                count = 0
            count += 1
            self._rates[k] = (bucket, count)
            if len(self._rates) > 10000:
                self._rates = {kk: vv for kk, vv in self._rates.items() if vv[0] >= bucket - 1}
            return count <= limit

    def login_allowed(self, ip: str, username: str, limit: int = 5, window: int = 600) -> bool:
        key = f"login:{ip}:{username.lower()}"
        bucket = int(time.time() // max(1, window))
        k = f"rl:{key}:{bucket}"
        if self.r:
            try:
                return int(self.r.get(k) or 0) < limit
            except Exception:
                pass
        with self._lock:
            old_bucket, count = self._rates.get(k, (bucket, 0))
            return not (old_bucket == bucket and count >= limit)

    def login_failed(self, ip: str, username: str, window: int = 600):
        key = f"login:{ip}:{username.lower()}"
        bucket = int(time.time() // max(1, window))
        k = f"rl:{key}:{bucket}"
        if self.r:
            try:
                count = self.r.incr(k)
                if count == 1:
                    self.r.expire(k, window + 2)
                return
            except Exception:
                pass
        with self._lock:
            old_bucket, count = self._rates.get(k, (bucket, 0))
            if old_bucket != bucket:
                count = 0
            self._rates[k] = (bucket, count + 1)

    def login_success(self, ip: str, username: str, window: int = 600):
        key = f"rl:login:{ip}:{username.lower()}:{int(time.time() // max(1, window))}"
        if self.r:
            try:
                self.r.delete(key)
            except Exception:
                pass
        with self._lock:
            self._rates.pop(key, None)

    def register_session(self, jti: str, username: str, ttl: int):
        if not jti:
            return
        if self.r:
            try:
                self.r.setex(f"session:{jti}", ttl, username)
                return
            except Exception as exc:
                print(f"[store] redis session write failed: {exc}")
        with self._lock:
            self._sessions[jti] = (username, time.time() + ttl)

    def session_valid(self, jti: str) -> bool:
        if not jti:
            return False
        if self.r:
            try:
                return bool(self.r.exists(f"session:{jti}"))
            except Exception:
                return False
        with self._lock:
            item = self._sessions.get(jti)
            if not item:
                return False
            if item[1] < time.time():
                self._sessions.pop(jti, None)
                return False
            return True

    def revoke_session(self, jti: str):
        if not jti:
            return
        if self.r:
            try:
                self.r.delete(f"session:{jti}")
            except Exception:
                pass
        with self._lock:
            self._sessions.pop(jti, None)

    def status(self) -> dict:
        out = {"postgres": "disabled", "redis": "disabled"}
        if self.pg:
            try:
                with psycopg.connect(self.pg, connect_timeout=2) as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT 1")
                out["postgres"] = "ok"
            except Exception:
                out["postgres"] = "error"
        if self.r:
            try:
                out["redis"] = "ok" if self.r.ping() else "error"
            except Exception:
                out["redis"] = "error"
        return out
