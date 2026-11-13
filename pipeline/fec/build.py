"""Turn loaded FEC bulk tables into contract edges and orgs.

Every pas2 row is given exactly one `rule` label (kept as an edge input, or the reason
it was dropped) in table `p_rules`; the audit trail in the README and in
pipeline/build/sources/fec.json is a group-by over that table, so rows and dollars at
each step always reconcile to the rows read.
"""
from __future__ import annotations

import csv
import re
from datetime import date

import duckdb

from . import download
from .load import q
from .refs import Companies, Members, Overrides, normalise_name

# --- code-list choices (see README "Code-list choices") ----------------------------------
CONTRIB_TYPES = ("24K", "24Z", "24P")          # direct, in-kind, to a possible federal candidate
SUPPORT_TYPES = ("24E", "24F")                 # IE advocating; Form 7 communication cost for
OPPOSE_TYPES = ("24A", "24N")                  # IE opposing; Form 7 communication cost against
OUT_OF_SCOPE = {"24C": "coordinated party expenditure (not a contribution, not independent)",
                "24H": "honorarium to candidate", "24R": "election recount disbursement"}
# Conduits forward individuals' earmarked money; their 24K rows are not the committee's own money.
# ActBlue reports earmarks as 24T in the oth file, so it rarely appears here; listed for safety.
CONDUITS = {"C00694323": "WINRED", "C00401224": "ACTBLUE", "C00468314": "DEMOCRACY ENGINE, INC., PAC"}

PARTY_TYPES = {"X", "Y", "Z"}
SUPER_PAC_TYPES = {"O", "U"}
PAC_TYPES = {"N", "Q", "V", "W"}
CANDIDATE_TYPES = {"H", "S", "P"}

MIN_DATE = "1997-01-01"


def _num(x) -> float | int:
    """Decimal -> int when whole, else float rounded to cents."""
    if x is None:
        return None
    f = round(float(x), 2)
    return int(f) if f == int(f) else f


def money(x) -> str:
    f = float(x)
    return f"${f:,.0f}" if f == int(f) else f"${f:,.2f}"


def _name_key(s: str | None) -> str:
    """Person-name key for exact matching of leadership-PAC sponsors to candidate names:
    uppercase, punctuation removed, whitespace collapsed. No reordering, no nicknames."""
    if not s:
        return ""
    return " ".join(re.sub(r"[^A-Z0-9 ]+", " ", s.upper().replace(".", "")).split())


# ------------------------------------------------------------------------------------------
def prepare_reference_tables(con: duckdb.DuckDBPyConnection, members: Members, cycles: list[int],
                             report: dict) -> None:
    q(con, "CREATE OR REPLACE TEMP TABLE cand_member (cand_id VARCHAR PRIMARY KEY, bioguide VARCHAR)")
    con.executemany("INSERT INTO cand_member VALUES (?, ?)", sorted(members.cand_to_bio.items()))
    cyc = ",".join(str(c) for c in cycles)

    # Latest committee master record per committee (name, type, designation, connected org).
    q(con, f"""CREATE OR REPLACE TEMP TABLE cm_latest AS
        SELECT * EXCLUDE (rn) FROM (
          SELECT *, row_number() OVER (PARTITION BY CMTE_ID ORDER BY cycle DESC, line_no DESC) rn
          FROM cm WHERE cycle IN ({cyc})) WHERE rn = 1""")
    n_cm = q(con, "SELECT count(*), count(DISTINCT CMTE_ID) FROM cm_latest")[0]
    assert n_cm[0] == n_cm[1], "cm_latest must have one row per committee"

    # Authorised campaign committees: linkage file P/A, plus committee master P/A with a candidate id.
    q(con, f"""CREATE OR REPLACE TEMP TABLE auth AS
        SELECT DISTINCT CMTE_ID, CAND_ID FROM (
          SELECT CMTE_ID, CAND_ID FROM ccl WHERE cycle IN ({cyc}) AND CMTE_DSGN IN ('P','A') AND CMTE_ID IS NOT NULL
          UNION ALL
          SELECT CMTE_ID, CAND_ID FROM cm WHERE cycle IN ({cyc}) AND CMTE_DSGN IN ('P','A')
                 AND CMTE_TP IN ('H','S','P') AND CAND_ID IS NOT NULL)""")
    q(con, """CREATE OR REPLACE TEMP TABLE auth_member_all AS
        SELECT a.CMTE_ID, m.bioguide FROM auth a JOIN cand_member m ON m.cand_id = a.CAND_ID
        GROUP BY ALL""")
    ambiguous = q(con, """SELECT CMTE_ID, string_agg(bioguide, ',' ORDER BY bioguide) FROM auth_member_all
                          GROUP BY 1 HAVING count(*) > 1 ORDER BY 1""")
    q(con, """CREATE OR REPLACE TEMP TABLE auth_member AS
        SELECT CMTE_ID, min(bioguide) AS bioguide FROM auth_member_all GROUP BY 1 HAVING count(*) = 1""")
    # Committees authorised by some candidate who is not (or not uniquely) a member.
    q(con, """CREATE OR REPLACE TEMP TABLE auth_any AS
        SELECT DISTINCT CMTE_ID FROM auth
        UNION SELECT CMTE_ID FROM cm_latest WHERE CMTE_TP IN ('H','S','P') OR CMTE_DSGN IN ('P','A')""")
    # Joint fundraising committees: designation J in the committee master or the linkage file, any cycle.
    q(con, f"""CREATE OR REPLACE TEMP TABLE jfc AS
        SELECT DISTINCT CMTE_ID FROM cm WHERE cycle IN ({cyc}) AND CMTE_DSGN = 'J'
        UNION SELECT DISTINCT CMTE_ID FROM ccl WHERE cycle IN ({cyc}) AND CMTE_DSGN = 'J' AND CMTE_ID IS NOT NULL""")
    report["committees"] = {
        "joint_fundraising_committees": q(con, "SELECT count(*) FROM jfc")[0][0],
        "committee_master_distinct": n_cm[0],
        "authorised_committee_links": q(con, "SELECT count(*) FROM auth")[0][0],
        "authorised_committees_of_members": q(con, "SELECT count(*) FROM auth_member")[0][0],
        "authorised_committees_ambiguous_member": [{"committee": c, "members": b.split(",")} for c, b in ambiguous],
    }
    _leadership(con, members, cycles, report)


