"""Strict member identification for LDA free text (LD-203 honorees/payees, LD-2 covered positions).

Nothing here is fuzzy. A string names a member only when
  * (payee rule) its normalised form equals the normalised name of an FEC committee authorised by, or a leadership
    PAC sponsored by, exactly one member; or
  * (name rule) after titles are stripped it equals, as a person-name key, one full name of exactly one member
    serving in the relevant year(s). Surname-only strings never match (a key needs at least two words) and a key
    shared by two serving members matches neither.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from ..util import normalise_name

# Titles and honorifics stripped from the front of an honoree string (as words after person-normalisation).
TITLE_WORDS = {
    "SEN", "SENATOR", "SENATORS", "REP", "REPS", "REPRESENTATIVE", "CONGRESSMAN", "CONGRESSWOMAN", "CONGRESSPERSON",
    "CONGRESSMEMBER", "HON", "HONORABLE", "THE", "DEL", "DELEGATE", "RESIDENT", "COMMISSIONER", "SPEAKER", "LEADER",
    "MAJORITY", "MINORITY", "REPUBLICAN", "DEMOCRATIC", "ASSISTANT", "WHIP", "CHAIRMAN", "CHAIRWOMAN", "CHAIR",
    "RANKING", "MEMBER", "VICE", "US", "MR", "MRS", "MS", "MISS", "DR", "SENATE", "HOUSE", "OF",
    "CONGRESS", "CONGRESSIONAL", "AND",
}
SUFFIX_WORDS = {"JR", "SR", "II", "III", "IV", "V"}
# Explicit office titles for covered positions; a match without one of these is `weak`.
OFFICE_RE = re.compile(r"\b(SEN|SENATOR|REP|REPRESENTATIVE|CONGRESSMAN|CONGRESSWOMAN|CONGRESSMEMBER|DELEGATE|DEL|"
                       r"OFFICE OF|LEADER|SPEAKER|WHIP)\b")
COMMITTEE_RE = re.compile(r"\b(COMMITTEE|SUBCOMMITTEE|CAUCUS|CONFERENCE|COMMISSION)\b")


def person_key(text: str) -> str:
    """Accents removed, uppercase, periods/apostrophes deleted, hyphens and other punctuation become spaces."""
    t = unicodedata.normalize("NFKD", text or "")
    t = "".join(c for c in t if not unicodedata.combining(c)).upper()
    t = re.sub(r"\([^)]*\)", " ", t)              # "(R-SD)" and similar annotations
    t = re.sub(r"[.'’`]", "", t)
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", t).split())


def strip_titles(key: str) -> str:
    words = key.split()
    while words and words[0] in TITLE_WORDS:
        words.pop(0)
    return " ".join(words)


def split_suffix(key: str) -> tuple[str, str | None]:
    words = key.split()
    if len(words) > 2 and words[-1] in SUFFIX_WORDS:
        return " ".join(words[:-1]), words[-1]
    return key, None


def honoree_key(text: str) -> str:
    return strip_titles(person_key(text))


def name_keys(names: list[str], suffix: str | None = None) -> set[str]:
    """Every exact key a member answers to: each full name with its suffix (if any), and without it."""
    out = set()
    for n in names:
        k = person_key(n)
        if not k:
            continue
        base, sfx = split_suffix(k)
        sfx = sfx or (person_key(suffix) if suffix else None)
        out.add(base)
        if sfx:
            out.add(f"{base} {sfx}")
    return {k for k in out if len(k.split()) >= 2}


def fec_person_name(cand_name: str) -> str | None:
    """'THUNE, JOHN R MR.' -> 'JOHN R THUNE'. Returns None for anything not in LAST, FIRST form."""
    if "," not in (cand_name or ""):
        return None
    last, _, rest = cand_name.partition(",")
    rest_words = [w for w in person_key(rest).split() if w not in {"MR", "MRS", "MS", "DR", "HON", "SEN", "REP"}]
    sfx = [w for w in rest_words if w in SUFFIX_WORDS]
    given = [w for w in rest_words if w not in SUFFIX_WORDS]
    if not given:
        return None
    return " ".join([*given, person_key(last), *sfx])


@dataclass
class Member:
    bio: str
    name: str
    keys: set[str]
    years: set[int]


@dataclass
class Matcher:
    members: dict[str, Member]
    committee_names: dict[str, set[str]] = field(default_factory=dict)  # normalised cmte name -> bioguides
    other_committee_names: set[str] = field(default_factory=set)       # FEC committees tied to no member
    _by_key: dict[str, set[str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for m in self.members.values():
            for k in m.keys:
                self._by_key.setdefault(k, set()).add(m.bio)

    def by_name(self, key: str, years: set[int]) -> tuple[str | None, str]:
        """(bioguide, outcome) for an already title-stripped key; outcome explains a non-match."""
        if len(key.split()) < 2:
            return None, "surname_only" if key else "empty"
        cands = self._by_key.get(key, set())
        serving = {b for b in cands if self.members[b].years & years}
        if len(serving) == 1:
            return next(iter(serving)), "name"
        if len(serving) > 1:
            return None, "ambiguous_name"
        return None, "not_serving" if cands else "no_member"

    def by_committee(self, payee: str) -> tuple[str | None, str]:
        n = normalise_name(payee or "")
        if not n:
            return None, "empty"
        bios = self.committee_names.get(n)
        if bios and len(bios) == 1:
            return next(iter(bios)), "payee_committee"
        if bios:
            return None, "ambiguous_committee"
        if n in self.other_committee_names:
            return None, "other_committee"
        return None, "no_committee"

    def contribution(self, payee: str, honoree: str, year: int) -> tuple[str | None, str]:
        """Member for an LD-203 item. The payee rule wins; the honoree rule is used when the payee is not an FEC
        committee at all (a payee that is another FEC committee, e.g. a party or joint fundraising committee, is
        not money to the honoree). Disagreement between the rules leaves the item unmatched."""
        pb, pout = self.by_committee(payee)
        hb, hout = self.by_name(honoree_key(honoree or ""), {year})
        if not hb and (honoree or "").count(",") == 1 and ";" not in honoree:
            last, first = honoree.split(",")          # "Thune, John" (LAST, FIRST as on FEC lists)
            hb2, hout2 = self.by_name(honoree_key(f"{first} {last}"), {year})
            if hb2 or hout2 == "ambiguous_name":
                hb, hout = hb2, hout2
        if pb and hb and pb != hb:
            return None, "conflict"
        if pb:
            return pb, "payee_committee"
        if pout in ("other_committee", "ambiguous_committee"):
            return None, f"payee_{pout}"
        if hb:
            return hb, "honoree_name"
        # the payee string itself may be a person ("Senator John Thune" written as payee)
        pb2, _ = self.by_name(honoree_key(payee or ""), {year})
        if pb2:
            return pb2, "payee_name"
        return None, f"honoree_{hout}"

    def positions(self, text: str, years: set[int]) -> tuple[list[tuple[str, bool, str]], str]:
        """Members named in a covered-position text: [(bioguide, weak, segment)], plus an outcome.
        The text is split into segments on ';', ',', '/', ' and '. A segment that mentions a committee is never
        attributed. In each remaining segment the words after the last office title (or the whole segment) must be
        exactly one member's full-name key; `weak` when the segment carries no explicit office title."""
        found: list[tuple[str, bool, str]] = []
        outcome = "no_member"
        raw = re.split(r"[;,/]|\s-\s|\bAND\b|\bFOR\b|\bTO\b", person_key_keep(text))
        for seg in raw:
            seg = seg.strip()
            if not seg:
                continue
            if COMMITTEE_RE.search(seg):
                outcome = "committee_staff" if outcome == "no_member" else outcome
                continue
            titles = list(OFFICE_RE.finditer(seg))
            weak = not titles
            key = _position_name(seg[titles[-1].end():] if titles else seg)
            bio, why = self.by_name(key, years)
            if bio:
                if all(b != bio for b, _, _ in found):
                    found.append((bio, weak, seg))
            elif why == "ambiguous_name":
                outcome = "ambiguous_name"
        return found, ("matched" if found else outcome)


