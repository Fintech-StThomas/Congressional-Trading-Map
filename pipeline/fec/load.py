"""Load FEC bulk files into a DuckDB database (pipeline/.cache/fec/fec.duckdb).

Files are pipe-delimited, no header, no quoting. Columns come from the FEC header
files (https://www.fec.gov/files/bulk-downloads/data_dictionaries/<name>_header_file.csv),
copied here so a header change upstream fails loudly instead of shifting columns.
Every column is read as text; numbers and dates are parsed explicitly later so bad
values are counted rather than silently coerced.
"""
from __future__ import annotations

import zipfile
from pathlib import Path

import duckdb

from . import download

COLUMNS = {
    "cn": "CAND_ID,CAND_NAME,CAND_PTY_AFFILIATION,CAND_ELECTION_YR,CAND_OFFICE_ST,CAND_OFFICE,"
          "CAND_OFFICE_DISTRICT,CAND_ICI,CAND_STATUS,CAND_PCC,CAND_ST1,CAND_ST2,CAND_CITY,CAND_ST,CAND_ZIP",
    "cm": "CMTE_ID,CMTE_NM,TRES_NM,CMTE_ST1,CMTE_ST2,CMTE_CITY,CMTE_ST,CMTE_ZIP,CMTE_DSGN,CMTE_TP,"
          "CMTE_PTY_AFFILIATION,CMTE_FILING_FREQ,ORG_TP,CONNECTED_ORG_NM,CAND_ID",
    "ccl": "CAND_ID,CAND_ELECTION_YR,FEC_ELECTION_YR,CMTE_ID,CMTE_TP,CMTE_DSGN,LINKAGE_ID",
    "pas2": "CMTE_ID,AMNDT_IND,RPT_TP,TRANSACTION_PGI,IMAGE_NUM,TRANSACTION_TP,ENTITY_TP,NAME,CITY,STATE,"
            "ZIP_CODE,EMPLOYER,OCCUPATION,TRANSACTION_DT,TRANSACTION_AMT,OTHER_ID,CAND_ID,TRAN_ID,FILE_NUM,"
            "MEMO_CD,MEMO_TEXT,SUB_ID",
    # all-candidates summary file (weball): https://www.fec.gov/campaign-finance-data/all-candidates-file-description/
    "weball": "CAND_ID,CAND_NAME,CAND_ICI,PTY_CD,CAND_PTY_AFFILIATION,TTL_RECEIPTS,TRANS_FROM_AUTH,TTL_DISB,"
              "TRANS_TO_AUTH,COH_BOP,COH_COP,CAND_CONTRIB,CAND_LOANS,OTHER_LOANS,CAND_LOAN_REPAY,"
              "OTHER_LOAN_REPAY,DEBTS_OWED_BY,TTL_INDIV_CONTRIB,CAND_OFFICE_ST,CAND_OFFICE_DISTRICT,"
              "SPEC_ELECTION,PRIM_ELECTION,RUN_ELECTION,GEN_ELECTION,GEN_ELECTION_PRECENT,"
              "OTHER_POL_CMTE_CONTRIB,POL_PTY_CONTRIB,CVG_END_DT,INDIV_REFUNDS,CMTE_REFUNDS",
}
FILES = ("cn", "cm", "ccl", "pas2", "weball")
DB_PATH = download.CACHE / "fec.duckdb"


def connect(path: Path = DB_PATH) -> duckdb.DuckDBPyConnection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(path))
    con.execute("SET memory_limit='1500MB'")
    con.execute("SET threads=4")
    con.execute("SET enable_progress_bar=false")
    con.execute("SET preserve_insertion_order=true")
    return con


def q(con: duckdb.DuckDBPyConnection, sql: str, params: list | None = None) -> list[tuple]:
    """Run a query and fetch every row (DuckDB 2 requires results to be fully consumed)."""
    return con.execute(sql, params or []).fetchall()


def _extract(zpath: Path) -> Path:
    outdir = zpath.parent / "x"
    outdir.mkdir(exist_ok=True)
    with zipfile.ZipFile(zpath) as z:
        members = [m for m in z.namelist() if m.lower().endswith(".txt")]
        if len(members) != 1:
            raise RuntimeError(f"{zpath}: expected one .txt member, found {members}")
        info = z.getinfo(members[0])
        # flatten and never trust member paths from the archive
        out = outdir / Path(zpath.stem + ".txt").name
        if not out.exists() or out.stat().st_size != info.file_size:
            with z.open(info) as src, open(out, "wb") as dst:
                while True:
                    b = src.read(1 << 20)
                    if not b:
                        break
                    dst.write(b)
    return out


