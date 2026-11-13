#!/usr/bin/env node
// Generates a small, obviously fake, contract-conformant dataset into
// web/fixtures/data/. Everything here is invented: the names, companies,
// tickers, amounts and record links. The site stamps "SAMPLE DATA" on every
// page while it runs on these files.
//
// Shape follows docs/data-dictionary.md. Run: npm run fixtures

import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "fixtures", "data");

// ---- deterministic randomness ------------------------------------------------
let seed = 20261113;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const addDays = (date, days) => {
  const t = new Date(date + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
const daysBetween = (a, b) =>
  Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);

// ---- people ----------------------------------------------------------------------
// Bioguide-shaped ids in an X range that no real member uses.
const MEMBERS = [
  { id: "X000001", first: "Ada", last: "Sampleworth", party: "D", state: "CA", chamber: "sen", district: null, since: "2009-01-03" },
  { id: "X000002", first: "Bram", last: "Placeholder", party: "R", state: "CA", chamber: "sen", district: null, since: "2017-01-03" },
  { id: "X000003", first: "Cora", last: "Fixture", party: "D", state: "CA", chamber: "rep", district: 12, since: "2013-01-03" },
  { id: "X000004", first: "Dale", last: "Mockley", party: "R", state: "CA", chamber: "rep", district: 48, since: "2019-01-03" },
  { id: "X000005", first: "Esme", last: "Testwood", party: "R", state: "TX", chamber: "sen", district: null, since: "2003-01-03" },
  { id: "X000006", first: "Finn", last: "Dummett", party: "R", state: "TX", chamber: "sen", district: null, since: "2013-01-03" },
  { id: "X000007", first: "Gail", last: "Stubbs", party: "D", state: "TX", chamber: "rep", district: 7, since: "2011-01-03" },
  { id: "X000008", first: "Hal", last: "Exampleton", party: "I", state: "VT", chamber: "sen", district: null, since: "2007-01-03" },
  { id: "X000009", first: "Iris", last: "Notreal", party: "D", state: "VT", chamber: "rep", district: 0, since: "2023-01-03" },
  { id: "X000010", first: "Jules", last: "Fakeman", party: "R", state: "OH", chamber: "sen", district: null, since: "2011-01-03" },
  { id: "X000011", first: "Kit", last: "Synthwick", party: "D", state: "OH", chamber: "rep", district: 9, since: "2001-01-03" },
  // A former member: not current, so not on the board, but has a case file.
  { id: "X000012", first: "Lou", last: "Pretendo", party: "R", state: "NY", chamber: "rep", district: 21, since: "2005-01-03", until: "2019-01-03" },
];

// ---- organisations -------------------------------------------------------------
const ORGS = [
  { id: "co:9000001", name: "Example Dynamics Inc", kind: "company", ticker: "XMPL", cik: 9000001, sector: "Aircraft & parts" },
  { id: "co:9000002", name: "Placeholder Petroleum Corp", kind: "company", ticker: "PHPC", cik: 9000002, sector: "Crude petroleum & natural gas" },
  { id: "co:9000003", name: "Sample Savings Bank", kind: "company", ticker: "SMSB", cik: 9000003, sector: "State commercial banks" },
  { id: "co:9000004", name: "Mockup Motors Co", kind: "company", ticker: "MOKM", cik: 9000004, sector: "Motor vehicles" },
  { id: "co:9000005", name: "Fixture Pharmaceuticals", kind: "company", ticker: "FXPH", cik: 9000005, sector: "Pharmaceutical preparations" },
  { id: "co:9000006", name: "Stubworks Defense Systems", kind: "company", ticker: "STUB", cik: 9000006, sector: "Guided missiles & space vehicles" },
  { id: "co:9000007", name: "Dummy Data Systems", kind: "company", ticker: "DUMY", cik: 9000007, sector: "Prepackaged software" },
  { id: "co:9000008", name: "Testbed Telecom", kind: "company", ticker: "TBTL", cik: 9000008, sector: "Telephone communications" },
  { id: "co:9000009", name: "Notreal Realty Trust", kind: "company", ticker: "NRRT", cik: 9000009, sector: "Real estate investment trusts" },
  { id: "co:9000010", name: "Synthetic Semiconductor Group", kind: "company", ticker: "SYNS", cik: 9000010, sector: "Semiconductors" },
  { id: "co:9000011", name: "Imaginary Insurance Holdings", kind: "company", ticker: null, cik: 9000011, sector: "Fire, marine & casualty insurance" },
  { id: "co:9000012", name: "Pretend Power & Light", kind: "company", ticker: "PPWL", cik: 9000012, sector: "Electric services" },
  { id: "tk:SMPLX", name: "SMPLX (sample fund, no SEC match)", kind: "other", ticker: "SMPLX", cik: null, sector: null },
  { id: "tk:FKCOIN", name: "FKCOIN (sample crypto asset)", kind: "other", ticker: "FKCOIN", cik: null, sector: null },
  { id: "pac:C90000001", name: "Committee for Sample Policy", kind: "pac", ticker: null, cik: null, sector: null },
  { id: "pac:C90000002", name: "Mock Builders Association PAC", kind: "pac", ticker: null, cik: null, sector: null },
  { id: "pac:C90000003", name: "Sample State Democratic Party", kind: "party", ticker: null, cik: null, sector: null },
  { id: "pac:C90000004", name: "Example Republican Committee", kind: "party", ticker: null, cik: null, sector: null },
  { id: "pac:C90000005", name: "Americans for an Example Future", kind: "super_pac", ticker: null, cik: null, sector: null },
  { id: "pac:C90000006", name: "Placeholder Prosperity Fund", kind: "super_pac", ticker: null, cik: null, sector: null },
  { id: "cmte:SSXA", name: "Senate Committee on Sample Affairs", kind: "committee", ticker: null, cik: null, sector: null },
  { id: "cmte:HSXE", name: "House Committee on Example Energy", kind: "committee", ticker: null, cik: null, sector: null },
  { id: "lda:client-90001", name: "Fixture Advocates LLC", kind: "lobby", ticker: null, cik: null, sector: null },
  { id: "lda:registrant-90002", name: "Mockingbird Strategies", kind: "lobby", ticker: null, cik: null, sector: null },
  { id: "pac:C90000007", name: "Sample Leadership Fund (leadership PAC)", kind: "pac", ticker: null, cik: null, sector: null },
];
// Small committees that only ever appear in ledgers (no full Edge objects).
const LEDGER_PACS = Array.from({ length: 40 }, (_, i) => ({
  id: `pac:C9100${String(i + 1).padStart(4, "0")}`,
  name: `Sample Ledger Committee ${String(i + 1).padStart(2, "0")} PAC`,
  kind: i % 9 === 0 ? "party" : "pac",
  ticker: null, cik: null, sector: null,
}));
ORGS.push(...LEDGER_PACS);
const orgById = Object.fromEntries(ORGS.map((o) => [o.id, o]));

// Which records each source id stands for (listed in meta.json).
const SOURCE_FOR = {
  traded: "ptr",
  owns: "fd_annual",
  position: "fd_annual",
  pac_money: "fec_pas2",
  employee_money: "fec_indiv",
  lobbyist_money: "lda_ld203",
  outside_spending: "fec_ie",
  paid_travel: "house_travel",
  revolving_door: "lda_ld1",
  oversees: "committees",
  funds: "fec_pas2",
  fundraises_with: "fec_jfc",
  shared_donors: "fec_indiv",
  traded_together: "ptr",
  legislates_with: "congress_bills",
  shared_staff: "house_disbursements",
  sits_with: "committees",
};
const FAMILY = {
  traded: "holding", owns: "holding", position: "holding",
  pac_money: "money", employee_money: "money", lobbyist_money: "money",
  outside_spending: "money", paid_travel: "money", funds: "money",
  fundraises_with: "money", shared_donors: "money",
  revolving_door: "people", oversees: "people", shared_staff: "people",
  traded_together: "holding",
  sits_with: "context", legislates_with: "context",
};
const DIRECTED = {
  traded: true, owns: true, position: true,
  pac_money: true, employee_money: true, lobbyist_money: true, outside_spending: true, paid_travel: true,
  revolving_door: false, oversees: false, funds: true,
  fundraises_with: false, shared_donors: false, traded_together: false, legislates_with: false, shared_staff: false, sits_with: false,
};
// Directions per the contract: member -> org for holdings, org -> member for money.
const ORG_TO_MEMBER = new Set(["pac_money", "employee_money", "lobbyist_money", "outside_spending", "paid_travel"]);

const PTR_RANGES = [
  [1001, 15000], [15001, 50000], [50001, 100000], [100001, 250000], [250001, 500000], [500001, 1000000], [1000001, 5000000],
];

const edges = [];

function makeEdge({ type, member, other, otherKind = "org", years, amountKind = "exact", scale = 5000, via = null, weak = false, derived = false, note = null, count }) {
  const m = { kind: "member", id: member };
  const o = { kind: otherKind, id: other };
  let from, to;
  if (otherKind === "member") {
    if (DIRECTED[type]) { from = m; to = o; } else { [from, to] = [m, o].sort((a, b) => a.id.localeCompare(b.id)); }
  } else if (ORG_TO_MEMBER.has(type)) { from = o; to = m; }
  else { from = m; to = o; }

  const by_year = [];
  let total = 0;
  const lows = []; const highs = []; const exacts = [];
  for (const y of years) {
    const n = between(1, 6);
    total += n;
    if (amountKind === "range") {
      const [lo, hi] = pick(PTR_RANGES.slice(0, 4));
      lows.push(lo * n); highs.push(hi * n);
      by_year.push({ y, n, low: lo * n, high: hi * n, exact: null });
    } else if (amountKind === "exact") {
      const ex = Math.round((scale * (0.4 + rand() * 1.6) * n) / 50) * 50;
      exacts.push(ex);
      by_year.push({ y, n, low: null, high: null, exact: ex });
    } else {
      by_year.push({ y, n, low: null, high: null, exact: null });
    }
  }
  const sum = (a) => (a.length ? a.reduce((s, v) => s + v, 0) : null);
  const amount =
    amountKind === "range" ? { low: sum(lows), high: sum(highs), exact: null }
    : amountKind === "exact" ? { low: null, high: null, exact: sum(exacts) }
    : { low: null, high: null, exact: null };
  const first = iso(years[0], between(1, 6), between(1, 28));
  const last = iso(years[years.length - 1], between(6, 12), between(1, 28));
  const n = count ?? total;
  const otherName = otherKind === "member" ? memberName(other) : orgById[other].name;
  const evidence = [];
  const evN = Math.min(5, n);
  for (let i = 0; i < evN; i++) {
    const y = years[years.length - 1 - (i % years.length)];
    const date = iso(y, between(1, 12), between(1, 28));
    const rec = `SAMPLE-${type.toUpperCase().slice(0, 4)}-${sha1(type + member + other + i).slice(0, 8)}`;
    evidence.push({
      label: evidenceLabel(type, memberName(member), otherName, by_year.find((b) => b.y === y), via),
      date: i === 3 && weak ? null : date,
      url: i === 4 ? null : `https://example.org/sample-record/${SOURCE_FOR[type]}/${rec}`,
      source: SOURCE_FOR[type],
      record: i === 2 && weak ? null : rec,
    });
  }
  evidence.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const e = {
    id: sha1(`${type}|${from.id}|${to.id}`).slice(0, 12),
    type,
    family: FAMILY[type],
    basis: derived ? "derived" : "filed",
    from, to,
    directed: DIRECTED[type],
    via,
    amount,
    count: n,
    first, last,
    by_year,
    evidence,
    evidence_total: n,
    stat: derived ? { observed: n, expected: Math.max(1, Math.round(n / (3 + rand() * 3))), lift: 0, method: type === "shared_donors" ? "Hypergeometric test on shared individual donors versus each member's donor pool, p < 0.001" : "Same-ticker, same-week trades versus a shuffled-date baseline, 1,000 permutations" } : null,
    weak,
    note,
  };
  if (e.stat) e.stat.lift = Math.round((e.stat.observed / e.stat.expected) * 10) / 10;
  edges.push(e);
  return e;
}

function memberName(id) {
  const m = MEMBERS.find((x) => x.id === id);
  return `${m.first} ${m.last}`;
}

function evidenceLabel(type, member, other, yearRow, via) {
  const amt = yearRow?.exact != null ? `$${yearRow.exact.toLocaleString("en-US")}` : yearRow?.low != null ? `$${yearRow.low.toLocaleString("en-US")}–$${yearRow.high.toLocaleString("en-US")}` : "";
  switch (type) {
    case "traded": return `SAMPLE periodic transaction report: ${member} reported a trade in ${other} ${amt}`.trim();
    case "owns": return `SAMPLE annual disclosure: ${member} lists a holding in ${other}`;
    case "position": return `SAMPLE annual disclosure: ${member} lists an unpaid board seat at ${other}`;
    case "pac_money": return `SAMPLE FEC filing: ${via ? via.name : other} gave ${amt} to ${member}'s campaign`;
    case "employee_money": return `SAMPLE FEC itemised receipts: ${other} employees gave ${amt} to ${member}`;
    case "lobbyist_money": return `SAMPLE LD-203 report: lobbyists for ${other} reported ${amt} to ${member}`;
    case "outside_spending": return `SAMPLE independent expenditure: ${other} spent ${amt} on ads about ${member}`;
    case "paid_travel": return `SAMPLE privately funded travel report: ${other} paid for a trip by ${member}`;
    case "revolving_door": return `SAMPLE LD-1 registration: a former ${member} staffer registered to lobby for ${other}`;
    case "oversees": return `SAMPLE committee roster: ${member} sits on ${via ? via.name : other}, which has jurisdiction over ${other}`;
    case "funds": return `SAMPLE FEC filing: ${member}'s leadership PAC gave ${amt} to ${other}`;
    case "fundraises_with": return `SAMPLE joint fundraising agreement naming ${member} and ${other}`;
    case "shared_donors": return `SAMPLE donor overlap: individual donors who gave to both ${member} and ${other}`;
    case "traded_together": return `SAMPLE trade pair: ${member} and ${other} traded the same ticker the same week`;
    case "legislates_with": return `SAMPLE bill record: ${member} and ${other} co-sponsored a bill`;
    case "shared_staff": return `SAMPLE disbursement record: one staffer was paid by both ${member} and ${other}`;
    case "sits_with": return `SAMPLE committee roster: ${member} and ${other} sit on the same committee`;
    default: return `SAMPLE record`;
  }
}

const yrs = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---- member X000001: twelve strings (layout check) ------------------------------
const A = "X000001";
makeEdge({ type: "traded", member: A, other: "co:9000001", years: yrs(2014, 2022), amountKind: "range" });
makeEdge({ type: "pac_money", member: A, other: "co:9000001", years: [2014, 2016, 2018, 2020], scale: 5000, via: { id: "pac:C90000901", name: "Example Dynamics Inc PAC (sample)" } });
makeEdge({ type: "employee_money", member: A, other: "co:9000001", years: [2016, 2018, 2020, 2022], scale: 9000 });
makeEdge({ type: "oversees", member: A, other: "co:9000001", years: yrs(2013, 2024), amountKind: "none", via: { id: "cmte:SSXA", name: "Senate Committee on Sample Affairs" }, count: 12 });
makeEdge({ type: "traded", member: A, other: "co:9000005", years: [2019, 2020, 2021], amountKind: "range" });
makeEdge({ type: "owns", member: A, other: "co:9000003", years: yrs(2015, 2023), amountKind: "range", weak: true, note: "Value reported as a range on the annual report; one year's report lists no value." });
makeEdge({ type: "lobbyist_money", member: A, other: "lda:client-90001", years: [2018, 2020], scale: 2500 });
makeEdge({ type: "outside_spending", member: A, other: "pac:C90000005", years: [2020], scale: 400000 });
makeEdge({ type: "paid_travel", member: A, other: "co:9000008", years: [2017], scale: 6200, count: 1 });
makeEdge({ type: "revolving_door", member: A, other: "lda:registrant-90002", years: [2019, 2021], amountKind: "none", count: 2 });
makeEdge({ type: "fundraises_with", member: A, other: "X000003", otherKind: "member", years: [2018, 2020, 2022], scale: 30000 });
makeEdge({ type: "shared_donors", member: A, other: "X000008", otherKind: "member", years: [2016, 2018, 2020, 2022], amountKind: "none", derived: true, count: 14 });
makeEdge({ type: "sits_with", member: A, other: "X000005", otherKind: "member", years: yrs(2015, 2024), amountKind: "none", count: 10 });
makeEdge({ type: "legislates_with", member: A, other: "X000010", otherKind: "member", years: [2019, 2021, 2023], amountKind: "none", count: 6 });
makeEdge({ type: "position", member: A, other: "co:9000011", years: [2010, 2011, 2012], amountKind: "none", count: 3, weak: true, note: "Position listed on reports filed before the member joined; dates as reported." });

// ---- other members --------------------------------------------------------------
const B = "X000002";
makeEdge({ type: "traded", member: B, other: "co:9000003", years: yrs(2017, 2025), amountKind: "range" });
makeEdge({ type: "pac_money", member: B, other: "co:9000003", years: [2018, 2020, 2022, 2024], scale: 7500, via: { id: "pac:C90000903", name: "Sample Savings Bank PAC (sample)" } });
makeEdge({ type: "lobbyist_money", member: B, other: "co:9000003", years: [2019, 2021, 2023], scale: 3000 });
makeEdge({ type: "traded", member: B, other: "co:9000002", years: [2020, 2021, 2022], amountKind: "range" });
makeEdge({ type: "pac_money", member: B, other: "pac:C90000004", years: [2018, 2024], scale: 10000 });
makeEdge({ type: "outside_spending", member: B, other: "pac:C90000006", years: [2022], scale: 850000 });
makeEdge({ type: "traded_together", member: B, other: "X000006", otherKind: "member", years: [2020, 2021], amountKind: "none", derived: true, count: 9 });
makeEdge({ type: "sits_with", member: B, other: "X000001", otherKind: "member", years: yrs(2019, 2024), amountKind: "none", count: 6 });

const C = "X000003";
makeEdge({ type: "traded", member: C, other: "co:9000007", years: yrs(2014, 2024), amountKind: "range" });
makeEdge({ type: "traded", member: C, other: "co:9000010", years: [2020, 2021, 2023, 2024], amountKind: "range" });
makeEdge({ type: "traded", member: C, other: "tk:SMPLX", years: [2016, 2017], amountKind: "range", weak: true, note: "Ticker filed without an SEC match." });
makeEdge({ type: "employee_money", member: C, other: "co:9000007", years: [2016, 2018, 2020, 2022, 2024], scale: 12000 });
makeEdge({ type: "pac_money", member: C, other: "pac:C90000003", years: [2014, 2016, 2018], scale: 5000 });
makeEdge({ type: "shared_staff", member: C, other: "X000004", otherKind: "member", years: [2021, 2022], amountKind: "none", count: 2 });

const D = "X000004";
makeEdge({ type: "traded", member: D, other: "co:9000004", years: [2019, 2020, 2021], amountKind: "range" });
makeEdge({ type: "traded", member: D, other: "tk:FKCOIN", years: [2021, 2022], amountKind: "range", weak: true });
makeEdge({ type: "pac_money", member: D, other: "pac:C90000002", years: [2020, 2022, 2024], scale: 4000 });
makeEdge({ type: "paid_travel", member: D, other: "lda:client-90001", years: [2023], scale: 3100, count: 1 });

const E = "X000005";
makeEdge({ type: "traded", member: E, other: "co:9000002", years: yrs(2012, 2024), amountKind: "range" });
makeEdge({ type: "pac_money", member: E, other: "co:9000002", years: [2008, 2010, 2014, 2016, 2018, 2020], scale: 10000, via: { id: "pac:C90000902", name: "Placeholder Petroleum PAC (sample)" } });
makeEdge({ type: "oversees", member: E, other: "co:9000002", years: yrs(2009, 2024), amountKind: "none", via: { id: "cmte:SSXA", name: "Senate Committee on Sample Affairs" }, count: 16 });
makeEdge({ type: "position", member: E, other: "co:9000012", years: yrs(2004, 2008), amountKind: "none", count: 5 });
makeEdge({ type: "funds", member: E, other: "X000006", otherKind: "member", years: [2012, 2014, 2018], scale: 5000, via: { id: "pac:C90000007", name: "Sample Leadership Fund (leadership PAC)" } });
makeEdge({ type: "outside_spending", member: E, other: "pac:C90000006", years: [2014, 2020], scale: 600000 });
makeEdge({ type: "oversees", member: E, other: "cmte:SSXA", years: yrs(2009, 2024), amountKind: "none", count: 16, note: "Committee seat itself, as a node." });

const F = "X000006";
makeEdge({ type: "traded", member: F, other: "co:9000006", years: [2015, 2016, 2019, 2023], amountKind: "range" });
makeEdge({ type: "pac_money", member: F, other: "co:9000006", years: [2016, 2018, 2024], scale: 5000, via: { id: "pac:C90000906", name: "Stubworks Defense PAC (sample)" } });

const G = "X000007";
makeEdge({ type: "traded", member: G, other: "co:9000009", years: [2013, 2015], amountKind: "range" });
makeEdge({ type: "employee_money", member: G, other: "co:9000005", years: [2012, 2016, 2020], scale: 4000 });
makeEdge({ type: "legislates_with", member: G, other: "X000011", otherKind: "member", years: [2013, 2015, 2017], amountKind: "none", count: 4 });

const H = "X000008";
makeEdge({ type: "pac_money", member: H, other: "pac:C90000001", years: [2006, 2012, 2018, 2024], scale: 2500 });
makeEdge({ type: "paid_travel", member: H, other: "co:9000012", years: [2015], scale: 2400, count: 1, weak: true });
makeEdge({ type: "revolving_door", member: H, other: "co:9000012", years: [2016], amountKind: "none", count: 1 });

// X000009: exactly two strings (layout check).
const I = "X000009";
makeEdge({ type: "pac_money", member: I, other: "pac:C90000003", years: [2022, 2024], scale: 5000 });
makeEdge({ type: "traded", member: I, other: "co:9000010", years: [2024], amountKind: "range", count: 1 });

const J = "X000010";
makeEdge({ type: "traded", member: J, other: "co:9000004", years: yrs(2013, 2018), amountKind: "range" });
makeEdge({ type: "pac_money", member: J, other: "co:9000004", years: [2012, 2016], scale: 5000 });
makeEdge({ type: "outside_spending", member: J, other: "pac:C90000005", years: [2016], scale: 250000 });

const K = "X000011";
makeEdge({ type: "pac_money", member: K, other: "co:9000012", years: [2002, 2004, 2008, 2014], scale: 5000 });
makeEdge({ type: "oversees", member: K, other: "cmte:HSXE", years: yrs(2003, 2020), amountKind: "none", count: 18 });
makeEdge({ type: "oversees", member: K, other: "co:9000012", years: yrs(2003, 2020), amountKind: "none", via: { id: "cmte:HSXE", name: "House Committee on Example Energy" }, count: 18 });

const L = "X000012";
makeEdge({ type: "traded", member: L, other: "co:9000008", years: [2013, 2014, 2016], amountKind: "range" });
makeEdge({ type: "pac_money", member: L, other: "co:9000008", years: [2006, 2010, 2014], scale: 5000 });
makeEdge({ type: "lobbyist_money", member: L, other: "co:9000008", years: [2012, 2014], scale: 2000 });
makeEdge({ type: "funds", member: L, other: "X000004", otherKind: "member", years: [2018], scale: 2000, count: 1 });

// ---- trades -------------------------------------------------------------------------
const OWNERS = ["self", "spouse", "joint", "dependent", "unspecified"];
const ACTIONS = ["buy", "sell", "sell", "buy", "exchange", "other"];
function makeTrades(memberId, n, pool) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = between(2012, 2026);
    const m = y === 2012 ? between(7, 12) : y === 2026 ? between(1, 10) : between(1, 12);
    const date = rand() < 0.04 ? null : iso(y, m, between(1, 28));
    const lag = between(3, rand() < 0.15 ? 220 : 44);
    const available = date ? addDays(date, lag) : iso(y, Math.min(12, m + 1), 15);
    const org = pick(pool);
    const o = org ? orgById[org] : null;
    const nullTicker = !o || rand() < 0.08;
    const [low, high] = rand() < 0.03 ? [null, null] : pick(PTR_RANGES);
    const lag_days = date ? daysBetween(date, available) : null;
    const asset_class = o?.id.startsWith("tk:FK") ? "crypto" : o?.id.startsWith("tk:") ? "fund" : !o ? pick(["bond", "private", "unknown", "other"]) : rand() < 0.1 ? "option" : "stock";
    out.push({
      id: `SAMPLE-EVT-${sha1(memberId + i).slice(0, 10)}`,
      version: rand() < 0.1 ? 2 : 1,
      amended: false,
      date,
      available,
      lag_days,
      late: lag_days == null ? null : lag_days > 45,
      owner: pick(OWNERS),
      action: pick(ACTIONS),
      partial: rand() < 0.2 ? true : rand() < 0.5 ? false : null,
      ticker: nullTicker ? null : o.ticker,
      asset: o ? `${o.name}${asset_class === "option" ? " call options" : " common stock"}` : pick(["Municipal bond (sample county)", "Private placement LP interest (sample)", "Asset description illegible on scan (sample)", "Treasury note (sample)"]),
      asset_class,
      low, high,
      org: nullTicker ? null : o.id,
      ticker_source: nullTicker ? null : o.id.startsWith("tk:") ? "filed" : "resolved",
      doc: `S${memberId.slice(-3)}${String(Math.floor(i / 6)).padStart(4, "0")}`,
    });
    out[out.length - 1].amended = out[out.length - 1].version > 1;
  }
  out.sort((a, b) => (b.date ?? b.available ?? "").localeCompare(a.date ?? a.available ?? ""));
  return out;
}
const TRADES = {
  X000001: makeTrades("X000001", 186, ["co:9000001", "co:9000001", "co:9000005", "co:9000003", null]),
  X000002: makeTrades("X000002", 42, ["co:9000003", "co:9000002", null]),
  X000003: makeTrades("X000003", 64, ["co:9000007", "co:9000010", "tk:SMPLX", null]),
  X000004: makeTrades("X000004", 12, ["co:9000004", "tk:FKCOIN"]),
  X000005: makeTrades("X000005", 88, ["co:9000002", "co:9000002", null]),
  X000006: makeTrades("X000006", 9, ["co:9000006"]),
  X000007: makeTrades("X000007", 4, ["co:9000009"]),
  X000008: [],
  X000009: makeTrades("X000009", 1, ["co:9000010"]),
  X000010: makeTrades("X000010", 23, ["co:9000004"]),
  X000011: [],
  X000012: makeTrades("X000012", 7, ["co:9000008"]),
};