def _leadership(con: duckdb.DuckDBPyConnection, members: Members, cycles: list[int], report: dict) -> None:
    """Leadership PAC -> sponsoring member, from filed sources only.

    1. candidate-committee linkage rows with designation D (an FEC candidate id),
    2. committee master rows with designation D that carry a CAND_ID,
    3. the FEC 'leadership PACs and sponsors' file (2010+), whose sponsor is a name only.
       A sponsor name is accepted only if, after removing punctuation, it equals the FEC
       candidate-master name of candidates who all map to one and the same member. No
       fuzzy or partial matching. Unmatched sponsors are listed in the report.
    A committee whose sources disagree is dropped and listed.
    """
    cyc = ",".join(str(c) for c in cycles)
    rows: list[tuple[str, str, str]] = []
    for cmte, cand in q(con, f"""SELECT DISTINCT CMTE_ID, CAND_ID FROM ccl WHERE cycle IN ({cyc})
                                AND CMTE_DSGN='D' AND CMTE_ID IS NOT NULL
                                UNION SELECT DISTINCT CMTE_ID, CAND_ID FROM cm WHERE cycle IN ({cyc})
                                AND CMTE_DSGN='D' AND CAND_ID IS NOT NULL ORDER BY 1, 2"""):
        bio = members.cand_to_bio.get(cand)
        if bio:
            rows.append((cmte, bio, "fec_candidate_id"))

    # name index: name key -> set of bioguides (None for candidates who are not members)
    name_to_bios: dict[str, set] = {}
    for cand, nm in q(con, f"SELECT DISTINCT CAND_ID, CAND_NAME FROM cn WHERE cycle IN ({cyc}) ORDER BY 1, 2"):
        name_to_bios.setdefault(_name_key(nm), set()).add(members.cand_to_bio.get(cand))
    lead_rows = 0
    unmatched: dict[tuple[str, str], int] = {}
    ambiguous: set[tuple[str, str]] = set()
    lead_names: dict[str, str] = {}
    for cycle in cycles:
        if cycle < 2010:
            continue
        try:
            path = download.leadership_csv(cycle)
        except download.NotFound:
            continue
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            for r in csv.DictReader(f):
                lead_rows += 1
                cmte = (r.get("Committee_Id") or "").strip()
                sponsor = (r.get("Sponsor_Name") or "").strip()
                lead_names.setdefault(cmte, (r.get("Committee_Name") or "").strip())
                if not cmte or not sponsor:
                    unmatched[(cmte, sponsor or "(blank)")] = cycle
                    continue
                bios = name_to_bios.get(_name_key(sponsor))
                if bios and len(bios) == 1 and None not in bios:
                    rows.append((cmte, next(iter(bios)), "leadership_file_exact_name"))
                elif bios and len(bios) > 1:
                    ambiguous.add((cmte, sponsor))
                else:
                    unmatched[(cmte, sponsor)] = cycle
    by_cmte: dict[str, dict[str, set]] = {}
    for cmte, bio, how in rows:
        by_cmte.setdefault(cmte, {}).setdefault(bio, set()).add(how)
    final, conflicts = [], []
    for cmte in sorted(by_cmte):
        bios = by_cmte[cmte]
        if len(bios) == 1:
            bio, hows = next(iter(bios.items()))
            final.append((cmte, bio, "+".join(sorted(hows))))
        else:
            conflicts.append({"committee": cmte, "members": sorted(bios)})
    q(con, "CREATE OR REPLACE TEMP TABLE lpac (CMTE_ID VARCHAR PRIMARY KEY, bioguide VARCHAR, method VARCHAR)")
    if final:
        con.executemany("INSERT INTO lpac VALUES (?, ?, ?)", final)
    matched_ids = {c for c, _, _ in final}
    report["leadership_pacs"] = {
        "leadership_file_rows": lead_rows,
        "sponsors_resolved": len(final),
        "by_method": {m: sum(1 for _, _, h in final if h == m) for m in sorted({h for _, _, h in final})},
        "conflicting_sources_dropped": conflicts,
        "sponsor_name_ambiguous": sorted([{"committee": c, "sponsor": s} for c, s in ambiguous],
                                         key=lambda d: (d["committee"], d["sponsor"])),
        "sponsor_unmatched": sorted(
            [{"committee": c, "committee_name": lead_names.get(c, ""), "sponsor": s, "last_cycle": y}
             for (c, s), y in unmatched.items() if c not in matched_ids],
            key=lambda d: (d["sponsor"], d["committee"])),
    }


