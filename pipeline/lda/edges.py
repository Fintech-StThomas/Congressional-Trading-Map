"""LD-203 contributions -> lobbyist_money; LD-2 covered positions -> revolving_door."""
from __future__ import annotations

import re
from collections import Counter, defaultdict

from .build import COUNTED_TYPES, EXCLUDED_TYPES, METHOD_LABEL, OrgResolver, _key, fmt_usd, money, person
from .match import Matcher

DATE_RE = re.compile(r"\d{4}-\d\d-\d\d$")


# ---------------------------------------------------------------- LD-203 contributions

def latest_reports(by_year: dict[int, dict[str, dict]], rep: dict) -> list[dict]:
    """Amendment rule: an LD-203 amendment (MA, YA) restates the whole report, so for each filer (registrant id,
    lobbyist id or none), filing year and period only the most recently posted report is kept (ties broken by
    filing_uuid); every other version is superseded and its items are dropped."""
    groups: dict[tuple, list[dict]] = defaultdict(list)
    n = 0
    for year in sorted(by_year):
        for r in by_year[year].values():
            n += 1
            groups[((r.get("registrant") or {}).get("id"), (r.get("lobbyist") or {}).get("id"),
                    r["filing_year"], r["filing_period"])].append(r)
    kept, superseded, sup_items = [], 0, 0
    for g in groups.values():
        g.sort(key=lambda r: (r.get("dt_posted") or "", r["filing_uuid"]))
        kept.append(g[-1])
        superseded += len(g) - 1
        sup_items += sum(len(r.get("contribution_items") or []) for r in g[:-1])
    kept.sort(key=lambda r: r["filing_uuid"])
    rep.update(reports_read=n, reports_kept=len(kept), reports_superseded=superseded,
               items_in_superseded_reports=sup_items,
               reports_with_items=sum(1 for r in kept if r.get("contribution_items")))
    return kept


def _ident(it: dict) -> tuple:
    return (_key(it.get("contributor_name")), _key(it.get("payee_name")), _key(it.get("honoree_name")),
            it.get("contribution_type"), money(it.get("amount")), it.get("date"))


def dedupe_items(reports: list[dict], rep: dict) -> list[tuple]:
    """Double-reporting rule:
    (a) within a registrant and period, an identical item (contributor, payee, honoree, type, amount, date) on
        more than one report is kept once: from the registrant's own report if present, else from the report of
        the lowest lobbyist id (the firm and a lobbyist, or two lobbyists, reporting one PAC cheque). Identical
        copies inside one report are separate contributions and are all kept.
    (b) a lobbyist's identical item filed under two registrants in the same period is kept once (lowest
        registrant id)."""
    items = []
    types = Counter()
    for r in reports:
        reg, lob = r.get("registrant") or {}, r.get("lobbyist") or None
        for k, it in enumerate(r.get("contribution_items") or []):
            types[str(it.get("contribution_type"))] += 1
            items.append((r, reg, lob, k, it))
    rep["items_total"] = len(items)
    rep["items_by_type"] = dict(sorted(types.items()))

    def ka(r, reg, lob, it):
        return (reg.get("id"), r["filing_year"], r["filing_period"], _ident(it))

    def ra(r, lob):
        return (0 if lob is None else 1, (lob or {}).get("id") or 0, r["filing_uuid"])

    owner: dict[tuple, tuple] = {}
    for r, reg, lob, k, it in items:
        key, rank = ka(r, reg, lob, it), ra(r, lob)
        owner[key] = min(owner.get(key, rank), rank)
    step = [t for t in items if ra(t[0], t[2]) == owner[ka(t[0], t[1], t[2], t[4])]]
    dup_a = len(items) - len(step)
    owner_b: dict[tuple, tuple] = {}
    for r, reg, lob, k, it in step:
        if lob:
            key, rank = (lob["id"], r["filing_year"], r["filing_period"], _ident(it)), (reg.get("id") or 0, r["filing_uuid"])
            owner_b[key] = min(owner_b.get(key, rank), rank)
    kept = [t for t in step if not t[2] or owner_b[(t[2]["id"], t[0]["filing_year"], t[0]["filing_period"],
                                                     _ident(t[4]))] == ((t[1].get("id") or 0), t[0]["filing_uuid"])]
    rep["duplicates_removed"] = {"same_registrant_period": dup_a, "lobbyist_across_registrants": len(step) - len(kept)}
    assert len(kept) <= len(items)
    return kept