// ---- cases ----------------------------------------------------------------------------
const CASE_EXCLUDED = new Set(["sits_with", "legislates_with"]);
const cases = [];
for (const m of MEMBERS) {
  const byOrg = {};
  for (const e of edges) {
    if (e.basis !== "filed" || CASE_EXCLUDED.has(e.type)) continue;
    const ends = [e.from, e.to];
    if (!ends.some((n) => n.kind === "member" && n.id === m.id)) continue;
    const org = ends.find((n) => n.kind === "org");
    if (!org) continue;
    (byOrg[org.id] ??= []).push(e);
  }
  for (const [org, es] of Object.entries(byOrg)) {
    const types = [...new Set(es.map((e) => e.type))];
    if (types.length < 3) continue;
    const lo = Math.max(...es.map((e) => +e.first.slice(0, 4)));
    const hi = Math.min(...es.map((e) => +e.last.slice(0, 4)));
    const money = es.reduce((s, e) => s + (e.amount.exact ?? e.amount.high ?? 0), 0);
    cases.push({
      id: sha1(`case|${m.id}|${org}`).slice(0, 12),
      member: m.id, org, types, edges: es.map((e) => e.id),
      years: [Math.min(lo, hi), Math.max(lo, hi)],
      score: types.length + Math.min(0.99, money / 1e7),
    });
  }
}
cases.sort((a, b) => b.score - a.score);

