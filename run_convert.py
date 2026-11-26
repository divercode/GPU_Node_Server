import os
import sys

from md2docx import convert

BASE = r"D:\算力运维平台"

jobs = [
    (
        os.path.join(BASE, "M0-PoC-可执行任务清单.md"),
        os.path.join(BASE, "M0-PoC-可执行任务清单.docx"),
        "M0 PoC 可执行任务清单 v1.0",
        True,
    ),
    (
        os.path.join(BASE, "评审意见单-v0.2.md"),
        os.path.join(BASE, "评审意见单-v0.2.docx"),
        "GPU 算力平台需求与设计说明书 评审意见单（v0.2）",
        False,
    ),
]

for src, dst, header, landscape in jobs:
    if not os.path.exists(src):
        print("missing:", os.path.basename(src))
        sys.exit(1)
    n = convert(src, dst, header, landscape)
    print("tables_checked:", n, "size:", os.path.getsize(dst))