def contribution_rows(reports: list[dict], matcher: Matcher, rep: dict) -> list[dict]:
    rows, excl = [], Counter()
    for r, reg, lob, k, it in dedupe_items(reports, rep):
        t, amt = it.get("contribution_type"), money(it.get("amount"))
        if t in EXCLUDED_TYPES:
            excl[f"type_{t}"] += 1
            continue
        if t not in COUNTED_TYPES:
            excl["type_unknown"] += 1
            continue
        if amt is None or amt <= 0:
            excl["amount_missing_or_not_positive"] += 1
            continue
        date = it.get("date") if it.get("date") and DATE_RE.match(it["date"]) else None
        year = int(date[:4]) if date else r["filing_year"]
        bio, method = matcher.contribution(it.get("payee_name") or "", it.get("honoree_name") or "", year)
        rows.append({"uuid": r["filing_uuid"], "item": k, "url": r.get("filing_document_url"),
                     "filing_year": r["filing_year"], "registrant_id": reg.get("id"),
                     "registrant": (reg.get("name") or "").strip(), "lobbyist_id": (lob or {}).get("id"),
                     "lobbyist": person(lob), "type": t, "contributor": (it.get("contributor_name") or "").strip(),
                     "payee": (it.get("payee_name") or "").strip(), "honoree": (it.get("honoree_name") or "").strip(),
                     "amount": amt, "date": date, "year": year, "bio": bio, "method": method})
    rep["items_excluded"] = dict(sorted(excl.items()))
    return rows


FECA_ITEM_CEILING = 10_000  # no single FECA contribution to a candidate committee or leadership PAC can exceed this


def implausible(x: dict) -> bool:
    """A FECA item above any per-election limit is kept as filed but flagged (edge weak, listed in the report)."""
    return x["type"] == "feca" and x["amount"] > FECA_ITEM_CEILING


def money_edges(rows: list[dict], orgs: OrgResolver) -> list[dict]:
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for x in rows:
        if not x["bio"]:
            continue
        x["org"] = orgs.resolve("registrant", x["registrant_id"], x["registrant"])
        via = (f"lda:lobbyist-{x['lobbyist_id']}", f"{x['lobbyist']} (lobbyist, {x['registrant']})") \
            if x["lobbyist_id"] else ("", "")
        groups[(x["org"], x["bio"], via)].append(x)
    edges = []
    for (org, bio, via), xs in sorted(groups.items()):
        total = round(sum(x["amount"] for x in xs), 2)
        by_year: dict[int, list] = defaultdict(lambda: [0, 0.0])
        for x in xs:
            by_year[x["year"]][0] += 1
            by_year[x["year"]][1] += x["amount"]
        dates = sorted(x["date"] or f"{x['filing_year']}-01-01" for x in xs)
        types, methods = Counter(x["type"] for x in xs), Counter(x["method"] for x in xs)
        ev = sorted(xs, key=lambda x: (-x["amount"], x["date"] or "", x["uuid"], x["item"]))[:5]
        evidence = [{
            "label": (f"{x['contributor'] or x['registrant']} gave {fmt_usd(x['amount'])} "
                      f"({COUNTED_TYPES[x['type']]}) to {x['payee'] or 'unnamed payee'}"
                      f"{' honoring ' + x['honoree'] if x['honoree'] else ''}"
                      f"{' on ' + x['date'] if x['date'] else ''}; LD-203 filed by "
                      f"{x['lobbyist'] + ' of ' if x['lobbyist'] else ''}{x['registrant']}"
                      f" [match: {METHOD_LABEL[x['method']]}]"),
            "date": x["date"], "url": x["url"], "source": "lda", "record": x["uuid"]} for x in ev]
        note = "LD-203 " + ", ".join(f"{COUNTED_TYPES[t]} x{n}" for t, n in sorted(types.items())) + \
               "; matched by " + ", ".join(f"{m} x{n}" for m, n in sorted(methods.items()))
        edges.append({
            "type": "lobbyist_money", "family": "money", "basis": "filed",
            "from": {"kind": "org", "id": org}, "to": {"kind": "member", "id": bio}, "directed": True,
            "via": {"id": via[0], "name": via[1]} if via[0] else None,
            "amount": {"low": total, "high": total, "exact": total}, "count": len(xs),
            "first": dates[0], "last": dates[-1],
            "by_year": [{"y": y, "n": n, "low": round(s, 2), "high": round(s, 2), "exact": round(s, 2)}
                        for y, (n, s) in sorted(by_year.items())],
            "evidence": evidence, "evidence_total": len(xs), "stat": None,
            # weak: only honorary or meeting expenses (spent for the member, not given to the member's committee)
            "weak": "feca" not in types or any(implausible(x) for x in xs),
            "note": note + ("; includes an amount above any FECA limit (probable filer error)"
                            if any(implausible(x) for x in xs) else "")})
    return edges