# ------------------------------------------------------------------------------------------
def classify_rows(con: duckdb.DuckDBPyConnection, cycles: list[int], today: str) -> None:
    """Give every pas2 row exactly one rule label."""
    cyc = ",".join(str(c) for c in cycles)
    contrib = ",".join(f"'{t}'" for t in CONTRIB_TYPES)
    support = ",".join(f"'{t}'" for t in SUPPORT_TYPES)
    oppose = ",".join(f"'{t}'" for t in OPPOSE_TYPES)
    conduits = ",".join(f"'{c}'" for c in CONDUITS)
    q(con, f"""CREATE OR REPLACE TEMP TABLE p0 AS
      SELECT cycle, line_no, CMTE_ID, AMNDT_IND, RPT_TP, TRANSACTION_PGI, IMAGE_NUM, TRANSACTION_TP AS tp, ENTITY_TP, NAME,
             OTHER_ID, CAND_ID, TRAN_ID, FILE_NUM, MEMO_CD, MEMO_TEXT, SUB_ID,
             try_cast(TRANSACTION_AMT AS DECIMAL(18,2)) AS amt,
             coalesce(try_strptime(TRANSACTION_DT, '%m%d%Y')::DATE,
                      CASE WHEN length(IMAGE_NUM) = 18
                           THEN try_strptime(substr(IMAGE_NUM, 1, 8), '%Y%m%d')::DATE END) AS dt,
             (try_strptime(TRANSACTION_DT, '%m%d%Y') IS NULL) AS date_fallback,
             TRANSACTION_AMT AS amt_raw
      FROM pas2 WHERE cycle IN ({cyc})""")
    # Duplicate re-reports: same filer, same transaction id (or, for paper rows without one, the same
    # image page), same type, election (PGI), date, amount, recipient and candidate. Keep the latest filing.
    q(con, """CREATE OR REPLACE TEMP TABLE p1 AS
      SELECT *, row_number() OVER (
          PARTITION BY CMTE_ID, tp, coalesce(TRANSACTION_PGI, ''), coalesce(TRAN_ID, 'img:' || coalesce(IMAGE_NUM, SUB_ID)), dt, amt,
                       coalesce(OTHER_ID, ''), coalesce(CAND_ID, '')
          ORDER BY try_cast(FILE_NUM AS BIGINT) DESC NULLS LAST, cycle DESC, SUB_ID DESC) AS dup_rank
      FROM p0 WHERE MEMO_CD IS NULL""")
    q(con, f"""CREATE OR REPLACE TEMP TABLE p_rules AS
      WITH base AS (
        SELECT p.*, p1.dup_rank FROM p0 p LEFT JOIN p1 USING (SUB_ID)
      ), j AS (
        SELECT b.*,
          ra.bioguide AS rcpt_cmte_member,
          (b.OTHER_ID IN (SELECT CMTE_ID FROM auth_any)) AS rcpt_is_cand_cmte,
          (b.OTHER_ID IN (SELECT CMTE_ID FROM cm_latest)) AS rcpt_known_cmte,
          cmm.bioguide AS cand_member,
          ga.bioguide AS giver_auth_member,
          gl.bioguide AS giver_lpac_member,
          (b.CMTE_ID IN (SELECT CMTE_ID FROM auth_any)) AS giver_is_cand_cmte,
          (b.CMTE_ID IN (SELECT CMTE_ID FROM jfc)) AS giver_is_jfc
        FROM base b
        LEFT JOIN auth_member ra ON ra.CMTE_ID = b.OTHER_ID
        LEFT JOIN cand_member cmm ON cmm.cand_id = b.CAND_ID
        LEFT JOIN auth_member ga ON ga.CMTE_ID = b.CMTE_ID
        LEFT JOIN lpac gl ON gl.CMTE_ID = b.CMTE_ID
      )
      SELECT *,
        CASE WHEN tp IN ({contrib}) THEN coalesce(rcpt_cmte_member,
                    CASE WHEN OTHER_ID IS NULL THEN cand_member END)
             ELSE cand_member END AS to_member,
        coalesce(giver_auth_member, giver_lpac_member) AS from_member,
        CASE
          WHEN tp NOT IN ({contrib},{support},{oppose}) THEN 'drop:type_out_of_scope:' || coalesce(tp, 'null')
          WHEN MEMO_CD IS NOT NULL THEN 'drop:memo_item'
          WHEN amt IS NULL THEN 'drop:amount_unparseable'
          WHEN dt IS NULL THEN 'drop:date_missing_or_invalid'
          WHEN dt < DATE '{MIN_DATE}' OR dt > DATE '{today}' THEN 'drop:date_out_of_range'
          WHEN dup_rank > 1 THEN 'drop:duplicate_rereport'
          WHEN tp IN ({contrib}) AND amt >= 10000
               AND amt = try_cast(regexp_replace(coalesce(OTHER_ID, ''), '^C0*', '') AS DECIMAL(18,2))
               THEN 'drop:amount_equals_recipient_committee_id'
          WHEN tp IN ({contrib}) AND (CMTE_ID IN ({conduits}) OR upper(coalesce(MEMO_TEXT,'')) LIKE '%EARMARK%')
               THEN 'drop:earmarked_via_conduit'
          WHEN tp IN ({contrib}) AND rcpt_cmte_member IS NULL AND OTHER_ID IS NOT NULL AND rcpt_is_cand_cmte
               THEN 'drop:recipient_campaign_not_member'
          WHEN tp IN ({contrib}) AND rcpt_cmte_member IS NULL AND OTHER_ID IS NOT NULL AND rcpt_known_cmte
               THEN 'drop:recipient_not_a_campaign_committee'
          WHEN tp IN ({contrib}) AND rcpt_cmte_member IS NULL AND OTHER_ID IS NOT NULL
               THEN 'drop:recipient_committee_unknown'
          WHEN tp IN ({contrib}) AND rcpt_cmte_member IS NULL AND OTHER_ID IS NULL AND cand_member IS NULL
               THEN 'drop:recipient_not_member'
          WHEN tp IN ({contrib}) AND rcpt_cmte_member IS NOT NULL AND cand_member IS NOT NULL
               AND cand_member <> rcpt_cmte_member THEN 'drop:candidate_committee_conflict'
          WHEN tp IN ({contrib}) AND giver_is_jfc AND giver_auth_member IS NULL AND giver_lpac_member IS NULL
               THEN 'drop:giver_joint_fundraising_committee'
          WHEN tp IN ({contrib}) AND coalesce(giver_auth_member, giver_lpac_member)
               = coalesce(rcpt_cmte_member, cand_member) THEN 'drop:own_committee_transfer'
          WHEN tp IN ({contrib}) AND coalesce(giver_auth_member, giver_lpac_member) IS NOT NULL THEN 'keep:funds'
          WHEN tp IN ({contrib}) AND giver_is_cand_cmte THEN 'drop:giver_campaign_of_non_member'
          WHEN tp IN ({contrib}) THEN 'keep:pac_money'
          WHEN cand_member IS NULL THEN 'drop:ie_target_not_member'
          WHEN tp IN ({support}) THEN 'keep:outside_support'
          ELSE 'keep:outside_oppose'
        END AS rule
      FROM j""")
    a, b = q(con, "SELECT count(*) FROM p_rules")[0][0], q(con, "SELECT count(*) FROM p0")[0][0]
    assert a == b, f"join multiplied rows: {b} -> {a}"


