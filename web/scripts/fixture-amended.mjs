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
  const [reprint, deleted, corrected] = [pool[3], pool[4], pool[5]];
  const map = {};
  const filings = {};
  const later = (t, doc, status, after) => {
    filings[doc] = `https://example.org/sample-record/ptr/${doc}.pdf`;
    (map[t.id] ??= []).push({ id: status === "Version" ? t.id : `${t.id}-R`, doc, status, available: addDays(t.available, after) });
  };
  reprint.amended = true;
  later(reprint, "SAMPAMD01", "Amended", 90);
  deleted.amended = true;
  later(deleted, "SAMPAMD02", "Deleted", 120);
  corrected.amended = true;
  corrected.version = 2;
  corrected.lag_days = null;
  corrected.late = null;
  later(corrected, "SAMPAMD03", "Version", 60);
  return {
    amendments: { X000001: map },
    filings: { X000001: filings },
    counts: { trades_amended_reprints_folded: 1, trades_same_key_other_filing: 0, trades_lag_withheld_date_corrected: 1 },
    exclusions: {
      sample_non_member_filer: { reason: "SAMPLE: filer is not a member of Congress (candidate or staff report)", rows: 14 },
      sample_scan_not_extracted: { reason: "SAMPLE: scanned report could not be extracted", rows: 3 },
      amended_rows_without_original: { reason: "SAMPLE: House rows marked Amended or Deleted with no exactly matching earlier trade; kept as their own trade (rows = kept, not excluded)", rows: 1 },
      lag_withheld_date_corrected: { reason: "SAMPLE: trades whose transaction date a later version corrected; lag_days and late are null; kept and counted apart (rows = kept, not excluded)", rows: 1 },
    },
  };
}
