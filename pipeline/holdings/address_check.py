"""Build-gate checks for published holdings text. `problems()` runs every predicate the validator applies: the suffix rule
A1, the cue-word rule (the same segment logic the redactor uses) and an independent broad check, `residual_address`.

The broad check shares no pattern with the redaction rules (address_rules.py, rules.A1-A3). It looks for the shape
"number + name" in all liability text and in real-property / located asset segments, and ignores only the keep-list below.

Keep-list (a hit is NOT reported when):
  K1 the number is a year 1900-2099 or starts with 529, unless a capitalised word that is not a quantity word, vehicle make
     or allow-listed phrase (YEAR_ALLOW) follows it ("2093 Charlie Chambers", "HELOC 2021 Broadway", "on 1950 broadway")
  K2 the number is an ordinal ("2nd Mortgage", "11th St"): street names without a house number are not addresses here
  K3 the next word is a quantity, term, fund, plan, bank, month or tax word (KEEP_WORDS); "Box 123" (PO box) is kept
  K4 the number is one digit ("4 Fox Run", "5 Stones"), unless it follows on/at/by or is the whole segment ("9 Jefferson")
  K5 the number is a short code glued to letters ("1A", "B3VA", "H2O", "3Strands") or is followed by an upper-case code
     of up to four letters when it has at most three digits ("33 SW", "97 FBO", "29 HSL")
  K5b "R2000"-style Russell index codes
  The gate also reports "NNN and|& <number or redaction token>" unless lot(s) precede ("Lots, 44 and 45") and a cue followed
  by house numbers and "in <City>" ("at 1035 and 1036 in Georgetown, TX").
  K6 it follows $ # . , / - or "(" before a percentage (decimals, amounts, ids, highway "321/74 Bypass"), except the end of a
     range "211-213 Pender"; "(2640 Broadway)" is reported
There is no entity keep: "827 JCB, LLC" must be redacted like any other house number and name.
YEAR_ALLOW (reviewed against the real tables): vehicle makes, "School Bus", 529 "Enrollment" plans, "North American" aircraft,
"FFN 2008 Warranty", "NTS 2013 Erwin", "SC 2024 Revitalization Tax Credit Fund". Liability text is checked for a
year-led name only when the text is about property.
"""
from __future__ import annotations

import re

from . import rules

BROAD = re.compile(r"\b([A-Za-z]?\d[\dA-Za-z]*)\s+(?:[NSEW]\.?\s+)?([A-Za-z][A-Za-z]+|\d{1,3}(?:st|nd|rd|th)\b)")
KEEP_WORDS = frozenset(
    "acre acres int interest undivided share shares yr yrs year years month months age aged plan fund funds portfolio "
    "enrollment enroll enrolled account accounts index lot lots loan loans private fbo moderate moderately aggressive "
    "conservative growth income short long total term prepaid savings college education direct advantage guaranteed "
    "fixed preservation target extended scholars series ownership and or of the for to in at on with by per a "
    "mo mos pct day days points point bps basis pts ac sq square ft feet stocks bond bonds option usd percent plex sec blk "
    "unit units tax taxes annual return filing report closing rate date value cost price purchase fd stock etf card credit "
    "home bank union federal financial fcu refinance refi balance statement "
    "vehicle car auto truck boat payment payments january february march april may june july august september october "
    "november december jan feb mar apr jun jul aug sep sept oct nov dec".split())
# Kept only in lower case: "The Uplands" is a street.
SMALL_WORDS = frozenset("and or of the for to in at on with by per a".split())


def _kept(name: str) -> bool:
    return name.lower() in KEEP_WORDS and (name.lower() not in SMALL_WORDS or name == name.lower())
YEAR_ALLOW = re.compile(r"^(?:toyota|mazda|dodge|chevrolet|chevy|ford|hyundai|honda|nissan|jeep|subaru|kia|bmw|tesla|lexus|"
                        r"volkswagen|audi|gmc|buick|cadillac|school|north american|warranty|erwin|revitalization)\b", re.I)