# ------------------------------------------------------------------------------------------
def resolve_orgs(con: duckdb.DuckDBPyConnection, companies: Companies, overrides: Overrides, report: dict) -> None:
    """Org identity for every committee that is the payer of a kept pac_money / outside row."""
    givers = q(con, """SELECT DISTINCT r.CMTE_ID, c.CMTE_NM, c.CMTE_TP, c.CMTE_DSGN, c.CONNECTED_ORG_NM, c.ORG_TP
                       FROM p_rules r LEFT JOIN cm_latest c USING (CMTE_ID)
                       WHERE r.rule IN ('keep:pac_money','keep:outside_support','keep:outside_oppose')
                       ORDER BY 1""")
    out = []
    methods: dict[str, int] = {}
    for cmte, nm, tp, dsgn, conn, org_tp in givers:
        conn_clean = (conn or "").strip()
        if conn_clean.upper() in {"", "NONE", "N/A", "NA", "NULL"}:
            conn_clean = ""
        candidates = [conn_clean] if conn_clean else []
        if tp == "C" and nm:   # Form 7 filers are the organisation itself
            candidates.append(nm)
        org, how = None, None
        if cmte in overrides.by_committee:
            org, how = overrides.by_committee[cmte], "override_committee"
        else:
            for nmx in candidates:
                key = normalise_name(nmx)
                if key and key in overrides.by_name:
                    org, how = overrides.by_name[key], "override_name"
                    break
                if key and key in companies.index:
                    org, how = companies.index[key], "company_exact_name"
                    break
        if tp in PARTY_TYPES:
            kind = "party"
        elif tp in SUPER_PAC_TYPES:
            kind = "super_pac"
        elif tp in PAC_TYPES:
            kind = "pac"
        else:
            kind = "other"
        if nm is None:
            kind = "other"
        pac_id = f"pac:{cmte}"
        out.append((cmte, pac_id, nm or f"FEC committee {cmte}", kind, org, how or "none",
                    conn_clean or None, nm is None))
        methods[how or "none"] = methods.get(how or "none", 0) + 1
    q(con, """CREATE OR REPLACE TEMP TABLE giver_org (CMTE_ID VARCHAR PRIMARY KEY, pac_id VARCHAR, name VARCHAR,
              kind VARCHAR, company VARCHAR, how VARCHAR, connected VARCHAR, missing_cm BOOLEAN)""")
    if out:
        con.executemany("INSERT INTO giver_org VALUES (?, ?, ?, ?, ?, ?, ?, ?)", out)
    report["org_resolution"] = {"giver_committees": len(out), "by_method": dict(sorted(methods.items())),
                                "givers_missing_from_committee_master": sum(1 for o in out if o[7])}


