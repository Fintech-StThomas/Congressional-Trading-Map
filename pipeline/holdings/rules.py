"""Explicit, documented text rules for the holdings stage (owner mapping, residences, address redaction).

Every rule here is listed in docs/data-dictionary.md ("Holdings and net worth"). Rules only ever remove
information (redact, exclude) or label it; they never infer a value, ticker or owner.
"""
from __future__ import annotations

import re

# Dataset owner -> contract owner. The House form prints SP / JT / DC in the owner column and nothing for the
# filer; the dataset maps a blank column AND any unrecognised text to "self" (recipe/schema.py norm_owner), so
# its "self" cannot be told apart from "not stated". We publish it as "unspecified" (never defaulted to self).
OWNER = {"spouse": "spouse", "joint": "joint", "child": "dependent", "self": "unspecified"}

# Personal residences and non-rental second homes are not reportable on Schedule A (House instruction guide,
# Schedule A exclusions). Some filers list them anyway; we never publish them and count the rows.
_RESIDENCE = re.compile(
    r"\b(?:personal|primary|principal|family|private|vacation|second|summer|weekend)\s+(?:residence|home|house|dwelling)\b"
    r"|\bresidence\b|\bhomestead\b", re.I)
_INCOME_PROPERTY = re.compile(r"\b(?:rent|rental|rented|rents|lease|leased|investment|income|reit)\b", re.I)


def is_personal_residence(asset: str, income_type: str | None) -> bool:
    if not _RESIDENCE.search(asset or ""):
        return False
    return not (_INCOME_PROPERTY.search(asset or "") or (income_type and re.search(r"rent", income_type, re.I)))


# Liabilities secured by a personal residence: Members must report them on Schedule D although the residence
# itself is not an asset on Schedule A, so they are listed but kept out of the net-worth range.
_RES_DEBT = re.compile(
    r"\b(?:personal|primary|principal|family|vacation|second)\s+(?:residence|home)\b|\bresidence\b|\bhome\s+equity\b"
    r"|\bheloc\b|\bhome\s+mortgage\b|\bmortgage\s+on\s+(?:my|our|the)?\s*home\b|\bhome\s+loan\b|\bhomestead\b", re.I)
_RES_DEBT_NOT = re.compile(r"\b(?:rent|rental|rented|investment|commercial|farm|business|income)\b", re.I)


def is_residence_debt(creditor: str, kind: str) -> bool:
    text = f"{kind or ''} {creditor or ''}"
    return bool(_RES_DEBT.search(text)) and not _RES_DEBT_NOT.search(text)


# Real property (investment real estate) rows: published at city/state granularity at most.
REAL_ESTATE = re.compile(
    r"\b(?:rental|real estate|real property|property|properties|land|acre|acres|farm|farmland|ranch|lot|lots|condo|"
    r"condominium|house|duplex|triplex|townhouse|apartment|apartments|building|residential|commercial|parcel|"
    r"timberland|mortgage)\b", re.I)
_SUFFIX_ALL = (r"street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl|circle|cir|"
               r"terrace|ter|highway|hwy|parkway|pkwy|trail|trl|square|sq|pike|loop|alley|crescent|plaza")
_SUFFIX_SAFE = r"street|avenue|ave|road|rd|lane|ln|boulevard|blvd|highway|hwy|parkway|pkwy|drive|terrace|court|circle"
_NO_HOUSE_NO = r"(?!(?:acres?|ac\b|units?|shares?|percent|sq|square|ft|feet|%|interest|lots?)\b)"
# A1, every row: house number + up to four words + street suffix ("1600 Pennsylvania Ave", "12 N. Main St.").
A1 = re.compile(rf"\b\d{{1,6}}[A-Za-z]?\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9'.\-]+\s+){{0,4}}?(?:{_SUFFIX_ALL})\b\.?", re.I)
# A2, real-property rows: a house number followed by a name ("5214 29th", "169 Crystal Dew"); years are kept.
A2 = re.compile(rf"\b(?!(?:19|20)\d\d\b)(?!529\b)\d{{2,6}}[A-Za-z]?\s+{_NO_HOUSE_NO}[A-Za-z0-9][A-Za-z0-9'.\-]*"
                rf"(?:\s+[A-Z][A-Za-z'.\-]+){{0,2}}")
# A3, real-property rows: a street name without a number ("JOHNSTOWN ROAD", "East 92nd Street").
A3 = re.compile(rf"\b(?:(?:North|South|East|West|NORTH|SOUTH|EAST|WEST|N|S|E|W)\.?\s+)?(?:[A-Z0-9][A-Za-z0-9'.\-]*\s+){{1,2}}"
                rf"(?i:{_SUFFIX_SAFE})\b\.?")
