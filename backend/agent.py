#!/usr/bin/env python3
"""GPU 服务器采集 agent（雏形，无第三方依赖）

在每台 GPU 服务器上运行：
  python agent.py --server gpu-01 --backend http://<管理机IP>:8000 --interval 15

采集字段：GPU index / UUID / 温度 / 功耗 / 利用率 / 显存。
硬件错误（XID/ECC/NVLink）建议后续直接由 dcgm-exporter 提供，不要用 nvidia-smi 硬解析。
"""
from __future__ import annotations

import argparse
import json
import os
import pwd
import re
import socket
import subprocess
import time
import urllib.request

QUERY = "index,uuid,temperature.gpu,power.draw,utilization.gpu,memory.used,memory.total"
FIELDS = ["index", "uuid", "temperature_c", "power_w", "utilization_pct", "memory_used_mb", "memory_total_mb"]


def read_nvidia_smi() -> list[dict]:
    out = subprocess.check_output(
        ["nvidia-smi", f"--query-gpu={QUERY}", "--format=csv,noheader,nounits"],
        text=True, encoding="utf-8", errors="replace",
    )
    gpus = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < len(FIELDS):
            continue
        row = dict(zip(FIELDS, parts))
        for key in ("temperature_c", "power_w", "utilization_pct", "memory_used_mb", "memory_total_mb"):
            try:
                row[key] = float(row[key])
            except ValueError:
                row[key] = None
        row["index"] = int(row["index"])
        row["xid"] = None
        row["state"] = "allocated" if (row.get("utilization_pct") or 0) > 0 else "idle"
        gpus.append(row)
    return gpus


def _slurm_duration(value: str) -> int:
    if not value or value in ("Unknown", "INVALID"):
        return 0
    days = 0
    if "-" in value:
        d, value = value.split("-", 1)
        days = int(d)
    parts = [int(x) for x in value.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]


def _slurm_epoch(value: str) -> int:
    if not value or value in ("Unknown", "N/A"):
        return 0
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(value).timestamp() * 1000)
    except Exception:
        return 0


def _slurm_gpus(line: str) -> int:
    for pattern in (r"TresPerNode=gres:gpu:(\d+)", r"AllocTRES=.*?gres/gpu=(\d+)", r"Tres=.*?gres/gpu=(\d+)"):
        match = re.search(pattern, line)
        if match:
            return int(match.group(1))
    return 0


def read_slurm_jobs() -> list[dict]:
    """读取本机 Slurm 近期作业；scontrol 不可用时返回空列表。"""
    try:
        out = subprocess.check_output(
            ["scontrol", "show", "job", "-o"], text=True,
            encoding="utf-8", errors="replace", timeout=5,
        )
    except Exception:
        return []
    state_map = {
        "PENDING": "pending", "RUNNING": "running", "COMPLETING": "running",
        "CONFIGURING": "running", "SUSPENDED": "running",
        "COMPLETED": "completed", "CANCELLED": "cancelled",
        "FAILED": "failed", "TIMEOUT": "failed", "OUT_OF_MEMORY": "failed",
        "NODE_FAIL": "failed", "PREEMPTED": "cancelled",
    }
    jobs = []
    for line in out.splitlines():
        fields = dict(re.findall(r"(\w+(?:/\w+)?)=(\"[^\"]*\"|\S+)", line))
        job_id = fields.get("JobId", "")
        if not job_id or "." in job_id or "+" in job_id:
            continue
        state_raw = fields.get("JobState", "").split()[0]
        owner_raw = fields.get("UserId", "")
        owner = owner_raw.split("(")[0] if owner_raw else "unknown"
        elapsed = _slurm_duration(fields.get("RunTime", ""))
        time_limit = _slurm_duration(fields.get("TimeLimit", ""))
        try:
            priority = int(fields.get("Priority", "0") or 0)
        except ValueError:
            priority = 0
        mapped_state = state_map.get(state_raw, "pending")
        if mapped_state in ("completed", "failed", "cancelled"):
            progress = 100
        elif state_raw == "RUNNING" and time_limit > 0:
            progress = min(99, max(0, int(round(elapsed * 100 / time_limit))))
        else:
            progress = 0
        try:
            job_id_value = int(job_id)
        except ValueError:
            job_id_value = job_id
        log_tail = []
        stdout_path = fields.get("StdOut", "").strip('"')
        if stdout_path and os.path.isfile(stdout_path):
            try:
                with open(stdout_path, "r", encoding="utf-8", errors="replace") as fh:
                    log_tail = [line.rstrip("\n") for line in fh.readlines()[-200:]]
            except OSError:
                log_tail = []
        jobs.append({
            "id": job_id_value,
            "name": fields.get("JobName", "slurm-job").strip('"'),
            "owner": owner,
            "state": mapped_state,
            "progress": progress,
            "priority": priority,
            "partition": fields.get("Partition", "gpu"),
            "gpus": _slurm_gpus(line),
            "nodes": int(fields.get("NumNodes", "1") or 1),
            "cpus": int(fields.get("NumCPUs", "1") or 1),
            "qos": fields.get("QOS", "(null)"),
            "account": fields.get("Account", "(null)"),
            "image": "",
            "elapsed": elapsed,
            "submitted": _slurm_epoch(fields.get("SubmitTime", "")),
            "started": _slurm_epoch(fields.get("StartTime", "")),
            "exitCode": 0 if fields.get("ExitCode", "").startswith("0:") else 1,
            "reason": fields.get("Reason", ""),
            "log_tail": log_tail,
        })
    return jobs