// ---- ledgers: money ties shipped without evidence arrays ----------------------
const MEMBER_LEDGER = { X000001: 34, X000002: 12, X000005: 22, X000007: 3, X000011: 8 };
const ledgerRows = []; // [member, type, org, via, exact, low, high, count, first, last, note]
for (const [mid, n] of Object.entries(MEMBER_LEDGER)) {
  for (let i = 0; i < n; i++) {
    const org = LEDGER_PACS[(i * 7 + mid.charCodeAt(6)) % LEDGER_PACS.length];
    const type = i % 11 === 5 ? "outside_spending" : "pac_money";
    const cnt = between(1, 9);
    const exact = Math.round((cnt * (250 + rand() * 2500)) / 50) * 50;
    const y0 = between(2004, 2022);
    const y1 = Math.min(2026, y0 + between(0, 4));
    ledgerRows.push([mid, type, org.id, null, exact, exact, exact, cnt, iso(y0, between(1, 12), between(1, 28)), iso(y1, between(1, 12), between(1, 28)), i === 3 ? "SAMPLE: one receipt amended after filing" : null]);
  }
}
function ledgerTotalsOf(rows, typeIdx, exactIdx, countIdx) {
  const t = {};
  for (const r of rows) {
    const k = r[typeIdx];
    const x = (t[k] ??= { edges: 0, records: 0, low: 0, high: 0, exact: 0 });
    x.edges++; x.records += r[countIdx]; x.low += r[exactIdx]; x.high += r[exactIdx]; x.exact += r[exactIdx];
  }
  return t;
}

