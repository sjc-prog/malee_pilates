from pathlib import Path
from datetime import date

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor


ROOT = Path("/Users/jcohen/Work/malee-pilates")
OUT_DIR = ROOT / "docs"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT = OUT_DIR / "Malee-Pilates-VMS-Master-Data.docx"
LOGO = ROOT / "site/img/email/logo.png"

INK = "403B36"
SAGE = "596649"
PALE_SAGE = "EEF3EA"
BLUSH = "D9A4B2"
PALE_BLUSH = "FAEEF1"
SAND = "F4ECE2"
CREAM = "FFFCF8"
GREY = "6F6963"
LINE = "D8D3CD"
WHITE = "FFFFFF"


def style_run(run, size=9.5, bold=False, color=INK, font="Aptos"):
    run.font.name = font
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font)


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def cell_margins(cell, top=95, start=105, bottom=95, end=105):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for key, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{key}"))
        if node is None:
            node = OxmlElement(f"w:{key}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def borders(table, color=LINE, size="6"):
    tbl_pr = table._tbl.tblPr
    b = tbl_pr.first_child_found_in("w:tblBorders")
    if b is None:
        b = OxmlElement("w:tblBorders")
        tbl_pr.append(b)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        item = b.find(qn(f"w:{edge}"))
        if item is None:
            item = OxmlElement(f"w:{edge}")
            b.append(item)
        item.set(qn("w:val"), "single")
        item.set(qn("w:sz"), size)
        item.set(qn("w:space"), "0")
        item.set(qn("w:color"), color)


def repeat_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    item = OxmlElement("w:tblHeader")
    item.set(qn("w:val"), "true")
    tr_pr.append(item)


def keep_row(row):
    tr_pr = row._tr.get_or_add_trPr()
    tr_pr.append(OxmlElement("w:cantSplit"))


def set_width(cell, width_cm):
    cell.width = Cm(width_cm)
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(int(width_cm * 567)))
    tc_w.set(qn("w:type"), "dxa")


def add_table(doc, headers, rows, widths, font_size=8.5, first_col_bold=False):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    borders(table)
    head = table.rows[0]
    repeat_header(head)
    for idx, label in enumerate(headers):
        cell = head.cells[idx]
        shade(cell, SAGE)
        cell_margins(cell, 110, 100, 110, 100)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        style_run(p.add_run(str(label)), font_size, True, WHITE)
        set_width(cell, widths[idx])
    for row_index, values in enumerate(rows):
        row = table.add_row()
        keep_row(row)
        for idx, value in enumerate(values):
            cell = row.cells[idx]
            shade(cell, WHITE if row_index % 2 == 0 else PALE_SAGE)
            cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.03
            if idx > 0 and len(str(value)) <= 14:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            style_run(p.add_run(str(value)), font_size, first_col_bold and idx == 0)
            set_width(cell, widths[idx])
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(0)
    return table


def add_callout(doc, title, text, fill=PALE_BLUSH):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    borders(table, BLUSH, "8")
    cell = table.cell(0, 0)
    shade(cell, fill)
    cell_margins(cell, 160, 180, 160, 180)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    style_run(p.add_run(title + "\n"), 10.2, True, SAGE)
    style_run(p.add_run(text), 9.5)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_bullet(doc, text, bold_lead=None):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    if bold_lead and text.startswith(bold_lead):
        style_run(p.add_run(bold_lead), 9.5, True)
        style_run(p.add_run(text[len(bold_lead):]), 9.5)
    else:
        style_run(p.add_run(text), 9.5)
    return p


