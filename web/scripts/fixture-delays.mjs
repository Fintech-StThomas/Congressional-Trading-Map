// Builds fixtures/data/delays.json from the invented fixture trades, with the same rules as the pipeline
// (pipeline/assemble/delays.py): bands, negative and undated counted apart and never banded, nearest-rank
// percentiles over dated non-negative lags. Written independently of src/lib/domain/delays.ts so the unit
// test (tests/delays.test.mjs) can check the two against each other. Observed elapsed days, not a finding.

const EDGES = [30, 45, 90, 365];
const MEMBER_COLS = ["id", "count", "dated", "b0_30", "b31_45", "b46_90", "b91_365", "b366_plus", "negative", "undated", "amended", "median", "p90", "max", "first_year", "last_year", "date_corrected"];

const DEFINITION = {
  measured: "days from the transaction date as filed to the date the report became publicly available",
  threshold_days: 45,
  bands: ["0-30", "31-45", "46-90", "91-365", "over-365"],
  percentile: "nearest-rank over dated, non-negative trades: sorted ascending, the value at position ceil(p/100*n); median is p=50; integers; null when there are none",
  caveats: [
    "These are observed elapsed days, not a finding about whether any filing was on time or lawful.",
    "The statutory clock runs from the filer's notification of the transaction, up to 45 days after the transaction; notification dates are not in the data, and only the 45-day outer bound can be compared.",
    "Extensions and fee waivers granted by the ethics committees are not in the data.",
    "Each trade is counted once, from the earliest date it was public: the earliest version of its event, and the earliest filing when a later House filing marked Amended or Deleted prints it again unchanged.",
    "When a later version changed the transaction date, the first public filing showed a different date; no elapsed-days figure is given for that trade. It is counted as date corrected, in no band and no statistic.",
    "A House row marked Amended that changes the date, owner, action, amount or asset cannot be tied to its original exactly; it stays a trade of its own, counted from the amending filing. amended counts every amended trade separately and is also inside the bands.",
    "Trades with no transaction date or no availability date are counted as undated, never as 0 days.",
    "A negative value means the recorded availability date precedes the transaction date on a trade with a single version; the filing is unexplained by these fields and is counted separately.",
  ],
};

function nearestRank(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.max(Math.ceil((p * sorted.length) / 100) - 1, 0)];
}

function acc() {
  return { count: 0, bands: [0, 0, 0, 0, 0], negative: 0, undated: 0, amended: 0, dateCorrected: 0, lags: [], years: [] };
}
function add(a, t) {
  a.count++;
  if (t.amended) a.amended++;
  if (t.date) a.years.push(Number(t.date.slice(0, 4)));
  if (t.lag_days == null && t.date && t.available) a.dateCorrected++;
  else if (t.lag_days == null) a.undated++;
  else if (t.lag_days < 0) a.negative++;
  else {
    let i = EDGES.findIndex((e) => t.lag_days <= e);
    if (i < 0) i = EDGES.length;
    a.bands[i]++;
    a.lags.push(t.lag_days);
  }
}
function stats(a) {
  const s = [...a.lags].sort((x, y) => x - y);
  return [nearestRank(s, 50), nearestRank(s, 90), s.length ? s[s.length - 1] : null];
}
function group(a) {
  const [median, p90, max] = stats(a);
  return {
    count: a.count, dated: a.count - a.undated - a.dateCorrected,
    bands: { "0-30": a.bands[0], "31-45": a.bands[1], "46-90": a.bands[2], "91-365": a.bands[3], "over-365": a.bands[4] },
    negative: a.negative, undated: a.undated, date_corrected: a.dateCorrected, amended: a.amended, median, p90, max,
  };
}
function row(id, a) {
  const [median, p90, max] = stats(a);
  return [id, a.count, a.count - a.undated - a.dateCorrected, ...a.bands, a.negative, a.undated, a.amended, median, p90, max,
    a.years.length ? Math.min(...a.years) : null, a.years.length ? Math.max(...a.years) : null, a.dateCorrected];
}

/** trades: { [memberId]: trade[] }; chamberOf(memberId) -> "rep" | "sen" (the fixtures carry no per-filing chamber). */
export function buildFixtureDelays(trades, chamberOf) {
  const total = acc();
  const chambers = { rep: acc(), sen: acc() };
  const years = {};
  const members = [];
  for (const id of Object.keys(trades).sort()) {
    if (!trades[id].length) continue;
    const m = acc();
    for (const t of trades[id]) {
      const y = t.date ? t.date.slice(0, 4) : "none";
      for (const a of [total, m, chambers[chamberOf(id)], (years[y] ??= acc())]) add(a, t);
    }
    members.push(row(id, m));
  }
  const keys = Object.keys(years).sort();
  return {
    definition: DEFINITION,
    totals: group(total),
    by_chamber: { rep: group(chambers.rep), sen: group(chambers.sen) },
    by_year: Object.fromEntries(keys.map((k) => [k, group(years[k])])),
    members: { cols: MEMBER_COLS, rows: members },
  };
}
