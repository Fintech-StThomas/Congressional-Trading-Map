// Invented amended trades for the sample site, so the trades table, /delays and /method have rows to show for P2:
// one trade that a later House filing reprinted ("Amended"), one that a later filing marks Deleted (the trade stays
// published), one whose transaction date a later version corrected (lag withheld, both dates present), plus the
// `amendments` map, the filings those need, the meta counts and the exclusions with kept rows. Deterministic: no random
// draws, so adding it does not move any other fixture value. Called from make-fixtures.mjs.

const DAY = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);

/** Marks three of X000001's older trades; returns { amendments: { [memberId]: map }, filings, counts, exclusions }. */
export function applyAmendments(TRADES) {
  const pool = TRADES.X000001.filter((t) => t.date && t.available && t.lag_days != null && t.date < "2024-01-01" && !t.amended);
  const [reprint, deleted, corrected, unmatched] = [pool[3], pool[4], pool[5], pool[6]];
  const map = {};
  const filings = {};
  const later = (t, doc, status, after) => {
    filings[doc] = `https://example.org/sample-record/ptr/${doc}.pdf`;
    (map[t.id] ??= []).push({ id: status === "Version" ? t.id : `${t.id}-R`, doc, status, available: addDays(t.available, after) });
  };
  reprint.amended = true;
  later(reprint, "SAMPAMD01", "Amended", 90);
  // The "Deleted" row is an extra, invented row: listed in the trade file and marked not counted, but in no TRADES figure.
  later(deleted, "SAMPAMD02", "Deleted", 120);
  deleted.amended = false; // restore: the marked row below is a separate, listed-only trade
  const gone = { ...deleted, id: `${deleted.id}-DEL`, amended: true, doc: "SAMPAMD02", date: addDays(deleted.date, 3), available: addDays(deleted.date, 20), lag_days: 17, late: false, org: null, asset: "Example Dynamics Inc common stock (sample, deleted by a later filing)" };
  delete map[deleted.id];
  (map[gone.id] ??= []).push({ id: `house:SAMPAMD02:7`, doc: "SAMPAMD02", status: "Deleted", available: addDays(gone.available, 100) });
  unmatched.amended = true;
  unmatched.lag_days = null;
  unmatched.late = null;
  unmatched.lagWithheld = "amended_unmatched"; // read by fixture-delays.mjs (not a published column)
  corrected.lagWithheld = "date_corrected";
  corrected.amended = true;
  corrected.version = 2;
  corrected.lag_days = null;
  corrected.late = null;
  later(corrected, "SAMPAMD03", "Version", 60);
  // X000011 has no counted trade and one listed-only row (deleted by a later filing): its pages must still list it.
  const only = { ...gone, id: "SAMPLE-EVT-X11DEL", doc: "SAMPAMD04", date: "2023-02-14", available: "2023-03-01", lag_days: 15, org: null, ticker: null };
  const onlyMap = { [only.id]: [{ id: "house:SAMPAMD04:2", doc: "SAMPAMD04", status: "Deleted", available: "2023-06-01" }] };
  const lagWithheld = { [corrected.id]: "date_corrected", [unmatched.id]: "amended_unmatched" };
  const byDate = (a, b) => (b.date ?? b.available ?? "").localeCompare(a.date ?? a.available ?? "");
  return {
    /** The trade file's rows for a member: the counted trades plus the listed-only (not counted) ones, newest first. */
    rowsFor: (id, tr) => (id === "X000001" ? [...tr, gone].sort(byDate) : id === "X000011" ? [only] : tr),
    /** The marks a trade file carries (all three maps, {} when none). */
    marksFor: (id) => ({ amendments: id === "X000001" ? map : id === "X000011" ? onlyMap : {}, lag_withheld: id === "X000001" ? lagWithheld : {}, not_counted: id === "X000001" ? { [gone.id]: "deleted_by_later_filing" } : id === "X000011" ? { [only.id]: "deleted_by_later_filing" } : {} }),
    amendments: { X000001: map },
    filings: { X000001: filings, X000011: { SAMPAMD04: "https://example.org/sample-record/ptr/SAMPAMD04.pdf" } },
    counts: { trades_amended_reprints_folded: 1, trades_same_key_other_filing: 0, trades_lag_withheld_date_corrected: 1, trades_lag_withheld_amended_unmatched: 1, trades_deleted_by_later_filing: 2 },
    exclusions: {
      sample_non_member_filer: { reason: "SAMPLE: filer is not a member of Congress (candidate or staff report)", rows: 14 },
      sample_scan_not_extracted: { reason: "SAMPLE: scanned report could not be extracted", rows: 3 },
      amended_rows_without_original: { reason: "SAMPLE: House rows marked Amended or Deleted with no exactly matching earlier trade; kept as their own trade (rows = kept, not excluded)", rows: 1 },
      lag_withheld_amended_unmatched: { reason: "SAMPLE: amended House rows whose original report was not identified; days to public withheld; kept and counted apart (rows = kept, not excluded)", rows: 1 },
      deleted_by_later_filing: { reason: "SAMPLE: rows a later filing marks Deleted; kept and listed, not counted (rows = kept, not counted)", rows: 2 },
      lag_withheld_date_corrected: { reason: "SAMPLE: trades whose transaction date a later version corrected; lag_days and late are null; kept and counted apart (rows = kept, not excluded)", rows: 1 },
    },
  };
}