REDACTED = "[street address redacted]"


# Minors only. Adults named in public filings are published as filed (IRAs "FBO" an adult, spouse or member names,
# trusts named after adults). A beneficiary's name is replaced by NAME_REDACTED only when the row itself indicates a
# minor (`minor_rule`):
#   custodial  - a custodial account form: UTMA, UGMA, UTA (not "UTA DTD", a trust agreement), "custodian (for)",
#                "cust", "minor" / "a minor";
#   education  - a 529 or education-savings account (529, Coverdell, ESA, "education savings") naming a beneficiary;
#   dependent  - any row whose owner is filed as a dependent child (the House form's "DC").
# On those rows the name after FBO / f/b/o / "for the benefit of" / "custodian for" / "beneficiary", and a
# "First [M.] Last" name directly before UTMA / UGMA / UTA, are redacted; on dependent-child rows every person-shaped
# name in an account title (a path segment before the last "⇒") is redacted too. The owner column still says whose
# asset it is.
NAME_REDACTED = "[name redacted]"
_ACCOUNT_WORD = r"(?:IRA|ROTH|UTA|UTMA|UGMA|TRUST|TR|ACCOUNT|ACCT|CASH|BNY|529|PLAN|FUND|LLC|INC)\b"
_NAME = rf"(?!{_ACCOUNT_WORD})[A-Z][A-Za-z'.\-]*(?:\s+(?!{_ACCOUNT_WORD})[A-Z][A-Za-z'.\-]*){{0,3}}"
_NOT_A_NAME = (r"(?!(?:minor|dc\d*|dependent|child|children|son|daughter|kids?|grandchild(?:ren)?|beneficiary|"
               r"beneficiaries|ira|trust|account|acct|college|education|529|the|cash|bny)\b)")
B1 = re.compile(rf"\b(FBO|F/B/O|for the benefit of|for benefit of|custodian for|cust\.? for|beneficiary)([\s:\-]+){_NOT_A_NAME}(?=[A-Z])({_NAME})",
                re.I)
# "UTA" alone is ambiguous: "UTA DTD 6/11/93" is "under trust agreement dated", not a transfers-to-minors account.
B2 = re.compile(r"\b(?!(?:Raymond James|Dependent Child|Edward Jones|Morgan Stanley|Charles Schwab|Wells Fargo|Merrill Lynch)\b)"
                r"(?!(?:Revocable|Irrevocable|Living|Family|Marital|Credit|Charitable|Trust|Stanley|James|Jones|Schwab|Fargo|Lynch|Child)\b)"
                r"[A-Z][a-z]+(?:\s+(?:[A-Z]\.?|[A-Z][a-z]+))?\s+(?!Trust\b)[A-Z][a-z]+(?=\s+(?:UTMA|UGMA|UTA(?!\s*(?:DTD|DATED|U/?A)\b))\b)")
CUSTODIAL = re.compile(r"\b(?:UTMA|UGMA|UTA(?!\s*(?:DTD|DATED|U/?A)\b)|custodian|cust|minor)\b", re.I)
EDUCATION = re.compile(r"\b(?:529|Coverdell|ESA|education savings)\b", re.I)
# words that make a capitalised run an institution or account, not a person (dependent-child account titles)
_NOT_PERSON = {
    "IRA", "ROTH", "UTA", "UTMA", "UGMA", "TRUST", "TR", "ACCOUNT", "ACCT", "CASH", "BNY", "PLAN", "FUND", "FUNDS", "LLC",
    "INC", "BANK", "BROKERAGE", "SCHWAB", "FIDELITY", "VANGUARD", "STANLEY", "MORGAN", "JONES", "EDWARD", "JAMES",
    "RAYMOND", "LYNCH", "MERRILL", "FARGO", "WELLS", "CHARLES", "REVOCABLE", "IRREVOCABLE", "LIVING", "FAMILY",
    "SAVINGS", "COLLEGE", "JOINT", "CUSTODIAL", "INDIVIDUAL", "INVESTMENT", "INVESTMENTS", "SECURITIES", "RETIREMENT",
    "PORTFOLIO", "MONEY", "MARKET", "MUTUAL", "GROUP", "CAPITAL", "FINANCIAL", "AMERICAN", "AMERITRADE", "TD",
    "DEPENDENT", "CHILD", "BROKER", "BROKERS", "EDUCATION", "ACCOUNTS", "STOCK", "STOCKS", "BONDS", "BOND", "ETRADE",
    "ROBINHOOD", "VOYA", "TIAA", "CREF", "PRUDENTIAL", "NATIONAL", "FIRST", "UNITED", "STATES", "STATE", "AMERICA",
    "CORP", "CO", "COMPANY", "CHASE", "CITI", "CITIBANK", "UBS", "PERSHING", "JANNEY", "BAIRD", "STIFEL", "NUVEEN",
    "INVESCO", "PIMCO", "BLACKROCK", "ISHARES", "SPDR", "PLC", "LTD", "LP", "HOLDINGS", "PARTNERS", "MANAGEMENT",
    "ADVISORS", "WEALTH", "ASSET", "ASSETS", "OF", "AND", "THE", "FOR", "DC", "SPOUSE", "SELF", "UNIFORM", "GIFT", "GIFTS",
    "TRANSFER", "TRANSFERS", "TO", "MINORS", "MINOR", "ACT"}