# ---------------------------------------------------------------- LD-2 covered positions

def position_rows(by_year: dict[int, dict[str, dict]], rep: dict) -> list[dict]:
    """One row per (filing, lobbyist, position text). Amendment rule: for a registrant, client, year and period
    only the most recently posted filing is used (an amendment restates the report)."""
    groups: dict[tuple, list[dict]] = defaultdict(list)
    n = 0
    for year in sorted(by_year):
        for f in by_year[year].values():
            n += 1
            groups[((f.get("registrant") or {}).get("id"), (f.get("client") or {}).get("id"),
                    f["filing_year"], f["filing_period"])].append(f)
    kept = [sorted(g, key=lambda f: (f.get("dt_posted") or "", f["filing_uuid"]))[-1] for g in groups.values()]
    rep.update(filings_read=n, filings_kept=len(kept), filings_superseded=n - len(kept))
    rows = []
    for f in sorted(kept, key=lambda f: f["filing_uuid"]):
        seen = set()
        reg, cli = f.get("registrant") or {}, f.get("client") or {}
        for act in f.get("lobbying_activities") or []:
            for lb in act.get("lobbyists") or []:
                pos = " ".join((lb.get("covered_position") or "").split())
                lid = (lb.get("lobbyist") or {}).get("id")
                if not pos or (lid, pos) in seen:
                    continue
                seen.add((lid, pos))
                rows.append({"uuid": f["filing_uuid"], "url": f.get("filing_document_url"), "year": f["filing_year"],
                             "period": f.get("filing_period_display") or f["filing_period"],
                             "posted": (f.get("dt_posted") or "")[:10], "registrant": (reg.get("name") or "").strip(),
                             "client_id": cli.get("id"), "client": (cli.get("name") or "").strip(),
                             "lobbyist_id": lid, "lobbyist": person(lb.get("lobbyist")), "position": pos})
    rep["lobbyist_filing_rows"] = len(rows)
    return rows


def door_edges(rows: list[dict], orgs: OrgResolver, matcher: Matcher, rep: dict) -> tuple[list[dict], Counter]:
    cache: dict[tuple, tuple] = {}
    outcomes, unmatched = Counter(), Counter()
    groups: dict[tuple, dict] = defaultdict(dict)
    for x in rows:
        k = (x["position"], x["year"])
        if k not in cache:   # plausible period: the member served at some time up to the filing year
            cache[k] = matcher.positions(x["position"], set(range(1900, x["year"] + 1)))
        found, outcome = cache[k]
        outcomes[outcome] += 1
        if not found:
            unmatched[x["position"]] += 1
            continue
        client = orgs.resolve("client", x["client_id"], x["client"])
        for bio, weak, seg in found:
            groups[(bio, client, x["lobbyist_id"] or 0)].setdefault(x["uuid"], (x, weak, seg))
    rep["position_outcomes_by_row"] = dict(sorted(outcomes.items()))
    edges = []
    for (bio, client, lid), d in sorted(groups.items()):
        xs = sorted(d.values(), key=lambda t: (t[0]["posted"], t[0]["uuid"]), reverse=True)
        lob = xs[0][0]
        regs = sorted({x["registrant"] for x, _, _ in xs})
        by_year = Counter(x["year"] for x, _, _ in xs)
        posted = sorted(x["posted"] or f"{x['year']}-01-01" for x, _, _ in xs)
        edges.append({
            "type": "revolving_door", "family": "people", "basis": "filed",
            "from": {"kind": "member", "id": bio}, "to": {"kind": "org", "id": client}, "directed": False,
            "via": {"id": f"lda:lobbyist-{lid}", "name": f"{lob['lobbyist']} (lobbyist, {'; '.join(regs)})"},
            "amount": {"low": None, "high": None, "exact": None}, "count": len(xs),
            "first": posted[0], "last": posted[-1],
            "by_year": [{"y": y, "n": n, "low": None, "high": None, "exact": None} for y, n in sorted(by_year.items())],
            "evidence": [{"label": (f"{x['lobbyist']} lobbied for {x['client']} via {x['registrant']} "
                                    f"({x['period']} {x['year']}); covered position as filed: \"{x['position']}\""),
                          "date": x["posted"] or None, "url": x["url"], "source": "lda", "record": x["uuid"]}
                         for x, _, _ in xs[:5]],
            "evidence_total": len(xs), "stat": None, "weak": all(w for _, w, _ in xs),
            "note": f"covered position: {xs[0][0]['position']}"})
    return edges, unmatched
