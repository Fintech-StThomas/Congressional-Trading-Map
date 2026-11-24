"""Extra street-address rules for the holdings stage: cue-word addresses (A4), liability house numbers (A2L), year-like
house numbers (YR), odd number shapes, ranges and trailing fragments. Used by rules.redact and by the build gate.

A4  : cue word ("on", "at", "secured by", "located at") + house number + street name, any suffix.
A2L : liability text only: house number + name with no cue word ("HEL - 530 Bowsprit"), with the keep-list below.
YR  : a year-like number + name that is a street ("2093 Charlie Chambers", "HELOC 2021 Broadway"): on liability text about
      property and on real-property / located asset segments, with a short allow-list (vehicles, 529 plans).
ODD : number shapes A1/A2 miss ("N2736 S. Buckholz Rd.", "1s651 Verdun Dr").
A business name filed with a house number is NOT kept: "827 JCB, LLC" becomes "[street address redacted], LLC", the same for
assets and liabilities (privacy wins; the entity suffix stays). Rules only remove text; they never infer anything.
"""
from __future__ import annotations

import re

REDACTED = "[street address redacted]"
_R = re.escape(REDACTED)
# Words after a number that make it a quantity, term, plan, bank or date, not a house number.
_NONADDR = (r"shares?|percent|pct|units?|years?|yrs?|yr|months?|mos?|days?|acres?|ac|sq|square|ft|feet|interest|lots?|"
            r"basis|points|pts|bps|index|funds?|etf|plan|stocks?|bonds?|fbo|private|loan|loans|home|credit|card|"
            r"purchase|fd|tax|taxes|annual|return|filing|report|closing|rate|date|value|cost|price|"
            r"college|savings|education|account|accounts|advantage|portfolio|age|"
            r"enrollment|bank|union|federal|financial|fcu|refinance|refi|balance|statement|vehicle|car|auto|truck|boat|payments?|"
            r"income|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|"
            r"nov(?:ember)?|dec(?:ember)?")
# Words after a year-like number that mean a vehicle or a known plan, not a street (reviewed against the real tables).
_YALLOW = (r"toyota|mazda|dodge|chevrolet|chevy|ford|hyundai|honda|nissan|jeep|subaru|kia|bmw|tesla|lexus|volkswagen|audi|gmc|"
           r"buick|cadillac|school|enrollment|enroll|north\s+american")
_SMALL = r"and|or|of|the|for|to|in|at|on|with|by|per|a"      # lower-case only: "44 The Uplands" is a street, "1210 and 1212" is not
_NOTQTY = rf"(?i:(?!(?:{_NONADDR})\b))(?!(?:{_SMALL})\b)"
_YEAR = r"(?:(?:19|20)\d\d|529)"
_NUM = r"(?:(?!(?:19|20)\d\d\b)(?!529\b)\d{1,6}(?:[A-Za-z]\d{1,5}|[A-Za-z]\b)?(?![\d/%.,]*\d)(?![/%])"
_NUM += rf"|{_YEAR}(?=\s+(?!(?i:{_NONADDR}|{_YALLOW})\b)(?!(?:{_SMALL})\b)[A-Za-z]))"          # a year-like number before a name
_RANGE = r"(?:\d{1,6}[A-Za-z]?\s*[-&/]\s*)?"
_WORD = r"(?:[A-Z][A-Za-z'.\-]*|\d{1,3}(?:st|nd|rd|th)\b)"
_FIRST = r"(?:[A-Za-z][A-Za-z0-9'.\-]*|\d{1,3}(?:st|nd|rd|th)\b)"       # a name starts with a letter or is an ordinal
_CUE = r"\b((?i:located\s+at|secured\s+by|on|at)\s+)"
A4 = re.compile(rf"{_CUE}(?:{_RANGE}{_NUM},?\s+{_NOTQTY}{_FIRST}(?:\s+{_WORD}){{0,2}}"
                rf"|\d{{1,6}}\s*-\s*\d{{1,3}}(?:st|nd|rd|th)\b(?:\s+{_WORD}){{0,2}})")
# A4_STRONG: the asset-text form for segments that do not name real property: only "secured by" / "located at" count
# ("NYSE AT 100 IS" is not an address).
A4_STRONG = re.compile(A4.pattern.replace("(?i:located\\s+at|secured\\s+by|on|at)", "(?i:located\\s+at|secured\\s+by)"))
_SUFFIX = (r"street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl|circle|cir|terrace|ter|"
           r"highway|hwy|parkway|pkwy|trail|trl|square|sq|pike|loop|alley|crescent|plaza")
# A4N: cue + house number(s) with no street name but a city after ("Rental Property at 1035 and 1036 in Georgetown, TX").
A4N = re.compile(rf"{_CUE}(?!{_YEAR}\b)\d{{3,5}}(?:\s*(?:and|&|/|-)\s*\d{{3,5}})*(?=\s+in\s+[A-Z]|,?\s+[A-Z][a-z]+,\s*[A-Z]{{2}}\b)")
# ORD: a house-number range then an ordinal street with a suffix ("1830-11th St.").
ORD = re.compile(rf"(?<![\w$#.,/(%-])\d{{1,6}}\s*-\s*\d{{1,3}}(?i:st|nd|rd|th)\s+(?i:{_SUFFIX})\b\.?")
# ODD: letter-led or letter-inside house numbers with a street suffix ("N2736 S. Buckholz Rd.", "E31 Quest Verde St").
ODD = re.compile(rf"\b(?:[A-Za-z]\d{{2,6}}|\d{{1,3}}[A-Za-z]\d{{2,5}})\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9'.\-]+\s+){{0,3}}?"
                 rf"(?i:{_SUFFIX})\b\.?")
