import argparse
import re
import sys

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BODY_FONT = "Microsoft YaHei"
CODE_FONT = "Consolas"
TABLE_FONT_SIZE = 8.5


def set_east_asian(run, name):
    r = run._element
    rPr = r.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:eastAsia"), name)


def set_run(run, size=None, bold=None, italic=None, color=None, font=BODY_FONT):
    run.font.name = font
    set_east_asian(run, font)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color is not None:
        run.font.color.rgb = RGBColor(*color)


def add_inline(paragraph, text, size=10.5, bold=False, color=None, italic=False):
    pattern = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")
    for part in pattern.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            r = paragraph.add_run(part[2:-2])
            set_run(r, size=size, bold=True, italic=italic, color=color)
        elif part.startswith("`") and part.endswith("`"):
            r = paragraph.add_run(part[1:-1])
            set_run(r, size=size - 1, bold=False, italic=italic, font=CODE_FONT, color=color)
        else:
            r = paragraph.add_run(part)
            set_run(r, size=size, bold=bold, italic=italic, color=color)


def add_field(paragraph, instr):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = instr
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr_text)
    run._r.append(fld_end)


def shade_cell(cell, fill="DCE6F1"):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)


def shade_paragraph(paragraph, fill="F2F2F2"):
    pPr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    pPr.append(shd)


def mark_header_row(row):
    trPr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    trPr.append(tbl_header)


def mark_cant_split(row):
    trPr = row._tr.get_or_add_trPr()
    trPr.append(OxmlElement("w:cantSplit"))


def style_document(document, subsection_landscape):
    section = document.sections[0]
    section.page_width = Cm(29.7) if subsection_landscape else Cm(21.0)
    section.page_height = Cm(21.0) if subsection_landscape else Cm(29.7)
    if subsection_landscape:
        section.orientation = WD_ORIENT.LANDSCAPE
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.2)
    section.right_margin = Cm(2.2)


def build_header_footer(document, header_text):
    section = document.sections[0]
    header = section.header
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = hp.add_run(header_text)
    set_run(r, size=9, color=(0x59, 0x59, 0x59))

    footer = section.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r1 = fp.add_run("第 ")
    set_run(r1, size=9, color=(0x59, 0x59, 0x59))
    add_field(fp, "PAGE")
    r2 = fp.add_run(" 页 / 共 ")
    set_run(r2, size=9, color=(0x59, 0x59, 0x59))
    add_field(fp, "NUMPAGES")
    r3 = fp.add_run(" 页")
    set_run(r3, size=9, color=(0x59, 0x59, 0x59))


def add_table(document, rows):
    if not rows:
        return
    ncols = max(len(r) for r in rows)
    table = document.add_table(rows=len(rows), cols=ncols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    for i, row in enumerate(rows):
        for j in range(ncols):
            cell = table.cell(i, j)
            text = row[j] if j < len(row) else ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.1
            add_inline(p, text, size=TABLE_FONT_SIZE, bold=(i == 0))
        if i == 0:
            mark_header_row(table.rows[i])
        mark_cant_split(table.rows[i])
        if i == 0:
            for j in range(ncols):
                shade_cell(table.cell(i, j))
    document.add_paragraph().paragraph_format.space_after = Pt(2)


def parse_table(lines, start):
    rows = []
    i = start
    while i < len(lines) and lines[i].strip().startswith("|"):
        raw = lines[i].strip()
        cells = [c.strip() for c in raw.strip("|").split("|")]
        if not all(re.fullmatch(r":?-{2,}:?", c or "") for c in cells):
            rows.append(cells)
        i += 1
    return rows, i


def convert(md_path, docx_path, header_text, landscape=False):
    with open(md_path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()

    document = Document()
    style_document(document, landscape)
    build_header_footer(document, header_text)

    normal = document.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)

    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("```"):
            i += 1
            code_lines = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1
            for cl in code_lines:
                p = document.add_paragraph()
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.0
                shade_paragraph(p)
                r = p.add_run(cl if cl else " ")
                set_run(r, size=8.5, font=CODE_FONT)
            document.add_paragraph().paragraph_format.space_after = Pt(2)
            continue
        if stripped.startswith("|"):
            rows, i = parse_table(lines, i)
            add_table(document, rows)
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            text = m.group(2)
            if level == 1:
                p = document.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_before = Pt(6)
                p.paragraph_format.space_after = Pt(10)
                add_inline(p, text, size=18, bold=True, color=(0x1F, 0x3B, 0x57))
            else:
                p = document.add_paragraph()
                p.paragraph_format.space_before = Pt(10 if level == 2 else 6)
                p.paragraph_format.space_after = Pt(4)
                p.paragraph_format.keep_with_next = True
                sizes = {2: 13.5, 3: 12, 4: 11}
                add_inline(p, text, size=sizes.get(level, 11), bold=True, color=(0x1F, 0x3B, 0x57))
            i += 1
            continue

        if stripped.startswith(">"):
            p = document.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_after = Pt(4)
            add_inline(p, stripped.lstrip("> ").strip(), size=9.5, italic=True, color=(0x44, 0x44, 0x44))
            i += 1
            continue

        if re.match(r"^-\s+", stripped) or re.match(r"^\*\s+", stripped):
            text = re.sub(r"^[-*]\s+", "", stripped)
            checkbox = ""
            if text.startswith("[ ]"):
                text = text[3:].strip()
                checkbox = "☐ "
            p = document.add_paragraph(style="List Bullet")
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.25
            add_inline(p, checkbox + text, size=10.5)
            i += 1
            continue

        if re.match(r"^\d+\.\s+", stripped):
            p = document.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.25
            add_inline(p, stripped, size=10.5)
            i += 1
            continue

        if stripped in ("---", "***", "___"):
            i += 1
            continue

        p = document.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.3
        add_inline(p, stripped, size=10.5)
        i += 1

    document.core_properties.title = header_text
    document.core_properties.author = "评审组（草案）"
    document.core_properties.subject = "GPU 算力平台需求与设计文档评审材料"
    document.save(docx_path)

    check = Document(docx_path)
    print("saved:", docx_path)
    print("paragraphs:", len(check.paragraphs), "tables:", len(check.tables))
    return len(check.tables)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--header", required=True)
    parser.add_argument("--landscape", action="store_true")
    args = parser.parse_args()
    convert(args.input, args.output, args.header, args.landscape)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