# ------------------------------------------------------------------------------------------
def edge_inputs(con: duckdb.DuckDBPyConnection) -> None:
    """One row per kept transaction with the edge key it aggregates under."""
    q(con, """CREATE OR REPLACE TEMP TABLE e_in AS
      SELECT
        CASE r.rule WHEN 'keep:pac_money' THEN 'pac_money' WHEN 'keep:funds' THEN 'funds'
             ELSE 'outside_spending' END AS type,
        CASE WHEN r.rule = 'keep:funds' THEN 'member' ELSE 'org' END AS from_kind,
        CASE WHEN r.rule = 'keep:funds' THEN r.from_member ELSE coalesce(g.company, g.pac_id) END AS from_id,
        r.to_member AS to_id,
        CASE
          WHEN r.rule = 'keep:funds' THEN 'pac:' || r.CMTE_ID
          WHEN r.rule = 'keep:pac_money' THEN CASE WHEN g.company IS NOT NULL THEN g.pac_id END
          WHEN r.rule = 'keep:outside_support' THEN g.pac_id || ':support'
          ELSE g.pac_id || ':oppose' END AS via_id,
        CASE
          WHEN r.rule = 'keep:funds' THEN coalesce(c.CMTE_NM, 'FEC committee ' || r.CMTE_ID)
          WHEN r.rule = 'keep:pac_money' THEN CASE WHEN g.company IS NOT NULL THEN g.name END
          WHEN r.rule = 'keep:outside_support' THEN g.name || ', supporting'
          ELSE g.name || ', opposing' END AS via_name,
        CASE WHEN r.rule = 'keep:outside_support' THEN 'support'
             WHEN r.rule = 'keep:outside_oppose' THEN 'oppose' END AS direction,
        CASE WHEN r.rule = 'keep:funds' AND r.giver_auth_member IS NULL THEN 'leadership PAC' END AS lpac,
        r.CMTE_ID, coalesce(c.CMTE_NM, 'FEC committee ' || r.CMTE_ID) AS giver_name,
        r.tp, r.amt, r.dt, r.date_fallback, r.NAME AS counterparty, r.IMAGE_NUM, r.TRAN_ID, r.SUB_ID, r.cycle
      FROM p_rules r
      LEFT JOIN giver_org g USING (CMTE_ID)
      LEFT JOIN cm_latest c USING (CMTE_ID)
      WHERE r.rule LIKE 'keep:%'""")
    a = q(con, "SELECT count(*) FROM e_in")[0][0]
    b = q(con, "SELECT count(*) FROM p_rules WHERE rule LIKE 'keep:%'")[0][0]
    assert a == b, f"edge-input join multiplied rows: {b} -> {a}"


