#!/usr/bin/env python3
"""动态 IP 注册与失效告警 watch（标准库，无第三方依赖）。

每个 GPU 服务器运行一份，互相探测对方固定端口：
  GPU-Test-01: :8080 /healthz
  GPU-Test-02: :8000 /healthz
IP 变化时扫描 /24 网段并通过 /healthz 确认新地址，写入 ip_registry.json，
同时写 ip_alerts.jsonl，并可选 POST 到 IP_ALERT_WEBHOOK。
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(os.environ.get("IP_MONITOR_DIR", "/home/test"))
REGISTRY = Path(os.environ.get("IP_REGISTRY", BASE / "ip_registry.json"))
ALERTS = Path(os.environ.get("IP_ALERTS", BASE / "ip_alerts.jsonl"))
WEBHOOK = os.environ.get("IP_ALERT_WEBHOOK", "").strip()
SUBNET = os.environ.get("IP_MONITOR_SUBNET", "192.168.112")
INTERVAL = int(os.environ.get("IP_MONITOR_INTERVAL", "60"))
FAIL_LIMIT = int(os.environ.get("IP_MONITOR_FAIL_LIMIT", "3"))


def now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def load_config():
    path = Path(os.environ.get("IP_MONITOR_CONFIG", BASE / "ip_monitor.json"))
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def http_health(ip: str, port: int, timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(f"http://{ip}:{port}/healthz", timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def port_open(ip: str, port: int, timeout: float = 0.25) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        return sock.connect_ex((ip, port)) == 0
    except Exception:
        return False
    finally:
        sock.close()


def scan(port: int) -> list[str]:
    hosts = [f"{SUBNET}.{i}" for i in range(1, 255)]
    found = []
    with ThreadPoolExecutor(max_workers=96) as pool:
        for ip, ok in zip(hosts, pool.map(lambda ip: port_open(ip, port), hosts)):
            if ok and http_health(ip, port, 1.0):
                found.append(ip)
    return found


def self_ip() -> str:
    try:
        out = subprocess.check_output(["hostname", "-I"], text=True, timeout=3).strip()
        for ip in out.split():
            if ip.startswith(SUBNET + ".") and not ip.startswith("127."):
                return ip
    except Exception:
        pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return ""


def write_registry(entries: dict):
    payload = {"updated_at": now(), "clusters": entries}
    tmp = REGISTRY.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(REGISTRY)


def sync_gateway_upstream(cfg: dict, ip: str, port: int):
    """第二集群 IP 变化时改写 gateway 挂载的 upstream 文件并 reload。"""
    path = cfg.get("gateway_upstream_file")
    if not path or not ip:
        return
    target = Path(path)
    content = (
        "# 自动化维护：由 starrail-ip-monitor 在集群 B IP 变化时重写。\n"
        "upstream cluster_b_backend {\n"
        f"  server {ip}:{port};\n"
        "  keepalive 8;\n"
        "}\n"
    )
    old = target.read_text(encoding="utf-8") if target.is_file() else ""
    if old == content:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    # 必须原地写：cluster-b.conf 是以单文件 bind mount 挂进 gateway 的，
    # 用 rename 替换 inode 后容器内仍会看到旧文件。
    target.write_text(content, encoding="utf-8")
    alert(f"集群 B 上游已自动更新为 {ip}:{port}，正在 reload gateway")
    reload_dir = cfg.get("gateway_reload_dir")
    if reload_dir:
        try:
            subprocess.run(
                ["docker", "compose", "exec", "-T", "gateway", "nginx", "-s", "reload"],
                cwd=reload_dir, check=True, timeout=15,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            print("[ip-monitor] gateway reloaded", flush=True)
        except Exception as exc:
            alert(f"gateway reload 失败：{exc}")


def alert(message: str):
    record = {"time": now(), "message": message}
    ALERTS.parent.mkdir(parents=True, exist_ok=True)
    with ALERTS.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"[ip-monitor] ALERT {message}", flush=True)
    if WEBHOOK:
        try:
            req = urllib.request.Request(
                WEBHOOK,
                data=json.dumps({"text": message, "source": "starrail-ip-monitor"}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5).close()
        except Exception as exc:
            print(f"[ip-monitor] webhook failed: {exc}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    cfg = load_config()
    self_cluster = cfg["self_cluster"]
    peers = cfg.get("peers", [])
    fails = {p["cluster"]: 0 for p in peers}
    entries = {}
    if REGISTRY.is_file():
        try:
            entries = json.loads(REGISTRY.read_text(encoding="utf-8")).get("clusters", {})
        except Exception:
            entries = {}
    while True:
        current_self = self_ip()
        entries[self_cluster] = {
            "name": self_cluster, "ip": current_self, "port": cfg.get("self_port", 0),
            "healthy": True, "last_seen": now(), "role": "self",
        }
        for peer in peers:
            name = peer["cluster"]
            port = int(peer["port"])
            old_ip = (entries.get(name) or {}).get("ip") or peer.get("ip") or ""
            if old_ip and http_health(old_ip, port):
                entries[name] = {"name": name, "ip": old_ip, "port": port,
                                 "healthy": True, "last_seen": now(), "role": "peer"}
                fails[name] = 0
                if peer.get("gateway_peer"):
                    sync_gateway_upstream(cfg, old_ip, port)
                continue
            fails[name] += 1
            found = scan(port)
            if found:
                new_ip = found[0]
                if old_ip and new_ip != old_ip:
                    alert(f"{name} IP 从 {old_ip} 变为 {new_ip}（端口 {port} 健康）")
                entries[name] = {"name": name, "ip": new_ip, "port": port,
                                 "healthy": True, "last_seen": now(), "role": "peer"}
                fails[name] = 0
                if peer.get("gateway_peer"):
                    sync_gateway_upstream(cfg, new_ip, port)
            else:
                entries[name] = {"name": name, "ip": old_ip or "", "port": port,
                                 "healthy": False, "last_seen": now(), "role": "peer"}
                if fails[name] == FAIL_LIMIT:
                    alert(f"{name} 当前 IP {old_ip or '未知'} 端口 {port} 不可达，已连续 {fails[name]} 次检查失败")
        write_registry(entries)
        print(f"[ip-monitor] {now()} {json.dumps(entries, ensure_ascii=False)}", flush=True)
        if args.once:
            break
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
