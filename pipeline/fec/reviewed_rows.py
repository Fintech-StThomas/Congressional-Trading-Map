"""Single pas2 rows that were read against the giver's and the recipient's own filings and are not the giver's own gift
to the member's campaign: paid elsewhere, voided, or individuals' earmarked money the giver forwarded. Exact FEC SUB_IDs only (never names). Evidence per row: docs/fec-reviewed-rows.md.

Each row is a 24K row above $10,000, kept as pac_money until reviewed, whose other id (OTHER_ID) is a member's
campaign committee. The giver's own Schedule B line for that row, as OpenFEC serves it, shows one of these:
- other_committee: it names another committee as the payee (a joint fundraising committee, a leadership PAC, a
  party committee or a super PAC), and the member's campaign reports no receipt of that amount from the giver;
- state_or_local_race: the purpose or payee is a state or city campaign (a governor's or a mayor's race);
- ad_vendor: the payee is a media company and the purpose an advertisement;
- voided: the purpose reads VOIDED;
- forwarded_earmarks: the purpose reads "earmarked" (EARMARKED CONTRIBUTION, FORWARD EARMARKED CONTRIBUTIONS) or the
  individual donors are itemised beside it as earmark memo lines, and the recipient lists them as earmarked receipts
  through the giver. MoveOn.org Political Action and the Susan B. Anthony List Candidate Fund are not on the conduit
  list (conduits.LISTED) because most of their rows in the same cycles are round direct gifts.
Such a row is dropped as `drop:reviewed_not_received` and counted in meta.json `exclusions.reviewed_not_received`.
Rows above $10,000 that were reviewed and are kept as filed are in validate_fec_conduits.ALLOWED_ROWS.
"""
from __future__ import annotations

from .load import q

