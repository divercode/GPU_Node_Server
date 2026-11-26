#!/usr/bin/env python3
"""生成软著源代码鉴别材料：前 30 页 + 后 30 页，每页 50 行。"""
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "星轨算力-源代码-前30页后30页.docx"
HEADER = "星轨算力GPU集群监控与作业管理平台软件 V1.0"
SOFTWARE_FILES = [
    "backend/app.py",
    "backend/auth.py",
    "backend/agent.py",
    "frontend/index.html",
    "frontend/js/data.js",
    "frontend/js/charts.js",
    "frontend/js/ui.js",
    "frontend/js/app.js",
    "frontend/js/pages/core.js",
    "frontend/js/pages/work.js",
    "frontend/js/pages/data.js",
    "frontend/js/pages/admin.js",
    "frontend/css/base.css",
    "frontend/css/app.css",
    "frontend/css/pages.css",
    "gateway/nginx.conf",
    "gateway/portal.conf.template",
    "gateway/entrypoint.sh",
    "docker-compose.yml",
    "backend/Dockerfile",
    "gateway/Dockerfile",
]
LINES_PER_PAGE = 50
TOTAL_PAGES = 60
HALF_PAGES = TOTAL_PAGES // 2
MAX_DISPLAY_CHARS = 150


def wrap_line(line, width=MAX_DISPLAY_CHARS):
    """把超长源码行拆成可直接排版的显示行，避免 Word 自动换行造成页数漂移。"""
    if len(line) <= width:
        return [line]
    indent = len(line) - len(line.lstrip(" "))
    continuation = " " * min(indent + 4, 20) + "> "
    chunks = []
    for start in range(0, len(line), width):
        part = line[start:start + width]
        chunks.append((continuation if start else "") + part)
    return chunks


def collect_lines():
    lines = []
    for rel in SOFTWARE_FILES:
        path = ROOT / rel
        if not path.is_file():
            continue
        lines.append(f"// ==================== {rel} ====================")
        text = path.read_text("utf-8", errors="replace")
        for line in text.splitlines():
            lines.extend(wrap_line(line.replace("\t", "    ").rstrip()))
        lines.append("")
    return lines


def set_east_asian(run, name):
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:eastAsia"), name)


def add_page_field(paragraph):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = "PAGE"
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_end)


def main():
    all_lines = collect_lines()
    total_pages = max(1, (len(all_lines) + LINES_PER_PAGE - 1) // LINES_PER_PAGE)
    if total_pages <= TOTAL_PAGES:
        pages = [all_lines[i * LINES_PER_PAGE:(i + 1) * LINES_PER_PAGE] for i in range(total_pages)]
    else:
        first = all_lines[:HALF_PAGES * LINES_PER_PAGE]
        last = all_lines[-HALF_PAGES * LINES_PER_PAGE:]
        pages = [first[i * LINES_PER_PAGE:(i + 1) * LINES_PER_PAGE] for i in range(HALF_PAGES)]
        pages += [last[i * LINES_PER_PAGE:(i + 1) * LINES_PER_PAGE] for i in range(HALF_PAGES)]

    document = Document()
    sec = document.sections[0]
    sec.orientation = WD_ORIENT.LANDSCAPE
    sec.page_width, sec.page_height = Cm(29.7), Cm(21.0)
    sec.top_margin = Cm(1.4)
    sec.bottom_margin = Cm(1.3)
    sec.left_margin = Cm(1.5)
    sec.right_margin = Cm(1.5)

    normal = document.styles["Normal"]
    normal.font.name = "Consolas"
    normal.font.size = Pt(7.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")

    hp = sec.header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    hr = hp.add_run(HEADER)
    hr.font.name = "宋体"
    set_east_asian(hr, "宋体")
    hr.font.size = Pt(9)

    for page_index, page in enumerate(pages):
        for line in page:
            p = document.add_paragraph()
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = Pt(9)
            r = p.add_run(line if line else " ")
            r.font.name = "Consolas"
            set_east_asian(r, "宋体")
            r.font.size = Pt(7.5)
        if page_index < len(pages) - 1:
            document.add_page_break()

    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r1 = fp.add_run("第 ")
    r1.font.size = Pt(8)
    add_page_field(fp)
    r2 = fp.add_run(f" 页 / 共 {len(pages)} 页")
    r2.font.size = Pt(8)

    OUT.write_bytes(b"")
    document.save(OUT)
    print("source lines:", len(all_lines))
    print("original pages:", total_pages)
    print("submitted pages:", len(pages))
    print("output:", OUT)


if __name__ == "__main__":
    main()