// ---- assemble ----------------------------------------------------------------------
const touches = (e, id) => [e.from, e.to].some((n) => n.kind === "member" && n.id === id);
const touchesOrg = (e, id) => [e.from, e.to].some((n) => n.kind === "org" && n.id === id);

const degree = {};
for (const o of ORGS) {
  const ms = new Set();
  for (const e of edges) if (touchesOrg(e, o.id)) for (const n of [e.from, e.to]) if (n.kind === "member") ms.add(n.id);
  for (const r of ledgerRows) if (r[2] === o.id) ms.add(r[0]);
  degree[o.id] = ms.size;
}
const orgSummaries = ORGS.filter((o) => degree[o.id] > 0).map((o) => ({ ...o, degree: degree[o.id] }));
const orgSummaryById = Object.fromEntries(orgSummaries.map((o) => [o.id, o]));

const COMMITTEES = {
  X000001: [{ id: "cmte:SSXA", name: "Senate Committee on Sample Affairs", role: "Ranking Member", current: true }, { id: "cmte:SSXB", name: "Senate Committee on Example Budgets", role: null, current: true }],
  X000002: [{ id: "cmte:SSXA", name: "Senate Committee on Sample Affairs", role: null, current: true }],
  X000005: [{ id: "cmte:SSXA", name: "Senate Committee on Sample Affairs", role: "Chair", current: true }, { id: "cmte:SSXC", name: "Senate Committee on Placeholder Rules", role: null, current: false }],
  X000011: [{ id: "cmte:HSXE", name: "House Committee on Example Energy", role: null, current: true }],
};