_TRAILING = {"OFFICE", "STAFF", "FORMER", "PRESENT", "FROM", "UNTIL", "SINCE"}


def _position_name(tail: str) -> str:
    """Name key from a position segment: year tokens and trailing 'office'/'staff' words dropped, titles stripped."""
    words = [w for w in person_key(tail).split() if not w.isdigit()]
    while words and words[-1] in _TRAILING:
        words.pop()
    while words and words[0] in _TRAILING:
        words.pop(0)
    return strip_titles(" ".join(words))


def person_key_keep(text: str) -> str:
    """Like person_key but keeps separators (; , / -) so a position text can be segmented."""
    t = unicodedata.normalize("NFKD", text or "")
    t = "".join(c for c in t if not unicodedata.combining(c)).upper()
    t = re.sub(r"['’]S\b", "", t)                  # "Senator Smith's office"
    t = re.sub(r"\([^)]*\)", " ", t)
    t = re.sub(r"[.'’`]", "", t)
    return re.sub(r"[^A-Z0-9;,/\- ]+", " ", t)


def serving_years(terms: list[dict]) -> set[int]:
    """Calendar years with any day in office; a term ending on 3 January does not count for that year."""
    ys: set[int] = set()
    for t in terms:
        s, e = int(t["start"][:4]), int(t["end"][:4])
        if t["end"][5:] <= "01-03":
            e -= 1
        ys.update(range(s, e + 1))
    return ys