def add_note(doc, lead, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after = Pt(6)
    style_run(p.add_run(lead + " "), 9.5, True, SAGE)
    style_run(p.add_run(text), 9.5)


def add_questions(doc, questions):
    for number, question, why in questions:
        table = doc.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        borders(table, BLUSH, "7")
        keep_row(table.rows[0])

        prompt = table.cell(0, 0)
        shade(prompt, PALE_BLUSH)
        cell_margins(prompt, 120, 150, 125, 150)
        p = prompt.paragraphs[0]
        p.paragraph_format.space_after = Pt(3)
        style_run(p.add_run(f"Question {number}\n"), 8.3, True, SAGE)
        style_run(p.add_run(question), 9.4, True, INK)
        context = prompt.add_paragraph()
        context.paragraph_format.space_after = Pt(7)
        style_run(context.add_run("Why we need this: "), 8.3, True, GREY)
        style_run(context.add_run(why), 8.3, False, GREY)
        ap = prompt.add_paragraph()
        ap.paragraph_format.space_after = Pt(0)
        style_run(
            ap.add_run(
                "Your answer:\n\n____________________________________________________________\n"
                "____________________________________________________________"
            ),
            8.7,
            False,
            GREY,
        )
        spacer = doc.add_paragraph()
        spacer.paragraph_format.space_after = Pt(2)
    return None


doc = Document()
section = doc.sections[0]
section.page_width = Cm(21.0)
section.page_height = Cm(29.7)
section.top_margin = Cm(1.45)
section.bottom_margin = Cm(1.4)
section.left_margin = Cm(1.5)
section.right_margin = Cm(1.5)

styles = doc.styles
normal = styles["Normal"]
normal.font.name = "Aptos"
normal.font.size = Pt(9.6)
normal.font.color.rgb = RGBColor.from_string(INK)
normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Aptos")
normal.paragraph_format.space_after = Pt(5)
normal.paragraph_format.line_spacing = 1.1

for style_name, size, before, after in (
    ("Title", 24, 0, 6),
    ("Subtitle", 11, 0, 12),
    ("Heading 1", 16, 15, 7),
    ("Heading 2", 12.5, 11, 5),
    ("Heading 3", 10.5, 7, 4),
):
    style = styles[style_name]
    style.font.name = "Aptos Display" if style_name in ("Title", "Heading 1") else "Aptos"
    style.font.size = Pt(size)
    style.font.bold = style_name != "Subtitle"
    style.font.color.rgb = RGBColor.from_string("000000")
    style._element.rPr.rFonts.set(qn("w:eastAsia"), style.font.name)
    style.paragraph_format.space_before = Pt(before)
    style.paragraph_format.space_after = Pt(after)
    style.paragraph_format.keep_with_next = True

footer = section.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
style_run(footer.add_run("MÀLEE Pilates  •  Studio setup and client confirmation"), 8, False, GREY)

if LOGO.exists():
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(13)
    p.add_run().add_picture(str(LOGO), width=Inches(2.15))

title = doc.add_paragraph(style="Title")
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
title.add_run("MÀLEE Pilates")
title_ppr = title._p.get_or_add_pPr()
title_border = OxmlElement("w:pBdr")
title_bottom = OxmlElement("w:bottom")
title_bottom.set(qn("w:val"), "nil")
title_border.append(title_bottom)
title_ppr.append(title_border)
subtitle = doc.add_paragraph(style="Subtitle")
subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
subtitle.add_run("Studio Setup, Schedule, Prices and Questions")
meta = doc.add_paragraph()
meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
meta.paragraph_format.space_after = Pt(16)
style_run(meta.add_run("Prepared for client review and VMS setup  •  16 October 2026"), 9, False, GREY)

add_callout(
    doc,
    "The proposed setup in one sentence",
    "MÀLEE will be one venue/business account with two bookable studios inside it: Bophut Studio and Nathon Studio.",
)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(9)
style_run(
    p.add_run(
        "This document is written for the studio owners to check. It first shows the setup we understand from the information supplied, "
        "then lists the exact questions that must be answered before every service, timetable and trainer can be configured correctly."
    ),
    10,
)

doc.add_heading("Please check these points first", level=1)
add_table(
    doc,
    ["Item", "Our current understanding", "Status"],
    [
        ("Venue structure", "One MÀLEE venue with two studios: Bophut and Nathon", "Agreed working setup"),
        ("Bophut Studio", "9 Reformers; regular group timetable; trainer rota shown below", "Timetable supplied"),
        ("Nathon Studio", "6 Reformers; private Reformer only; appointment times at 09:30 and 11:00", "Services supplied; days/trainers missing"),
        ("Class products", "Prepaid class packages with an expiry period; no automatic renewal stated", "Prices supplied"),
        ("Halloween launch", "Five free classes on 31 October 2026", "Studio location needs confirmation"),
    ],
    [3.5, 10.2, 4.5],
    font_size=8.6,
    first_col_bold=True,
)

doc.add_page_break()
doc.add_heading("1. The two studios", level=1)

doc.add_heading("Bophut Studio", level=2)
add_table(
    doc,
    ["What we know", "Details"],
    [
        ("Capacity", "9 Reformers / maximum 9 customers in a group class"),
        ("Regular service", "Reformer group classes"),
        ("Regular timetable", "32 weekly classes, shown in Section 3"),
        ("Known trainers", "Kru Yui, Kru Nex and Kru Leaw"),
        ("Private sessions", "Earlier material mentions private availability, but the exact Bophut days, times, capacity and trainers have not been confirmed"),
    ],
    [4.2, 14.0],
    font_size=8.8,
    first_col_bold=True,
)

doc.add_heading("Nathon Studio", level=2)
add_table(
    doc,
    ["What we know", "Details"],
    [
        ("Location", "Soi Mdet, Lipa Yai, Nathon"),
        ("Capacity", "6 Reformers / maximum 6 people in a private group"),
        ("Service", "Private Reformer only: 1-to-1 or a private group of up to 6"),
        ("Advertised times", "09:30 and 11:00; advance booking required and subject to availability"),
        ("Trainer availability", "Not supplied"),
        ("Days open", "Not supplied"),
    ],
    [4.2, 14.0],
    font_size=8.8,
    first_col_bold=True,
)

add_callout(
    doc,
    "What this means in the VMS",
    "Customers must select the correct studio when they book. Classes and appointments must also carry a studio assignment so capacity, trainers and calendars do not become mixed together.",
    PALE_SAGE,
)

doc.add_heading("How should private sessions be booked?", level=2)
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(7)
style_run(
    p.add_run(
        "The VMS can present a private session in different ways. We should not choose one until MÀLEE confirms the experience it wants customers to have."
    ),
    9.6,
)
add_table(
    doc,
    ["Booking method", "What the customer sees", "Nathon example", "Typical VMS setup"],
    [
        (
            "A. Fixed private slots",
            "A list of specific sessions that already exist. The customer chooses one.",
            "Tuesday: 09:30 or 11:00",
            "Scheduled session / class-style calendar",
        ),
        (
            "B. Flexible appointment times",
            "A calendar of available dates and times generated from working hours, session length, room and instructor availability.",
            "Monday–Friday, 09:00–13:00; customer chooses an available start time",
            "Service / appointment module",
        ),
        (
            "C. Request and confirm",
            "The customer requests a preferred date and time. The studio confirms it manually.",
            "Customer requests Friday at 10:00; MÀLEE accepts or offers another time",
            "Appointment request with manual approval",
        ),
    ],
    [3.7, 5.7, 5.2, 3.6],
    font_size=7.9,
    first_col_bold=True,
)
add_note(
    doc,
    "Current Nathon wording",
    "The supplied information lists 09:30 and 11:00 as available times, which sounds like fixed slots, but it also says every session is subject to availability. MÀLEE needs to clarify whether those are the only bookable slots or simply examples within a flexible appointment window.",
)

doc.add_heading("2. What customers can book", level=1)
doc.add_heading("Bophut group classes", level=2)
add_table(
    doc,
    ["Class", "Studio", "Level", "Length", "Places", "Plain-English description"],
    [
        ("Morning Glow", "Bophut", "All levels", "55 min", "9", "Morning core activation and an energising start to the day."),
        ("Full Body Flow", "Bophut", "All levels", "55 min", "9", "A complete Reformer class for strength, tone and endurance."),
        ("Beginner", "Bophut", "Beginner", "55 min", "9", "A first-timer-friendly class covering safe form, posture and foundations."),
        ("Booty and Core", "Bophut", "All levels", "55 min", "9", "Focused glute and core strengthening."),
        ("Sunset Tone", "Bophut", "All levels", "55 min", "9", "An evening class combining mobility, sculpting and release."),
        ("Jumpboard", "Bophut", "Please confirm", "55 min", "9", "Low-impact cardio and energetic Reformer work."),
    ],
    [3.0, 2.0, 2.5, 1.7, 1.5, 7.5],
    font_size=7.9,
    first_col_bold=True,
)

doc.add_heading("Private Reformer services", level=2)
add_table(
    doc,
    ["Service", "Studio", "People", "Length", "What still needs confirming"],
    [
        ("Private Reformer 1-to-1", "Nathon", "1", "Awaiting answer", "Booking method, schedule and instructors need answers"),
        ("Private Reformer group", "Nathon", "2–6", "Awaiting answer", "Booking method, schedule and instructors need answers"),
        ("Private Reformer", "Bophut", "Awaiting answer", "Awaiting answer", "Service, booking method, schedule and instructors need answers"),
    ],
    [4.2, 2.6, 2.0, 2.6, 6.8],
    font_size=8.4,
    first_col_bold=True,
)

doc.add_page_break()
doc.add_heading("3. Bophut regular weekly timetable", level=1)
add_callout(
    doc,
    "Location",
    "Every class in this section is assigned to Bophut Studio. Please confirm that the supplied weekly timetable is for Bophut only.",
    PALE_SAGE,
)

schedule = {
    "Monday": [
        ("09:00–09:55", "Full Body Flow", "Kru Yui"),
        ("10:15–11:10", "Booty and Core", "Kru Yui"),
        ("11:30–12:25", "Full Body Flow", "Kru Yui"),
        ("17:30–18:25", "Sunset Tone", "Kru Yui"),
    ],
    "Tuesday": [
        ("07:00–07:55", "Morning Glow", "Kru Yui"),
        ("09:00–09:55", "Booty and Core", "Kru Yui"),
        ("10:15–11:10", "Beginner", "Kru Yui"),
        ("11:30–12:25", "Full Body Flow", "Kru Yui"),
        ("17:30–18:25", "Beginner", "Kru Leaw"),
        ("18:45–19:40", "Booty and Core", "Kru Leaw"),
    ],
    "Wednesday": [
        ("09:00–09:55", "Full Body Flow", "Kru Nex"),
        ("10:15–11:10", "Jumpboard", "Kru Nex"),
        ("11:30–12:25", "Beginner", "Kru Nex"),
        ("17:30–18:25", "Sunset Tone", "Kru Nex"),
    ],
    "Thursday": [
        ("07:00–07:55", "Morning Glow", "Kru Nex"),
        ("09:00–09:55", "Booty and Core", "Kru Nex"),
        ("10:15–11:10", "Beginner", "Kru Nex"),
        ("11:30–12:25", "Full Body Flow", "Kru Nex"),
        ("17:30–18:25", "Beginner", "Kru Nex"),
        ("18:45–19:40", "Full Body Flow", "Kru Nex"),
    ],
    "Friday": [
        ("09:00–09:55", "Jumpboard", "Kru Nex"),
        ("10:15–11:10", "Full Body Flow", "Kru Nex"),
        ("11:30–12:25", "Booty and Core", "Kru Nex"),
        ("17:30–18:25", "Sunset Tone", "Kru Nex"),
    ],
    "Saturday": [
        ("09:00–09:55", "Full Body Flow", "Kru Nex"),
        ("10:15–11:10", "Jumpboard", "Kru Nex"),
        ("11:30–12:25", "Beginner", "Kru Nex"),
        ("17:30–18:25", "Sunset Tone", "Kru Nex"),
        ("18:45–19:40", "Booty and Core", "Kru Nex"),
    ],
    "Sunday": [
        ("09:00–09:55", "Beginner", "Kru Leaw"),
        ("10:15–11:10", "Full Body Flow", "Kru Leaw"),
        ("11:30–12:25", "Booty and Core", "Kru Leaw"),
    ],
}

for day, rows in schedule.items():
    doc.add_heading(day, level=2)
    add_table(
        doc,
        ["Time", "Class", "Trainer", "Studio"],
        [(time, class_name, trainer, "Bophut") for time, class_name, trainer in rows],
        [3.4, 6.8, 4.0, 4.0],
        font_size=8.6,
    )

doc.add_page_break()
doc.add_heading("4. Trainers and where they teach", level=1)
add_table(
    doc,
    ["Trainer", "Bophut regular availability", "Nathon availability", "What we need"],
    [
        ("Kru Yui", "Monday: 09:00, 10:15, 11:30, 17:30\nTuesday: 07:00, 09:00, 10:15, 11:30", "Not supplied", "Confirm whether Yui can take private bookings at either studio"),
        ("Kru Nex", "Wednesday–Friday: four listed classes per day\nThursday: six listed classes\nSaturday: five listed classes", "Not supplied", "Confirm whether Nex can take private bookings at either studio"),
        ("Kru Leaw", "Tuesday: 17:30 and 18:45\nSunday: 09:00, 10:15 and 11:30", "Not supplied", "Confirm whether Leaw can take private bookings at either studio"),
    ],
    [2.5, 7.0, 3.0, 5.7],
    font_size=8.2,
    first_col_bold=True,
)
add_note(
    doc,
    "Important",
    "The timetable proves when each trainer teaches a regular Bophut group class. It does not tell us their private-booking availability or whether they work at Nathon.",
)

doc.add_heading("5. Group class packages", level=1)
add_callout(
    doc,
    "How these products work",
    "These are prepaid class packages with a fixed number of classes and an expiry date. The supplied content does not describe an automatically renewing subscription or membership.",
    PALE_SAGE,
)
add_table(
    doc,
    ["Package", "Price", "What is included", "Validity", "Sharing"],
    [
        ("Introduction Offer", "THB 1,800", "3 group classes", "14 days from purchase", "No sharing; first-time clients only"),
        ("Drop-in", "THB 900", "1 group class", "Booked day only", "No sharing"),
        ("5-Class Package", "THB 4,000", "5 group classes", "30 days from purchase", "Up to 1 class may be shared"),
        ("10-Class Package", "THB 7,500", "10 group classes", "60 days from purchase", "Up to 3 classes may be shared"),
        ("20-Class Package", "THB 14,000", "20 group classes", "90 days from purchase", "Up to 5 classes may be shared"),
        ("30-Class Package", "THB 19,500", "30 group classes", "120 days from purchase", "Up to 15 classes may be shared"),
    ],
    [3.8, 2.8, 4.1, 3.7, 3.8],
    font_size=8.1,
    first_col_bold=True,
)
add_note(
    doc,
    "Sharing",
    "The package owner must attend. They may bring up to two friends to the same class, within the package's total sharing allowance.",
)
add_note(
    doc,
    "Website",
    "These packages should appear clearly on the website with price, class count, expiry, effective price per class and sharing rules.",
)

doc.add_heading("6. Private session prices", level=1)
add_table(
    doc,
    ["Product", "Price", "Validity", "Studio access"],
    [
        ("Private Trial", "THB 1,800", "One session", "Awaiting client answer: Bophut, Nathon or both"),
        ("Private Drop-in", "THB 2,500", "One session", "Awaiting client answer: Bophut, Nathon or both"),
        ("5 Private Sessions", "THB 11,500", "30 days", "Awaiting client answer: Bophut, Nathon or both"),
        ("Additional participant", "+THB 1,000 per person", "Added to the same private session", "Nathon confirmed; Bophut still needs clarification"),
    ],
    [4.2, 3.5, 4.5, 6.0],
    font_size=8.4,
    first_col_bold=True,
)

doc.add_heading("7. Halloween launch classes", level=1)
p = doc.add_paragraph()
style_run(p.add_run("Date: "), 9.6, True, SAGE)
style_run(p.add_run("Saturday 31 October 2026  •  All five classes are free  •  Online booking required"), 9.6)
add_table(
    doc,
    ["Time", "Class", "Trainer", "Length", "Places", "Studio"],
    [
        ("09:00–09:55", "Ghostly Halloween Flow", "Kru Yui", "55 min", "9", "Awaiting answer"),
        ("10:15–11:10", "Spooktacular Booty and Core", "Kru Nex", "55 min", "9", "Awaiting answer"),
        ("11:30–12:25", "First Bite: Beginner Flow", "Kru Leaw", "55 min", "9", "Awaiting answer"),
        ("17:30–18:25", "Witch's First Step: Beginner", "Kru Nex", "55 min", "9", "Awaiting answer"),
        ("18:45–19:45", "Nightmare Night Halloween Flow", "Kru Nex", "60 min", "9", "Awaiting answer"),
    ],
    [2.7, 5.6, 3.1, 2.0, 1.8, 3.0],
    font_size=7.9,
)
add_note(
    doc,
    "Booking details to collect",
    "Full name, phone number, email address and preferred contact channel. Stop confirmed bookings at 9, enable a waitlist and save each booking as a customer contact.",
)

doc.add_heading("8. Opening package gift", level=1)
add_bullet(doc, "Buy any 5-, 10-, 20- or 30-class group package and receive one complimentary 60-minute Thai massage or foot massage.")
add_bullet(doc, "The same gift applies to the 5 Private Sessions package.")
add_bullet(doc, "The massage must be used within 14 days of package purchase.")
add_bullet(doc, "The Introduction Offer, Drop-in, Private Trial and Private Drop-in are excluded.")
add_bullet(doc, "The offer says gifts are limited, but no quantity or end date was supplied.")

doc.add_heading("9. Customer booking rules", level=1)
add_table(
    doc,
    ["Rule", "Customer-facing wording"],
    [
        ("Cancellation", "Cancel or reschedule at least 3 hours before the class. A later cancellation or no-show uses the class/session."),
        ("Refunds", "Packages are non-refundable."),
        ("Transfers", "Packages are non-transferable, apart from the stated group-class sharing allowance."),
        ("Package start date", "Group package validity begins on the purchase date."),
        ("New Reformer clients", "Arrive 10 minutes early and tell the instructor that you are new."),
        ("Grip socks", "Required for safety and hygiene."),
    ],
    [4.0, 14.2],
    font_size=8.7,
    first_col_bold=True,
)

doc.add_page_break()
doc.add_heading("10. Questions MÀLEE needs to answer", level=1)
add_callout(
    doc,
    "How to use this page",
    "Please write an answer beside each question. Once answered, Exsportia can finish the studio calendars, trainer availability, products and website information without guessing.",
)

doc.add_heading("Required before the booking system is completed", level=2)
add_questions(
    doc,
    [
        ("1", "Could you please confirm that MÀLEE should be set up as one venue account containing two studios: Bophut Studio and Nathon Studio?", "This confirms the calendar and location structure."),
        ("2", "Could you please confirm whether the full regular group timetable in this document is for Bophut Studio only?", "This lets us assign every recurring class to the correct studio."),
        ("3", "Could you please clarify whether Bophut also offers private sessions? If it does, should customers choose from fixed appointment slots, choose a time within an availability window, or submit a request for the studio to confirm?", "This tells us whether to use the scheduled-session calendar or the service/appointment module for Bophut."),
        ("4", "Could you please choose how customers should book a private session at Nathon: A) choose a fixed slot such as 09:30 or 11:00; B) choose any available time inside a date and time range; or C) request a preferred time for the studio to confirm?", "The three choices require different VMS setups and create different booking journeys for the customer."),
        ("5", "Could you please clarify the full Nathon private timetable? If the times are fixed, please list every available day and slot. If customers may choose within an availability range, please give the available dates or recurring days, opening and closing times, session length, booking interval and any time needed between sessions.", "This gives us the rules needed to generate the exact dates and times customers may book."),
        ("6", "Could you please confirm which instructors can teach private 1-to-1 and private group sessions at Nathon? For each instructor, please include their available days and times.", "This prevents customers from selecting an instructor who is unavailable at Nathon."),
        ("7", "If Bophut offers private sessions, could you please provide its full private timetable and the available instructors? For a flexible service, please give the working hours, session length, booking interval and buffer between appointments.", "This completes the Bophut private calendar and instructor availability."),
        ("8", "Could you please confirm the length of a private session at each studio? We currently understand that it may be 60 minutes.", "This sets the correct booking duration and prevents appointments from overlapping."),
        ("9", "Could you please confirm where customers may use the Private Trial, Private Drop-in and 5 Private Sessions package: Bophut, Nathon or both studios?", "This controls where each private product can be booked and redeemed."),
        ("10", "Could you please confirm whether customers may choose their preferred instructor for a private session, or whether MÀLEE should assign the instructor after the booking?", "This determines whether instructor selection appears in the booking journey."),
        ("11", "Could you please confirm which studio will host the five free Halloween classes on 31 October?", "This assigns the event and its capacity to the correct location."),
        ("12", "Could you please confirm whether the five Halloween classes should replace the normal Saturday timetable at that studio on 31 October?", "This avoids showing duplicate classes on the calendar."),
    ],
)

doc.add_heading("Questions about products and promotions", level=2)
add_questions(
    doc,
    [
        ("13", "Could you please confirm whether the group products are prepaid class packages only, or whether any should renew automatically as subscriptions or memberships?", "The supplied products currently have fixed class credits and expiry dates, with no automatic renewal stated."),
        ("14", "Could you please confirm whether the older 10 Private Sessions package at THB 20,900, valid for 90 days, should still be sold?", "It appears only in older material and was omitted from the latest private price list."),
        ("15", "Could you please confirm whether the older two-person private promotion at THB 2,500 should still be sold?", "It appears only in older promotional material."),
        ("16", "Could you please clarify how many complimentary massage gifts are available and the final date of the offer?", "This gives the promotion a clear limit and prevents overselling."),
        ("17", "Could you please confirm whether Mat Yoga should be included now? If yes, please provide the studio, class length, capacity, timetable, instructor and price or package access.", "No usable Mat Yoga timetable or price was supplied."),
        ("18", "Could you please confirm the suitable level for Jumpboard: beginner, intermediate, advanced or all levels?", "This lets us show the correct suitability label to customers."),
    ],
)

doc.add_heading("Trainer information needed for the website", level=2)
add_questions(
    doc,
    [
        ("19", "Could you please provide a short biography, qualifications, languages spoken and the classes or private services taught by each instructor?", "This completes the instructor profiles in the VMS and on the website."),
    ],
)

doc.add_page_break()
doc.add_heading("11. Internal instructor compensation — Bophut", level=1)
add_callout(
    doc,
    "Internal information",
    "This section is for studio administration and payroll only. It should not appear on the customer website.",
    SAND,
)
add_table(
    doc,
    ["Paid customers in a Bophut group class", "Instructor payment"],
    [
        ("1–3", "THB 600"),
        ("4", "THB 700"),
        ("5", "THB 800"),
        ("6", "THB 900"),
        ("7", "THB 1,000"),
        ("8", "THB 1,100"),
        ("9", "THB 1,300 maximum"),
    ],
    [10.0, 8.2],
    font_size=8.8,
    first_col_bold=True,
)
add_bullet(doc, "A late cancellation or no-show counts toward instructor payment when the studio collects the booking fee.")
add_bullet(doc, "If nobody is booked, cancel the class at least 3 hours before it starts and notify the trainer; no instructor payment is due.")
add_bullet(doc, "For completed paid private sessions, the instructor receives 40% and the studio receives 60%.")
add_bullet(doc, "A trainer planning to be absent should give 24 hours' notice and arrange an approved substitute.")

doc.add_heading("12. What Exsportia can build once the answers return", level=1)
for item in (
    "Create Bophut Studio and Nathon Studio as separate bookable areas inside the same MÀLEE venue.",
    "Assign capacities: Bophut 9 Reformers; Nathon 6 Reformers.",
    "Create the six Bophut group class types and publish the confirmed weekly timetable.",
    "Create private services and appointment calendars for each confirmed studio.",
    "Create complete trainer availability by studio, day and time.",
    "Create the approved group packages, private products, opening gift and customer rules.",
    "Create the dated Halloween classes at the confirmed studio and suppress any replaced timetable sessions.",
    "Publish the packages, trainer profiles, locations and booking links on the website.",
):
    add_bullet(doc, item)

doc.core_properties.title = "MÀLEE Pilates Studio Setup, Schedule, Prices and Questions"
doc.core_properties.subject = "Human-readable client review and VMS setup document"
doc.core_properties.author = "Exsportia"
doc.core_properties.keywords = "MÀLEE Pilates, Bophut, Nathon, VMS, schedule, pricing, trainers"

doc.save(OUT)
print(OUT)