def _evidence_label(r: dict, member_names: dict[str, str]) -> str:
    amt = money(r["amt"])
    d = r["dt"].isoformat()
    if r.get("date_fallback"):
        d = f"{d} (filing date; no transaction date on the record)"
    tp = r["tp"]
    if r["type"] == "outside_spending":
        who = member_names.get(r["to_id"], r["to_id"])
        verb = "supporting" if r["direction"] == "support" else "opposing"
        what = "a communication" if tp in ("24F", "24N") else "an independent expenditure"
        payee = f" (paid to {r['counterparty']})" if r["counterparty"] else ""
        return f"{r['giver_name']} reported {what} of {amt} {verb} {who} on {d}{payee}"
    kind = "an in-kind contribution of " if tp == "24Z" else ""
    to = f" to {r['counterparty']}" if r["counterparty"] else ""
    return f"{r['giver_name']} gave {kind}{amt}{to} on {d}"


def _evidence_url(r: dict) -> str:
    img = (r["IMAGE_NUM"] or "").strip()
    if img.isdigit() and len(img) in (11, 18):
        return f"https://docquery.fec.gov/cgi-bin/fecimg/?{img}"
    return f"https://www.fec.gov/data/committee/{r['CMTE_ID']}/"


def aggregate(con: duckdb.DuckDBPyConnection, member_names: dict[str, str], edge_type: str,
              stats: dict, chunk: int = 60):
    """Yield the edges of one type, aggregated from e_in, a few dozen recipient members at a time so
    memory stays flat. Output order is deterministic: by recipient member id, then by key."""
    key = "from_kind, from_id, to_id, coalesce(via_id, ''), coalesce(direction, '')"
    to_ids = [r[0] for r in q(con, "SELECT DISTINCT to_id FROM e_in WHERE type = ? ORDER BY 1", [edge_type])]
    nonpos = stats.setdefault("edges_dropped_nonpositive_net", {}).setdefault(
        edge_type, {"count": 0, "dollars": 0.0, "records": 0})
    cols = ["from_kind", "from_id", "to_id", "v", "d", "CMTE_ID", "giver_name", "tp", "amt", "dt",
            "counterparty", "IMAGE_NUM", "TRAN_ID", "SUB_ID", "direction", "date_fallback", "rk"]
    for i in range(0, len(to_ids), chunk):
        ids = to_ids[i:i + chunk]
        where = "type = ? AND to_id IN (" + ",".join("?" * len(ids)) + ")"
        params = [edge_type, *ids]
        tot = q(con, f"""SELECT from_kind, from_id, to_id, coalesce(via_id, ''), any_value(via_name),
                                coalesce(direction, ''), any_value(lpac), sum(amt), count(*), min(dt), max(dt),
                                count(*) FILTER (WHERE date_fallback)
                         FROM e_in WHERE {where} GROUP BY {key} ORDER BY 3, 1, 2, 4, 6""", params)
        by_year: dict[tuple, list] = {}
        for fk, f, to, v, d, y, n, sm in q(con, f"""SELECT {key}, year(dt) y, count(*), sum(amt) FROM e_in
                                                  WHERE {where} GROUP BY {key}, y ORDER BY 1,2,3,4,5,6""", params):
            by_year.setdefault((fk, f, to, v, d), []).append(
                {"y": int(y), "n": int(n), "low": _num(sm), "high": _num(sm), "exact": _num(sm)})
        evid: dict[tuple, list] = {}
        for row in q(con, f"""SELECT * FROM (
                          SELECT from_kind, from_id, to_id, coalesce(via_id,'') v, coalesce(direction,'') d,
                                 CMTE_ID, giver_name, tp, amt, dt, counterparty, IMAGE_NUM, TRAN_ID, SUB_ID, direction,
                                 date_fallback, row_number() OVER (PARTITION BY {key} ORDER BY amt DESC, dt DESC, SUB_ID) rk
                          FROM e_in WHERE {where} AND amt > 0) WHERE rk <= 5 ORDER BY 1,2,3,4,5,rk""", params):
            r = dict(zip(cols, row))
            r["type"] = edge_type
            evid.setdefault(tuple(row[:5]), []).append({
                "label": _evidence_label(r, member_names), "date": r["dt"].isoformat(), "url": _evidence_url(r),
                "source": "fec", "record": r["TRAN_ID"] or r["SUB_ID"]})
        for fk, f, to, v, vname, d, lpac, sm, n, first, last, n_fallback in tot:
            k = (fk, f, to, v, d)
            if sm is None or sm <= 0:
                nonpos["count"] += 1
                nonpos["dollars"] = round(nonpos["dollars"] + float(sm or 0), 2)
                nonpos["records"] += int(n)
                continue
            note = d or None
            if edge_type == "funds" and lpac:
                note = "via leadership PAC"
            yield {
                "type": edge_type, "family": "money", "basis": "filed",
                "from": {"kind": fk, "id": f}, "to": {"kind": "member", "id": to}, "directed": True,
                "via": {"id": v, "name": vname} if v else None,
                "amount": {"low": _num(sm), "high": _num(sm), "exact": _num(sm)},
                "count": int(n), "first": first.isoformat(), "last": last.isoformat(),
                "by_year": by_year[k], "evidence": evid[k], "evidence_total": int(n),
                "stat": None, "weak": bool(n_fallback), "note": note,
            }
            if n_fallback:
                stats.setdefault("edges_weak_date_from_filing", {}).setdefault(edge_type, 0)
                stats["edges_weak_date_from_filing"][edge_type] += 1