SBATCH_DIR = "/var/lib/starrail-jobs"
SCRIPT_DIR = "/tmp/starrail-jobs"


def _slurm_time_limit(value: str) -> str:
    """Convert UI time selection to Slurm --time syntax."""
    minutes = {"1h": 60, "4h": 240, "12h": 720, "24h": 1440, "72h": 4320}.get(value, 60)
    return f"{minutes // 60:02d}:{minutes % 60:02d}:00"


def _write_submit_result(result_dir: str, request_id: str, result: dict) -> None:
    try:
        target = os.path.join(result_dir, f"result-{request_id}.json")
        with open(target, "w", encoding="utf-8") as fh:
            json.dump({"request_id": request_id, **result}, fh, ensure_ascii=False)
    except Exception:
        pass


def _process_sbatch(path: str, result_dir: str) -> None:
    with open(path, encoding="utf-8") as fh:
        cmd = json.load(fh)
    request_id = str(cmd.get("request_id") or os.path.basename(path).split("-")[-1].split(".")[0])
    owner = str(cmd.get("owner") or "").strip()
    name = str(cmd.get("name") or "portal-job").strip()
    partition = str(cmd.get("partition") or "gpu").strip()
    account = str(cmd.get("account") or "platform").strip()
    gpus = int(cmd.get("gpus") or 1)
    image = str(cmd.get("image") or "").strip()
    command_line = str(cmd.get("command_line") or "sleep 30").strip()
    time_limit = str(cmd.get("time") or "1h")

    if not owner or not re.fullmatch(r"[A-Za-z0-9_.-]+", owner):
        raise ValueError("invalid owner")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", name):
        raise ValueError("invalid job name")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", partition):
        raise ValueError("invalid partition")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", account):
        raise ValueError("invalid account")
    if gpus < 1 or gpus > 8:
        raise ValueError("invalid gpu count")
    if not command_line or len(command_line) > 4096:
        raise ValueError("invalid command")

    user = pwd.getpwnam(owner)
    os.makedirs(SBATCH_DIR, mode=0o755, exist_ok=True)
    os.makedirs(SCRIPT_DIR, mode=0o1777, exist_ok=True)
    script_path = os.path.join(SCRIPT_DIR, f"{request_id}.sb")
    output_path = f"/tmp/starrail-{owner}-%x-%j.out"
    os.makedirs("/tmp/starrail-jobs", mode=0o1777, exist_ok=True)
    script = f"""#!/bin/bash
#SBATCH --job-name={name}
#SBATCH --partition={partition}
#SBATCH --account={account}
#SBATCH --gres=gpu:{gpus}
#SBATCH --time={_slurm_time_limit(time_limit)}
#SBATCH --output={output_path}
#SBATCH --error={output_path}
#SBATCH --chdir=/home/{owner}
# 先执行一条非注释命令，结束 SBATCH 指令头，防止用户命令中的
# "#SBATCH ..." 被 Slurm 当作资源指令覆盖平台校验后的分区/GPU/时长。
true
{command_line}
"""
    with open(script_path, "w", encoding="utf-8") as fh:
        fh.write(script)
    os.chown(script_path, user.pw_uid, user.pw_gid)
    # slurmd 以 slurm 用户读取批处理脚本，不能用 0600。
    os.chmod(script_path, 0o644)
    result = subprocess.run(
        ["runuser", "-u", owner, "--", "sbatch", "--parsable", script_path],
        check=False, timeout=8, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    if result.returncode != 0:
        _write_submit_result(result_dir, request_id, {
            "ok": False, "owner": owner, "name": name,
            "error": (result.stderr or result.stdout or "sbatch failed").strip()[:1000],
        })
        raise RuntimeError((result.stderr or result.stdout or "sbatch failed").strip()[:1000])
    slurm_job_id = (result.stdout or "").strip().split(";")[0]
    _write_submit_result(result_dir, request_id, {
        "ok": True, "owner": owner, "name": name,
        "slurm_job_id": slurm_job_id, "image": image, "gpus": gpus,
    })
    print(f"sbatch {name} owner={owner} job={slurm_job_id} ok", flush=True)


def process_commands(command_dir: str) -> None:
    """后端通过共享目录下发的 Slurm 命令：scancel 和 sbatch。"""
    import glob
    for path in sorted(glob.glob(os.path.join(command_dir, "sbatch-*.json"))):
        try:
            _process_sbatch(path, command_dir)
            os.unlink(path)
        except Exception as exc:
            print(f"sbatch command failed {path}: {exc}", flush=True)
            request_id = os.path.basename(path).replace("sbatch-", "").split(".")[0]
            _write_submit_result(command_dir, request_id, {"ok": False, "error": str(exc)[:1000]})
            try:
                os.unlink(path)
            except OSError:
                pass
    for path in sorted(glob.glob(os.path.join(command_dir, "scancel-*.json"))):
        try:
            with open(path, encoding="utf-8") as fh:
                cmd = json.load(fh)
            job_id = str(cmd.get("job_id", "")).strip()
            if not job_id or not job_id.isdigit():
                raise ValueError("invalid job_id")
            subprocess.run(["scancel", job_id], check=True, timeout=10,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            os.unlink(path)
            print(f"scancel {job_id} ok", flush=True)
        except Exception as exc:
            print(f"scancel command failed {path}: {exc}", flush=True)


def mock_gpus(server: str, count: int = 8) -> list[dict]:
    gpus = []
    for i in range(count):
        failed = server.endswith("02") and i < 2
        gpus.append({
            "index": i, "uuid": f"GPU-{server}-{i:02d}", "temperature_c": 78 + i if failed else 44 + i * 2,
            "power_w": 60 + i * 4 if failed else 210 + i * 12,
            "utilization_pct": 0 if failed else 60 + (i * 5) % 35,
            "memory_used_mb": 0 if failed else 18000 + i * 700, "memory_total_mb": 81920,
            "xid": 79 if failed else None, "state": "error" if failed else "allocated",
        })
    return gpus


def post(backend: str, server: str, gpus: list[dict], jobs: list[dict], token: str = "") -> None:
    body = json.dumps({"server": server, "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "gpus": gpus, "jobs": jobs}).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Collector-Token"] = token
    req = urllib.request.Request(
        backend.rstrip("/") + "/api/v1/collector/ingest", data=body,
        headers=headers, method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        print(server, "->", resp.status, resp.read().decode())


def main():
    parser = argparse.ArgumentParser(description="GPU 服务器采集 agent")
    parser.add_argument("--server", default=socket.gethostname(), help="config.json 中的服务器名，如 gpu-01")
    parser.add_argument("--backend", default="http://127.0.0.1:8000")
    parser.add_argument("--interval", type=int, default=15)
    parser.add_argument("--token", default=os.environ.get("PORTAL_COLLECTOR_TOKEN", ""), help="采集 token（与平台 .env 一致）")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--mock", action="store_true", help="没有 GPU 时发送模拟数据")
    parser.add_argument("--command-dir", default="/home/test/portal-commands")
    args = parser.parse_args()

    while True:
        try:
            gpus = mock_gpus(args.server) if args.mock else read_nvidia_smi()
            jobs = [] if args.mock else read_slurm_jobs()
            post(args.backend, args.server, gpus, jobs, args.token)
            process_commands(args.command_dir)
        except Exception as exc:
            print("collect failed:", exc)
        if args.once:
            break
        time.sleep(max(1, args.interval))


if __name__ == "__main__":
    main()

