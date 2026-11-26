#!/usr/bin/env python3
"""给用户手册追加界面截图附录（软著文档鉴别材料）。"""
from pathlib import Path

from docx import Document
from docx.shared import Cm

ROOT = Path(__file__).resolve().parent.parent
DOCX = Path(__file__).resolve().parent / "02-软件著作权-用户手册.docx"
IMAGES = [
    ("api-live-admin.png", "图 C-1 管理员工作台（API 联调后）"),
    ("api-live-user.png", "图 C-2 普通用户工作台与资源用量"),
    ("gpus.png", "图 C-3 GPU 监控页"),
    ("alerts.png", "图 C-4 告警中心"),
    ("users.png", "图 C-5 用户与账户"),
    ("system.png", "图 C-6 系统状态"),
]


def main():
    doc = Document(DOCX)
    doc.add_page_break()
    doc.add_heading("附录 C 界面截图", level=1)
    doc.add_paragraph("以下截图用于展示软件主要界面，截图中的账号/数据均为内网原型演示数据。")
    for filename, caption in IMAGES:
        path = ROOT / "frontend" / "preview" / filename
        if not path.is_file():
            continue
        p = doc.add_paragraph()
        p.alignment = 1
        p.add_run().add_picture(str(path), width=Cm(16.0))
        cap = doc.add_paragraph(caption)
        cap.alignment = 1
    doc.save(DOCX)
    check = Document(DOCX)
    print("saved", DOCX, "paragraphs", len(check.paragraphs), "images", len(check.inline_shapes))


if __name__ == "__main__":
    main()