function summary(m) {
  const my = edges.filter((e) => touches(e, m.id));
  const orgSet = new Set(); const memSet = new Set();
  for (const e of my) for (const n of [e.from, e.to]) {
    if (n.kind === "org") orgSet.add(n.id);
    else if (n.id !== m.id) memSet.add(n.id);
  }
  for (const r of ledgerRows) if (r[0] === m.id) orgSet.add(r[2]);
  return {
    id: m.id,
    name: `${m.first} ${m.last}`,
    first: m.first, last: m.last,
    party: m.party, state: m.state, chamber: m.chamber, district: m.district,
    current: !m.until,
    served: [m.since, m.until ?? null],
    photo: false,
    counts: { trades: TRADES[m.id].length, orgs: orgSet.size, members: memSet.size, cases: cases.filter((c) => c.member === m.id).length },
  };
}
const summaries = MEMBERS.map(summary);

function terms(m) {
  const out = [];
  const startY = +m.since.slice(0, 4);
  const endY = m.until ? +m.until.slice(0, 4) : 2027;
  const step = m.chamber === "sen" ? 6 : 2;
  for (let y = startY; y < endY; y += step) {
    out.push({ chamber: m.chamber, start: `${y}-01-03`, end: `${Math.min(y + step, endY)}-01-03`, state: m.state, district: m.district, party: m.party });
  }
  return out;
}