# A2L: a house number and a name in liability text. Not after $ # . , / % -, not 401K/403b or "Box 123", not a quantity or term.
_CAPS = r"(?:\s+(?!(?:LLC|LP|LLP|Inc|Ltd|Corp|Co|Trust)\b)[A-Z][A-Za-z'.\-]+){0,2}"
A2L = re.compile(rf"(?<![\w$#.,/%-])(?i:(?<!box\s)){_RANGE}(?!{_YEAR}\b)\d{{2,6}}(?![kKbB]\b)[A-Za-z]?(?:\s+\d/\d)?\s+{_NOTQTY}"
                 rf"(?:[NSEW]\.?\s+\d{{1,3}}(?:st|nd|rd|th)?\b{_CAPS}"
                 rf"|(?:[NSEW]\.?\s+)?(?:[A-Za-z]|(?i:\d{{1,3}}(?:st|nd|rd|th)\b))[A-Za-z0-9'.\-]*{_CAPS})")
# YR: a year-like number + capitalised name. Liability text: only on a row about property. Asset segments: only when the year
# starts the segment or follows a comma, dash, "Acres" or a property word ("30 Acres 2000 Blackjack", "Condo 2021 Broadway").
_YNAME = rf"(?!(?i:{_NONADDR}|{_YALLOW})\b)(?!(?:{_SMALL})\b)(?:[NSEW]\.?\s+)?[A-Z][A-Za-z'.\-]+{_CAPS}"
YR_LIAB = re.compile(rf"(?<![\w$#.,/%-])(?:19|20)\d\d\s+{_YNAME}")
_PROP_WORD = r"(?i:(?<=condo\s)|(?<=house\s)|(?<=land\s)|(?<=lot\s)|(?<=home\s)|(?<=duplex\s)|(?<=building\s)|(?<=property\s)|(?<=rental\s))"
YR_SEG = re.compile(rf"(?:^|(?<=[,\-–]\s)|(?<=[,\-–])|(?i:(?<=acres\s)|(?<=acre\s))|{_PROP_WORD})(?:19|20)\d\d\s+{_YNAME}")
# A bare trailing number on a row about property, where the source cut the address off ("rental property, 4609").
_PROPERTY = re.compile(r"\b(?:mortgage|mortage|morgage|equity|heloc|residence|homestead|property|rental|real estate|line of credit)\b",
                       re.I)
TAIL = re.compile(rf"(?<=[A-Za-z)])(?<![A-Z]{{2}})(?:\s*[,:;.\-]+\s*|\s+)(?!{_YEAR}\s*[,.]?$)\d{{3,6}}(?:\s*[/&-]\s*\d{{2,6}})?\s*[,.]?$")
# A house number or range left directly before a redaction token ("N2736 [street...]", "1702-[street...]", "1612 & [street...]").
_BEFORE = re.compile(rf"(?<![\w$#.,/%-])[A-Za-z]?\d+[A-Za-z]?\d*(?:\s*[-&/]\s*\d+[A-Za-z]?)*\s*[-&/]?\s*(?={_R})")
_AND_BEFORE = re.compile(rf"(?<![\w$#.,/%-])\d{{2,6}}[A-Za-z]?\s+(?:and|&)\s+(?={_R})")
_LOT_LIST = re.compile(r"\blots?\b[^⇒]*$", re.I)
_AFTER = re.compile(rf"(?<={_R})(?:\s*,?\s*(?:[NSEW]{{1,2}}\b\.?)?\s*,?\s*(?:(?:unit|apt|apartment|suite|ste)\b\.?|#)\s*[A-Za-z0-9\-]+)",
                    re.I)
# one-digit house number alone as a name on a real-property segment ("9 Jefferson"); two or more words are kept.
_ONE_DIGIT = re.compile(rf"^\d\s+{_NOTQTY}[A-Z][a-z]{{3,}}$")


def _sub(pat: re.Pattern[str], text: str) -> str:
    return pat.sub(lambda m: (m.group(1) if pat in (A4, A4_STRONG, A4N) else "") + REDACTED, text)


def redact_extended(text: str, liability: bool, real_segment: bool) -> str:
    """Apply the rules above to one text segment (after A1). `liability`: liability type/creditor text."""
    out = _sub(ORD, _sub(ODD, text))
    out = _sub(A4 if liability or real_segment else A4_STRONG, out)
    if liability or real_segment:
        out = _sub(A4N, out)
    if liability:
        out = _AFTER.sub("", _sub(A2L, out))
        if _PROPERTY.search(out):
            out = TAIL.sub(" " + REDACTED, _sub(YR_LIAB, out))
    elif real_segment:
        out = _sub(YR_SEG, out)
        if _ONE_DIGIT.match(out.strip()):
            out = REDACTED
    return tidy(out)


def tidy(text: str) -> str:
    """Absorb a house number/range left before a redaction token and a unit fragment left after it."""
    out = _AND_BEFORE.sub(lambda m: m.group(0) if _LOT_LIST.search(text[:m.start()]) else "", text)   # "1210 and [..]"
    return _AFTER.sub("", _BEFORE.sub("", out))