RULE = "drop:reviewed_not_received"
KEY = "reviewed_not_received"
REASONS = {
    "other_committee": "paid to another committee (joint fundraising, leadership PAC, party or super PAC)",
    "state_or_local_race": "for a state or city race",
    "ad_vendor": "paid to an advertising vendor",
    "voided": "voided by the giver",
    "forwarded_earmarks": "individuals' earmarked contributions forwarded by the giver",
}
# SUB_ID -> (reason, giver committee, member (bioguide), amount as filed, date as filed, payee on the giver's Schedule B)
ROWS: dict[str, tuple[str, str, str, int, str, str]] = {
    "4082420181586075422": ("other_committee", "C00488486", "N000002", 100000, "2018-07-03", "SENATE MAJORITY PAC"),
    "4091020091117979305": ("voided", "C00027342", "D000607", 50000, "2009-03-11", "DONNELLY FOR CONGRESS"),
    "4102920261615854495": ("state_or_local_race", "C00007542", "B000287", 39200, "2026-08-05", "BECERRA, XAVIER"),
    "4100620261611986561": ("other_committee", "C00734822", "C001129", 35000, "2026-09-11", "MIKE COLLINS VICTORY"),
    "4030120241877894371": ("other_committee", "C00869768", "S001150", 25000, "2024-02-12", "STANDING STRONG PAC"),
    "4030120241877894476": ("other_committee", "C00869750", "S001150", 25000, "2024-02-09", "STANDING STRONG PAC"),
    "4072520201794563330": ("other_committee", "C00149013", "C001056", 25000, "2020-06-24", "CORNYN MAJORITY COMMITTEE"),
    "4100120141223703639": ("state_or_local_race", "C00007542", "E000287", 25000, "2013-09-04", "CHICAGO FOR RAHM EMANUEL"),
    "4121120211385115934": ("other_committee", "C00760124", "L000594", 20600, "2020-12-11", "TEAM LOEFFLER"),
    "4061020111140730873": ("ad_vendor", "C00405761", "B000575", 20094, "2010-09-02", "LEARFIELD COMMUNICATIONS, INC."),
    "4082620242015060127": ("other_committee", "C00782458", "M001165", 20000, "2023-09-25", "MCCARTHY VICTORY FUND"),
    "4082720141221346569": ("state_or_local_race", "C00007542", "E000287", 20000, "2014-07-23", "CHICAGO FOR RAHM EMANUEL"),
    "4110220181608549285": ("other_committee", "C00372979", "S001176", 20000, "2018-09-10", "SCALISE LEADERSHIP FUND"),
    "4031520061064894587": ("other_committee", "C00295360", "E000194", 18250, "2006-02-17", "ENSIGN MAJORITY COMMITTEE THE"),
    "4011320161260571479": ("other_committee", "C00038604", "L000578", 15000, "2012-03-26", "CPE VICTORY FUND"),
    "4040720161282970879": ("other_committee", "C00371385", "R000570", 15000, "2016-03-16", "TEAM RYAN"),
    "4052720161293523498": ("other_committee", "C00015933", "R000570", 15000, "2016-03-03", "TEAM RYAN"),
    "4080320161307886846": ("other_committee", "C00279497", "R000570", 15000, "2016-01-11", "TEAM RYAN"),
    "4091620081095819004": ("other_committee", "C00024281", "B000420", 15000, "2007-12-21", "REPUBLICAN NATIONAL COMMITTEE"),
    "4100220261600398534": ("other_committee", "C00094573", "B001319", 15000, "2026-09-23", "BRITT SENATE VICTORY"),
    "4111820141231568559": ("other_committee", "C00433805", "M001156", 15000, "2014-10-09", "MCHENRY LEADERSHIP FUND"),
    "4110920261646824317": ("ad_vendor", "C00943332", "S001221", 13271, "2026-09-25", "MAYFAIR MEDIA GROUP, LLC"),
    "4101820221589103175": ("other_committee", "C00615203", "F000479", 12500, "2022-09-09", "DSCC PA WI VICTORY 2022"),
    "4031920241885288025": ("other_committee", "C00440651", "D000618", 11883, "2023-10-24", "DAINES SENATE MAJORITY FUND"),
    "4080420061068110327": ("forwarded_earmarks", "C00341396", "R000568", 105295, "2006-02-21", "CIRO D RODRIGUEZ FOR CONGRESS"),
    "4030620131185082313": ("forwarded_earmarks", "C00341396", "B001230", 98046, "2012-09-13", "TAMMY BALDWIN FOR SENATE"),
    "4102620061070994873": ("forwarded_earmarks", "C00341396", "M001168", 88112, "2006-06-29", "PATRICK MURPHY FOR CONGRESS"),
    "4030620131185082295": ("forwarded_earmarks", "C00341396", "M001169", 83209, "2012-09-13", "FRIENDS OF CHRIS MURPHY"),
    "4091120081095743367": ("forwarded_earmarks", "C00341396", "H001049", 60519, "2008-06-27", "HAGAN SENATE COMMITTEE INC"),
    "4080420061068110328": ("forwarded_earmarks", "C00341396", "R000568", 51559, "2006-02-22", "CIRO D RODRIGUEZ FOR CONGRESS"),
    "4091120081095743368": ("forwarded_earmarks", "C00341396", "S001181", 47721, "2008-06-30", "JEANNE SHAHEEN FOR SENATE"),
    "4091120081095743366": ("forwarded_earmarks", "C00341396", "S001170", 42195, "2008-06-30", "CAROL SHEA-PORTER FOR CONGRESS"),
    "4030620131185082312": ("forwarded_earmarks", "C00341396", "B001230", 38337, "2012-08-20", "TAMMY BALDWIN FOR SENATE"),
    "4072720171439249682": ("forwarded_earmarks", "C00341396", "O000174", 22407, "2017-06-20", "JON OSSOFF FOR CONGRESS"),
    "4011420091104072303": ("forwarded_earmarks", "C00332296", "P000588", 12283, "2008-05-20", "PEOPLE FOR PEARCE"),
    "4020420091106954828": ("forwarded_earmarks", "C00332296", "D000601", 12120, "2008-09-24", "ELIZABETH DOLE COMMITTEE INC"),
    "4061120191657928519": ("forwarded_earmarks", "C00332296", "S000522", 11690, "2018-10-15", "FRIENDS OF CHRIS SMITH"),
    "4072820171442270387": ("forwarded_earmarks", "C00332296", "G000584", 11050, "2017-05-23", "GREG FOR MONTANA"),
}
REASON = ("Single FEC contribution rows above $10,000 that a PAC filed against a member's campaign, read by hand "
          "against the PAC's and the campaign's own filings: the PAC's own report shows the money was paid to another "
          "committee (joint fundraising, leadership PAC, party or super PAC), went to a state or city race or an "
          "advertising vendor, was voided, or was individuals' earmarked contributions the PAC forwarded. Not counted "
          "as PAC money. FEC row ids (SUB_ID): " + ", ".join(sorted(ROWS)) + ".")


def when_sql() -> str:
    """The CASE branch build.classify_rows places straight after the conduit rule."""
    ids = ",".join(f"'{s}'" for s in sorted(ROWS))
    return f"WHEN CAST(SUB_ID AS VARCHAR) IN ({ids}) THEN '{RULE}'"


def exclusions(con) -> dict:
    """{KEY: {rows, dollars, ...}}: the rows this rule took (all of them go to members' campaigns), per reason, and
    the listed ids this rule did not take (absent from the files or taken by an earlier rule; reported, never an error)."""
    got = q(con, f"SELECT CAST(SUB_ID AS VARCHAR), amt FROM p_rules WHERE rule = '{RULE}' ORDER BY 1")
    seen = {s: float(a or 0) for s, a in got}
    by = {k: {"rows": 0, "dollars": 0.0} for k in REASONS}
    for s, a in seen.items():
        b = by[ROWS[s][0]]
        b["rows"] += 1
        b["dollars"] = round(b["dollars"] + a, 2)
    return {KEY: {"rows": len(seen), "dollars": round(sum(seen.values()), 2), "reason": REASON,
                  "by_reason": by, "listed": len(ROWS), "not_taken": sorted(set(ROWS) - set(seen))}}