function coverage(m) {
  const startY = Math.max(2000, +m.since.slice(0, 4));
  const endY = m.until ? +m.until.slice(0, 4) : 2026;
  const out = [];
  for (let y = startY; y <= endY; y++) {
    out.push({
      year: y,
      trades: y < 2012 ? "n/a" : y === 2012 ? "partial" : y === 2026 ? "partial" : m.id === "X000008" ? "none" : "full",
      money: y < 2004 ? "partial" : y === 2026 ? "partial" : "full",
    });
  }
  return out;
}

const famOrder = { money: 0, holding: 1, people: 2, context: 3 };
const size = (e) => e.amount.exact ?? e.amount.high ?? e.amount.low ?? e.count;

function write(rel, data) {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 0) + "\n");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

write("members.json", summaries);
for (const m of MEMBERS) {
  const s = summaries.find((x) => x.id === m.id);
  const TCOLS = ["id", "version", "amended", "date", "available", "lag_days", "late", "owner", "action", "partial", "ticker", "ticker_source", "asset", "asset_class", "low", "high", "org", "doc"];
  const filings = {};
  for (const t of TRADES[m.id]) filings[t.doc] = `https://example.org/sample-record/ptr/${t.doc}.pdf`;
  // Member ledger cols: type, kind, other, via, exact, low, high, count, first, last, note
  const mine = ledgerRows.filter((r) => r[0] === m.id).map((r) => [r[1], "org", ...r.slice(2)]);
  write(`members/${m.id}.json`, {
    member: { ...s, terms: terms(m), committees: COMMITTEES[m.id] ?? [], fec_ids: [`H0SAMPLE${m.id.slice(-3)}`] },
    edges: edges.filter((e) => touches(e, m.id)),
    trades: { cols: TCOLS, rows: TRADES[m.id].map((t) => TCOLS.map((c) => t[c] ?? null)) },
    filings,
    ledger: { cols: ["type", "kind", "other", "via", "exact", "low", "high", "count", "first", "last", "note"], rows: mine },
    ledger_totals: ledgerTotalsOf(mine, 0, 4, 7),
    cases: cases.filter((c) => c.member === m.id),
    coverage: coverage(m),
  });
}
write("orgs.json", orgSummaries);
const shards = {};
for (const o of orgSummaries) {
  const shard = sha1(o.id).slice(0, 2);
  // Org files carry no full edges: one row per tie, pointing at the full Edge
  // in the member's file when there is one.
  // cols: type, member, exact, low, high, count, first, last, edge
  const full = edges.filter((e) => touchesOrg(e, o.id)).map((e) => {
    const mem = [e.from, e.to].find((n) => n.kind === "member").id;
    return [e.type, mem, e.amount.exact, e.amount.low, e.amount.high, e.count, e.first, e.last, e.id];
  });
  const fromLedger = ledgerRows.filter((r) => r[2] === o.id).map((r) => [r[1], r[0], r[4], r[5], r[6], r[7], r[8], r[9], null]);
  const ties = [...full, ...fromLedger].sort((a, b) => (b[2] ?? b[4] ?? 0) - (a[2] ?? a[4] ?? 0));
  (shards[shard] ??= {})[o.id] = {
    org: o,
    ties: { cols: ["type", "member", "exact", "low", "high", "count", "first", "last", "edge"], rows: ties },
    ledger_totals: ledgerTotalsOf(ties, 0, 2, 5),
  };
}
for (const [shard, body] of Object.entries(shards)) write(`orgs/${shard}.json`, body);