# ------------------------------------------------------------------------------------------
def fundraises_with(con: duckdb.DuckDBPyConnection, members: Members, cycles: list[int],
                    report: dict) -> list[dict]:
    """Members who took part in the same joint fundraising committee (JFC) in the same cycle.

    Participation is taken only from filed records that name the member's campaign:
      the FEC candidate-committee linkage file links the member's candidate id to the JFC
          (designation J).
    A JFC's own 24K rows in pas2 are NOT used: a JFC can also give to non-participants, so a
    payment from it does not prove participation (that needs the 18G/24G transfers in the oth file).
    Party committees and other non-candidate participants are not members and are ignored.
    No amount is given: the JFC is a shared vehicle, not money between the two members.
    """
    cyc = ",".join(str(c) for c in cycles)
    names = dict(q(con, "SELECT CMTE_ID, CMTE_NM FROM cm_latest"))
    part: dict[tuple[int, str], dict[str, list[dict]]] = {}
    # A linkage row is current for the cycle only if the candidate's election year is this cycle or a
    # later one (Senate: up to six years on). Rows whose election year is already past are carried over
    # from old cycles (e.g. a 1994 JFC still listed in 2006) and are not evidence of participation.
    cur = f"""cycle IN ({cyc}) AND CMTE_DSGN = 'J' AND CMTE_ID IS NOT NULL"""
    fresh = """try_cast(CAND_ELECTION_YR AS INT) BETWEEN cycle - 1 AND cycle + 6"""
    stale = q(con, f"SELECT count(*) FROM ccl WHERE {cur} AND NOT coalesce({fresh}, false)")[0][0]
    links = q(con, f"""SELECT DISTINCT cycle, CMTE_ID, CAND_ID, LINKAGE_ID FROM ccl
                       WHERE {cur} AND {fresh} ORDER BY 1, 2, 3, 4""")
    nonmember_links = 0
    for cycle, cmte, cand, link in links:
        bio = members.cand_to_bio.get(cand)
        if not bio:
            nonmember_links += 1
            continue
        nm = names.get(cmte, f"FEC committee {cmte}")
        part.setdefault((cycle, cmte), {}).setdefault(bio, []).append({
            "sort": (0, "", ""), "date": None,
            "label": f"FEC candidate-committee linkage lists {members.info[bio]['name']} "
                     f"({cand}) as linked to joint fundraising committee {nm}, {cycle} cycle",
            "url": f"https://www.fec.gov/data/committee/{cmte}/?cycle={cycle}",
            "source": "fec", "record": f"linkage:{link}"})
    pairs: dict[tuple[str, str, str], list[tuple[int, list[dict]]]] = {}
    for (cycle, cmte), bios in sorted(part.items()):
        ids = sorted(bios)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a, b = ids[i], ids[j]
                pick = []
                for bio in (a, b):  # strongest item per member: a distribution beats a linkage row
                    pick.append(sorted(bios[bio], key=lambda e: e["record"])[0])
                total = len(bios[a]) + len(bios[b])
                pairs.setdefault((a, b, cmte), []).append((cycle, pick, total, len(ids)))
    edges = []
    for (a, b, cmte), cyc_list in sorted(pairs.items()):
        cyc_list.sort(key=lambda t: t[0])
        ev = []
        for cy, pick, _, _ in reversed(cyc_list):
            for e in pick:
                ev.append({k: e[k] for k in ("label", "date", "url", "source", "record")})
        edges.append({
            "type": "fundraises_with", "family": "money", "basis": "filed",
            "from": {"kind": "member", "id": a}, "to": {"kind": "member", "id": b}, "directed": False,
            "via": {"id": f"pac:{cmte}", "name": names.get(cmte, f"FEC committee {cmte}")},
            "amount": {"low": None, "high": None, "exact": None},
            "count": len(cyc_list), "first": f"{cyc_list[0][0] - 1}-01-01", "last": f"{cyc_list[-1][0]}-12-31",
            "by_year": [{"y": cy, "n": 1, "low": None, "high": None, "exact": None} for cy, _, _, _ in cyc_list],
            "evidence": ev[:5], "evidence_total": sum(t for _, _, t, _ in cyc_list), "stat": None, "weak": False,
            "note": (f"joint fundraising committee with up to {max(k for _, _, _, k in cyc_list)} member "
                     "participants per cycle (FEC linkage); count = cycles; first/last are cycle bounds"),
        })
    multi = {c for (cy, c), bs in part.items() if len(bs) > 1}
    report["fundraises_with"] = {
        "jfc_linkage_rows_used": len(links), "jfc_linkage_rows_stale_dropped": stale,
        "jfc_linkage_rows_non_member": nonmember_links,
        "jfc_cycles_with_member_participants": len(part),
        "jfcs_with_two_or_more_members": len(multi),
        "pairs_edges": len(edges),
    }
    return edges