_RUN = re.compile(r"\b[A-Z][A-Za-z'\-]*\.?(?:\s+[A-Z][A-Za-z'\-]*\.?){1,3}")


def _b1(m: re.Match[str]) -> str:
    return f"{m.group(1)}{m.group(2)}{NAME_REDACTED}"


def _person_runs(seg: str) -> str:
    """Replace person-shaped capitalised runs (2-4 words, none an institution/account word) with NAME_REDACTED."""
    def sub(m: re.Match[str]) -> str:
        out: list[str] = []
        group: list[str] = []
        for w in m.group(0).split() + [""]:
            if w and w.strip(".").upper() not in _NOT_PERSON:
                group.append(w)
                continue
            out += [NAME_REDACTED] if len(group) >= 2 else group
            group = []
            if w:
                out.append(w)
        return " ".join(out)
    return _RUN.sub(sub, seg)


def minor_rule(text: str | None, owner: str | None = None) -> str | None:
    """Which minor indicator the row carries ("dependent", "custodial", "education"), or None (publish as filed)."""
    if owner == "dependent":
        return "dependent"
    if not text:
        return None
    if CUSTODIAL.search(text):
        return "custodial"
    if EDUCATION.search(text):
        return "education"
    return None


def redact_beneficiary(text: str | None, owner: str | None = None) -> tuple[str | None, str | None]:
    """Redact a minor's name (see NAME_REDACTED above). `owner` is the published owner value ("dependent" for a
    dependent child). Returns (text, the rule that removed something, or None when nothing was removed)."""
    rule = minor_rule(text, owner)
    if not text or rule is None:
        return text, None
    out = B2.sub(NAME_REDACTED, B1.sub(_b1, text))
    if rule == "dependent":
        parts = out.split("⇒")
        if len(parts) > 1:
            out = "⇒".join([_person_runs(p) for p in parts[:-1]] + [parts[-1]])
    return (out, rule) if out != text else (text, None)


_FUNDISH = re.compile(r"\b(?:529|plan|fund|funds|portfolio|account|ira|401k|trust|bond|bonds|annuity|policy|"
                      r"insurance|savings|money market|etf|stock|shares)\b", re.I)


def _redact_one(text: str, real_property: bool) -> str:
    out = A1.sub(REDACTED, text)
    if real_property:
        out = A2.sub(REDACTED, out)
        out = A3.sub(lambda m: m.group(0) if m.group(0).startswith("[") else REDACTED, out)
    return re.sub(rf"(?:{re.escape(REDACTED)}[\s,;-]*){{2,}}", REDACTED + " ", out).strip()


def redact(text: str | None, real_property: bool, has_location: bool = False) -> tuple[str | None, bool]:
    """Remove street addresses. Account paths ("Trust ⇒ Broker ⇒ Asset") are handled one segment at a time: the
    looser patterns A2/A3 apply only to a segment that names real property, or to the last segment of a row the
    form gives a Location for, unless that segment names a fund, plan or account (529 plans print a state).
    Returns (text, whether anything was removed)."""
    if not text:
        return text, False
    parts = text.split("⇒")
    out = []
    for i, seg in enumerate(parts):
        rp = real_property and (bool(REAL_ESTATE.search(seg)) or
                                (has_location and i == len(parts) - 1 and not _FUNDISH.search(seg)))
        red = _redact_one(seg.strip(), rp)
        out.append(red)
    joined = " ⇒ ".join(out)
    return (text, False) if joined == " ⇒ ".join(p.strip() for p in parts) else (joined, True)


def city_state(location: str | None) -> tuple[str | None, bool]:
    """The dataset's 'Location' subfield ("Houston, TX, US") cut to "City, ST"; anything finer is dropped."""
    if not location:
        return None, False
    parts = [p.strip() for p in location.split(",") if p.strip()]
    if parts and parts[-1].upper() in {"US", "USA"}:
        parts = parts[:-1]
    keep = parts[-2:]
    out = ", ".join(keep)
    out2, hit = redact(out, True)
    return out2, hit or len(parts) > 2