_ABOUT_PROPERTY = re.compile(r"mortgage|equity|heloc|residence|homestead|property|rental|real estate|line of credit", re.I)
_CUE = re.compile(r"\b(?:on|at|by)\s+$", re.I)
_RANGE_BEFORE = re.compile(r"\d{3,}-$")
_ORDINAL = re.compile(r"^\d+(?:st|nd|rd|th)$", re.I)
_CODE = re.compile(r"^(?:[A-Za-z]\d{1,2}(?:[A-Za-z]{1,2}\d?)?|\d{1,2}[A-Za-z]{1,2}\d?|\d+[A-Za-z]{3,})$")


_AND_NUM = re.compile(r"(?<![\w$#.,/%-])(?!(?:19|20)\d\d\b)(?:\d{3,6}[A-Za-z]?\s+(?:and|&)\s+\d{2,6}\b|"
                      r"\d{2,6}[A-Za-z]?\s+(?:and|&)\s+\[street address redacted\])")
_LOT_LIST = re.compile(r"\blots?\b[^⇒]*$", re.I)
_CUE_NUM_CITY = re.compile(r"\b(?:on|at|by)\s+(\d{3,5}(?:\s*(?:and|&|/|-)\s*\d{3,5})*)\s+in\s+[A-Z]", re.I)


def residual_address(text: str | None, liability: bool = False) -> list[str]:
    """The tokens of `text` that still look like a house number followed by a name, minus the keep-list."""
    text = text or ""
    out: list[str] = []
    out += [m.group(0) for m in _AND_NUM.finditer(text) if not _LOT_LIST.search(text[:m.start()])]     # "1210 and 1212 ..."
    out += [m.group(0) for m in _CUE_NUM_CITY.finditer(text) if not re.fullmatch(r"(?:19|20)\d\d", m.group(1))]
    for m in BROAD.finditer(text):
        num, name = m.group(1), m.group(2)
        before, pre = text[max(0, m.start() - 1):m.start()], text[:m.start()]
        digits = re.sub(r"\D", "", num)
        cue = bool(_CUE.search(pre))
        cued = cue or text.split("⇒")[-1].strip() == m.group(0).strip()
        if re.fullmatch(r"(?:19|20)\d\d", num) or num.startswith("529"):
            rest = text[m.start(2):]
            if (num.startswith("529") or name.isupper() and len(name) <= 4) and not cue:
                continue                                              # 529 plans; short upper-case codes ("2024 SC")
            if _kept(name) or YEAR_ALLOW.match(rest) or not (name[0].isupper() or cue) or (before and before in "/$#."):
                continue
            if liability and not (cue or _ABOUT_PROPERTY.search(text)):
                continue
            out.append(m.group(0))
            continue
        if _ORDINAL.match(num) or _CODE.match(num) and not num.isdigit() or len(digits) == 1 and num.isdigit() and not cued:
            continue
        range_end = before == "-" and _RANGE_BEFORE.search(pre)
        paren_pct = before == "(" and re.match(r"[\d.\s/]+%", text[m.start():])
        if before and before in "$#.,/-" and not range_end or paren_pct or _kept(name) or pre.lower().endswith("box "):
            continue
        if re.fullmatch(r"R\d{4}", num):                      # Russell index codes (R2000)
            continue
        if len(num) <= 3 and num.isdigit() and name.isupper() and len(name) <= 4:
            continue
        out.append(m.group(0))
    return out


def residual_in_row(text: str | None, is_liability: bool, has_location: bool, real_estate: re.Pattern[str]) -> list[str]:
    """Residual tokens for a published liability field (whole text) or an asset (segments that name real property, or the
    last segment of a row that has a location)."""
    if is_liability:
        return residual_address(text, True)
    segs = (text or "").split("⇒")
    hits: list[str] = []
    for i, seg in enumerate(segs):
        if real_estate.search(seg) or (has_location and i == len(segs) - 1):
            hits += residual_address(seg)
    return hits


def problems(text: str | None, liability: bool, has_location: bool = False) -> list[str]:
    """Every validator predicate over one published text field; an empty list means it passes."""
    out = []
    if rules.A1.search(text or ""):
        out.append("A1 street address")
    if rules.cued_residual(text, True, has_location, liability):
        out.append("cue-word address")
    out += [f"gate: {h}" for h in residual_in_row(text, liability, has_location, rules.REAL_ESTATE)]
    return out