const states = {};
for (const s of summaries.filter((x) => x.current)) (states[s.state] ??= []).push(s);
const boardStates = {};
for (const [st, list] of Object.entries(states)) {
  list.sort((a, b) => (a.chamber === b.chamber ? a.last.localeCompare(b.last) : a.chamber === "sen" ? -1 : 1));
  boardStates[st] = list.map((x) => x.id);
}
const strings = {};
const nodes = {};
for (const s of summaries.filter((x) => x.current)) {
  const my = edges.filter((e) => touches(e, s.id)).sort((a, b) => famOrder[a.family] - famOrder[b.family] || size(b) - size(a)).slice(0, 12);
  strings[s.id] = my;
  for (const e of my) for (const n of [e.from, e.to]) if (n.kind === "org") nodes[n.id] = orgSummaryById[n.id];
}
write("board.json", { states: boardStates, strings, nodes });
write("member-ties.json", edges.filter((e) => e.from.kind === "member" && e.to.kind === "member" && e.family !== "context"));
write("cases.json", cases);

const counts = {
  members: summaries.length,
  members_current: summaries.filter((s) => s.current).length,
  orgs: orgSummaries.length,
  edges: edges.length,
  trades: Object.values(TRADES).reduce((s, t) => s + t.length, 0),
  cases: cases.length,
};
write("meta.json", {
  built: "2026-11-13T00:00:00Z",
  sample: true,
  sources: [
    { id: "ptr", name: "SAMPLE House and Senate periodic transaction reports", url: "https://example.org/sample-source/ptr", revision: "sample-r1", retrieved: "2026-11-01", rows: counts.trades, unmatched: 9 },
    { id: "fd_annual", name: "SAMPLE annual financial disclosures", url: "https://example.org/sample-source/fd", revision: "sample-r1", retrieved: "2026-11-01", rows: 214, unmatched: 4 },
    { id: "fec_pas2", name: "SAMPLE FEC committee-to-candidate contributions", url: "https://example.org/sample-source/fec", revision: "sample-2026-10-30", retrieved: "2026-11-02", rows: 1820, unmatched: 37 },
    { id: "fec_indiv", name: "SAMPLE FEC individual contributions", url: "https://example.org/sample-source/fec-indiv", revision: "sample-2026-10-30", retrieved: "2026-11-02", rows: 40211, unmatched: 1120 },
    { id: "fec_ie", name: "SAMPLE FEC independent expenditures", url: "https://example.org/sample-source/fec-ie", revision: "sample-2026-10-30", retrieved: "2026-11-02", rows: 311, unmatched: 12 },
    { id: "fec_jfc", name: "SAMPLE FEC joint fundraising committees", url: "https://example.org/sample-source/fec-jfc", revision: "sample-2026-10-30", retrieved: "2026-11-02", rows: 58, unmatched: 0 },
    { id: "lda_ld203", name: "SAMPLE LD-203 lobbyist contribution reports", url: "https://example.org/sample-source/lda", revision: "sample-r3", retrieved: "2026-11-03", rows: 922, unmatched: 61 },
    { id: "lda_ld1", name: "SAMPLE LD-1 lobbying registrations", url: "https://example.org/sample-source/lda1", revision: "sample-r3", retrieved: "2026-11-03", rows: 140, unmatched: 8 },
    { id: "house_travel", name: "SAMPLE privately funded travel disclosures", url: "https://example.org/sample-source/travel", revision: "sample-r1", retrieved: "2026-11-03", rows: 33, unmatched: 2 },
    { id: "house_disbursements", name: "SAMPLE statements of disbursements", url: "https://example.org/sample-source/disb", revision: "sample-r1", retrieved: "2026-11-03", rows: 640, unmatched: 0 },
    { id: "committees", name: "SAMPLE committee rosters", url: "https://example.org/sample-source/committees", revision: "sample-r1", retrieved: "2026-11-01", rows: 96, unmatched: 0 },
    { id: "congress_bills", name: "SAMPLE bill co-sponsorship records", url: "https://example.org/sample-source/bills", revision: "sample-r1", retrieved: "2026-11-01", rows: 410, unmatched: 0 },
  ],
  counts,
  unmatched: { orgs_unmatched_names: 23, tickers_without_sec_match: 2, ptr_rows_without_member: 0 },
  exclusions: [
    { reason: "SAMPLE: filer is not a member of Congress (candidate or staff report)", count: 14 },
    { reason: "SAMPLE: scanned report could not be extracted", count: 3 },
  ],
  coverage: [
    "SAMPLE: periodic transaction reports exist from July 2012; nothing earlier was filed.",
    "SAMPLE: 2026 money data is partial until the year's final reports are filed.",
  ],
});

console.log(`fixtures: ${counts.members} members, ${counts.orgs} orgs, ${counts.edges} edges, ${counts.trades} trades, ${counts.cases} cases -> ${OUT}`);
const missing = Object.keys(FAMILY).filter((t) => !edges.some((e) => e.type === t));
if (missing.length) { console.error("missing edge types:", missing); process.exit(1); }