def _count_lines_and_encoding(path: Path) -> tuple[int, str]:
    n = 0
    non_ascii = False
    utf8_ok = True
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            n += chunk.count(b"\n")
            if not non_ascii and any(b > 127 for b in chunk):
                non_ascii = True
    if non_ascii:
        try:
            with open(path, encoding="utf-8", errors="strict") as f:
                for _ in iter(lambda: f.read(1 << 22), ""):
                    pass
        except UnicodeDecodeError:
            utf8_ok = False
    return n, ("utf-8" if utf8_ok else "latin-1")


def load_cycle(con: duckdb.DuckDBPyConnection, name: str, cycle: int, audit: dict) -> None:
    """Download (cached), extract, and append one file-cycle into table <name>."""
    zpath = download.bulk_zip(name, cycle)
    txt = _extract(zpath)
    lines, enc = _count_lines_and_encoding(txt)
    cols = COLUMNS[name].split(",")
    colspec = "{" + ",".join(f"'{c}':'VARCHAR'" for c in cols) + "}"
    rel = (f"read_csv('{txt.as_posix()}', delim='|', header=false, quote='', escape='', "
           f"columns={colspec}, encoding='{enc}', strict_mode=false, null_padding=true, "
           f"auto_detect=false, new_line='\\n')")
    q(con, f"DELETE FROM {name} WHERE cycle = ?", [cycle])
    q(con, f"INSERT INTO {name} SELECT {cycle} AS cycle, row_number() OVER () AS line_no, * FROM {rel}")
    loaded = q(con, f"SELECT count(*) FROM {name} WHERE cycle = ?", [cycle])[0][0]
    meta = download.source_meta(zpath) or {}
    audit.setdefault("files", {})[f"{name}{cycle % 100:02d}"] = {
        "cycle": cycle, "file": name, "url": meta.get("url"), "zip_sha256": meta.get("sha256"),
        "last_modified": meta.get("last_modified"), "retrieved": meta.get("retrieved"),
        "lines": lines, "rows_loaded": loaded, "encoding": enc,
    }
    if loaded != lines:
        raise RuntimeError(f"{name}{cycle}: {lines} lines but {loaded} rows parsed")


def ensure_tables(con: duckdb.DuckDBPyConnection) -> None:
    for name in FILES:
        cols = ", ".join(f"{c} VARCHAR" for c in COLUMNS[name].split(","))
        q(con, f"CREATE TABLE IF NOT EXISTS {name} (cycle INTEGER, line_no BIGINT, {cols})")
    q(con, "CREATE TABLE IF NOT EXISTS loaded (name VARCHAR, cycle INTEGER, zip_sha256 VARCHAR, "
          "lines BIGINT, encoding VARCHAR)")


def load_all(con: duckdb.DuckDBPyConnection, cycles: list[int], audit: dict) -> None:
    """Load every file for every cycle; skip a file-cycle already loaded from the same zip."""
    ensure_tables(con)
    for cycle in cycles:
        for name in FILES:
            zpath = download.bulk_zip(name, cycle)
            sha = (download.source_meta(zpath) or {}).get("sha256")
            done = q(con, "SELECT lines, encoding FROM loaded WHERE name=? AND cycle=? AND zip_sha256=?",
                     [name, cycle, sha])
            if done:
                loaded = q(con, f"SELECT count(*) FROM {name} WHERE cycle=?", [cycle])[0][0]
                meta = download.source_meta(zpath) or {}
                audit.setdefault("files", {})[f"{name}{cycle % 100:02d}"] = {
                    "cycle": cycle, "file": name, "url": meta.get("url"), "zip_sha256": sha,
                    "last_modified": meta.get("last_modified"), "retrieved": meta.get("retrieved"),
                    "lines": done[0][0], "rows_loaded": loaded, "encoding": done[0][1], "cached_load": True,
                }
                continue
            load_cycle(con, name, cycle, audit)
            q(con, "DELETE FROM loaded WHERE name=? AND cycle=?", [name, cycle])
            a = audit["files"][f"{name}{cycle % 100:02d}"]
            q(con, "INSERT INTO loaded VALUES (?, ?, ?, ?, ?)", [name, cycle, sha, a["lines"], a["encoding"]])
            print(f"  loaded {name}{cycle % 100:02d}: {audit['files'][f'{name}{cycle % 100:02d}']['rows_loaded']:,} rows",
                  flush=True)
