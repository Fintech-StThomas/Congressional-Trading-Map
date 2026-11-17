"""Stream the FEC operating-expenditures bulk file (`oppexp<yy>.zip`) and aggregate it by FEC disbursement category
for a given set of committee ids (the leadership PACs linked to members). Pure functions over files; no database.

Privacy by construction: `iter_rows` extracts only the committee id, report/amendment identifiers, the amount, the
transaction date (used only to recognise a re-reported transaction, never published), the memo flag and the category
code. The payee name, city, state, ZIP and free-text purpose columns are never read into a variable, so no aggregate
can carry them.

Memory: the zip member is read one line at a time and a line is split only if its first nine bytes are one of the
wanted committee ids, so memory stays at a few MB whatever the file size (2024 cycle: 430 MB unpacked, 2.2 million
lines).

Layout: https://www.fec.gov/campaign-finance-data/operating-expenditures-file-description/ and the header file
https://www.fec.gov/files/bulk-downloads/data_dictionaries/oppexp_header_file.csv (25 columns; the 2024 file ends each
line with one extra `|`, so a line has 24 or 25 delimiters). A first line with another number of delimiters stops the
read of that file (`LayoutChanged`) instead of shifting columns.
"""
from __future__ import annotations

import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Iterator

COLUMNS = ("CMTE_ID,AMNDT_IND,RPT_YR,RPT_TP,IMAGE_NUM,LINE_NUM,FORM_TP_CD,SCHED_TP_CD,NAME,CITY,STATE,ZIP_CODE,"
           "TRANSACTION_DT,TRANSACTION_AMT,TRANSACTION_PGI,PURPOSE,CATEGORY,CATEGORY_DESC,MEMO_CD,MEMO_TEXT,ENTITY_TP,"
           "SUB_ID,FILE_NUM,TRAN_ID,BACK_REF_TRAN_ID").split(",")
IDX = {c: i for i, c in enumerate(COLUMNS)}
FIRST_OPPEXP_CYCLE = 2004     # electronic filers from the 2004 cycle (file description); 2000 and 2002 answer 404

# FEC disbursement category codes (https://www.fec.gov/campaign-finance-data/disbursement-category-code-descriptions/).
# Labels are the FEC's own wording, shortened only by dropping the "e.g." examples.
CATEGORY_LABELS = {
    "001": "Administrative/salary/overhead expenses", "002": "Travel expenses",
    "003": "Solicitation and fundraising expenses", "004": "Advertising expenses", "005": "Polling expenses",
    "006": "Campaign materials", "007": "Campaign event expenses", "008": "Transfers", "009": "Loan repayments",
    "010": "Refunds of contributions", "011": "Political contributions", "012": "Donations",
    "101": "Expenses that are not allocable", "102": "Media expenditures",
    "103": "Expenditures for mass mailings and other campaign materials",
    "104": "Overhead expenditures of state offices and their facilities",
    "105": "Expenditures for special telephone programs", "106": "Public opinion poll expenditures",
    "107": "Fundraising expenditures",
}


class LayoutChanged(Exception):
    """The file's first line does not have the documented number of columns."""


def _cell(parts: list[bytes], name: str) -> str:
    return parts[IDX[name]].decode("latin-1").strip()


def iter_rows(zip_path: Path, committee_ids: set[str], stats: dict[str, int] | None = None) -> Iterator[dict[str, Any]]:
    """Yield one small dict per line of the zip's single .txt member that belongs to a wanted committee.
    `stats` (if given) receives `lines` (all lines read) and `matched` (lines of wanted committees)."""
    wanted = {c.encode("ascii") for c in committee_ids}
    st = stats if stats is not None else {}
    st["lines"] = st["matched"] = 0
    with zipfile.ZipFile(zip_path) as z:
        members = [m for m in z.namelist() if m.lower().endswith(".txt")]
        if len(members) != 1:
            raise RuntimeError(f"{zip_path}: expected one .txt member, found {members}")
        with z.open(members[0]) as f:
            for line in f:
                st["lines"] += 1
                if st["lines"] == 1:
                    n = line.rstrip(b"\r\n").count(b"|")
                    if n not in (len(COLUMNS) - 1, len(COLUMNS)):
                        raise LayoutChanged(f"{zip_path.name}: {n} delimiters in line 1, expected "
                                            f"{len(COLUMNS) - 1} or {len(COLUMNS)}")
                if line[:9] not in wanted:
                    continue
                st["matched"] += 1
                p = line.rstrip(b"\r\n").split(b"|")
                if len(p) < len(COLUMNS):
                    raise LayoutChanged(f"{zip_path.name} line {st['lines']}: {len(p)} fields")
                yield {"committee": _cell(p, "CMTE_ID"), "memo": _cell(p, "MEMO_CD") == "X",
                       "amount": _amount(_cell(p, "TRANSACTION_AMT")), "category": _cell(p, "CATEGORY"),
                       "tran_id": _cell(p, "TRAN_ID"), "date": _cell(p, "TRANSACTION_DT"),
                       "file_num": _int(_cell(p, "FILE_NUM")), "sub_id": _cell(p, "SUB_ID")}


def _amount(s: str) -> float | None:
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def _int(s: str) -> int:
    return int(s) if s.isdigit() else 0


def category_code(raw: str) -> str | None:
    """The official code, or None for a blank or unrecognised value (the filing gave no usable category)."""
    return raw if raw in CATEGORY_LABELS else None


def aggregate(rows: Iterable[dict[str, Any]], report: dict[str, int] | None = None) -> dict[str, dict[str | None, list]]:
    """{committee: {category code or None: [net dollars, rows]}} for one file-cycle.

    Rules: memo items (MEMO_CD = X, itemisations of an amount already counted) are dropped; a transaction that appears
    more than once (same committee, transaction id, date and amount, which is a re-report in a later filing) counts
    once, from the highest file number; rows without a transaction id or amount are kept (no amount: counted in
    `report['no_amount']` and skipped). Refunds and voids are negative rows and net against their category."""
    rep = report if report is not None else {}
    kept: dict[tuple, dict[str, Any]] = {}
    for r in rows:
        if r["memo"]:
            rep["memo_dropped"] = rep.get("memo_dropped", 0) + 1
            continue
        if r["amount"] is None:
            rep["no_amount"] = rep.get("no_amount", 0) + 1
            continue
        key = (r["committee"], r["tran_id"], r["date"], r["amount"]) if r["tran_id"] else ("sub", r["sub_id"])
        old = kept.get(key)
        if old is not None:
            rep["rereport_dropped"] = rep.get("rereport_dropped", 0) + 1
            if r["file_num"] <= old["file_num"]:
                continue
        kept[key] = r
    out: dict[str, dict[str | None, list]] = defaultdict(dict)
    for r in kept.values():
        cell = out[r["committee"]].setdefault(category_code(r["category"]), [0.0, 0])
        cell[0] = round(cell[0] + r["amount"], 2)
        cell[1] += 1
    return out