def org_records(con: duckdb.DuckDBPyConnection, used_ids: set[str], company_info: dict[str, dict],
                report: dict) -> list[dict]:
    """One OrgSummary for every org endpoint in our edges.

    pac:<id>  name/kind from the most recent loaded committee master record of that committee;
              a committee absent from every loaded committee master gets its id as name, kind other.
    co:<cik>  name/ticker/cik from SEC company_tickers.json (the company module may also emit the
              same id; the assembler merges by id).
    """
    used = sorted(used_ids)
    giver = {pid: (nm, kind, missing) for pid, nm, kind, missing in
             q(con, "SELECT pac_id, name, kind, missing_cm FROM giver_org ORDER BY 1")}
    out, missing_cm, missing_sec = [], [], []
    for oid in used:
        if oid.startswith("pac:"):
            nm, kind, miss = giver.get(oid, (oid.removeprefix("pac:"), "other", True))
            if miss:
                missing_cm.append(oid)
                nm, kind = oid.removeprefix("pac:"), "other"
            out.append({"id": oid, "name": nm, "kind": kind, "ticker": None, "cik": None, "sector": None})
        elif oid.startswith("co:"):
            info = company_info.get(oid)
            if info is None:
                missing_sec.append(oid)
                info = {"name": oid, "ticker": None, "cik": int(oid[3:]) if oid[3:].isdigit() else None}
            out.append({"id": oid, "name": info["name"], "kind": "company", "ticker": info["ticker"],
                        "cik": info["cik"], "sector": None})
        else:
            raise AssertionError(f"unexpected org id {oid}")
    have = {o["id"] for o in out}
    lacking = [oid for oid in used if oid not in have]
    assert not lacking, f"edge endpoints without an org record: {lacking[:10]}"
    report["org_records"] = {
        "pac": sum(1 for o in out if o["id"].startswith("pac:")),
        "company": sum(1 for o in out if o["id"].startswith("co:")),
        "pac_not_in_any_loaded_committee_master": missing_cm,
        "company_not_in_sec_tickers": missing_sec,
        "note": "company records are emitted here because the company module only writes companies "
                "that have trades; 4,697 pac_money edges were previously dropped by the assembler "
                "for lack of a co: record",
    }
    return out


def today_iso() -> str:
    return date.today().isoformat()
