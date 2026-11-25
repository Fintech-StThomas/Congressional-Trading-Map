// Wording for amended trades and the timing of amended reports: the trades table, the full file, /delays and /method.
// Observed facts only; no finding about any filing. Import from here, not copy.ts (which may only shrink).
import type { LaterFiling } from "./domain/amendments.ts";
import { date } from "./format.ts";

export const AMEND = {
  /** The small label under an amended trade. */
  amended: "amended",
  /** Printed case file note beside the trade list, for builds that fold amended reprints. */
  printNote: "each trade once, timed from its first filing; amended trades are marked",
  /** Link text for a later filing. */
  laterFiling: (status: LaterFiling["status"], available: string | null, doc?: string) =>
    status === "Deleted" ? `deleted in filing ${doc ?? ""}`.trim()
      : status === "Reprinted" ? `reported again in filing ${doc ?? ""}`.trim()
      : `${status === "Version" ? "later version" : "later filing"}${available ? ` ${date(available)}` : ""}`,
  /** Plain words for a later filing's status, for the full-file CSV (never the raw status string). */
  statusWord: { Amended: "Amended", Deleted: "Deleted", Reprinted: "Reported again", Version: "Later version" } as Record<LaterFiling["status"], string>,
  /** Column heading in the trades table. */
  column: "Later filings",
  more: (n: number) => `+${n} more`,
  deleted: "a later filing marks this transaction deleted",
  deletedNote: "The trade stays listed and marked; it is not in any count or total.",
  /** A counted trade whose later filings include a Deleted printing (the trade is still reported in another printing). */
  deletedOnePrinting: "a later filing deleted one printing; the trade is still reported in another",
  /** A trade a later filing marks Deleted: listed and marked, counted nowhere (owner decision 2026-11-25). */
  notCounted: "A later filing marks this transaction deleted; listed, not counted",
  notCountedShort: "not counted",
  /** An amended House row whose original was not identified: days to public are not given. */
  unmatched: "amended; the original report was not identified, so days to public are not given",
  unmatchedShort: "amended",
  dateCorrected: "date corrected by a later filing",
  dateCorrectedShort: "corrected",
  dateCorrectedTitle: "A later filing corrected the transaction date, so elapsed days are not computed.",
  /** Title attribute for the whole line under the asset. */
  lineTitle: (parts: string[]) => parts.join(" · "),
  caveatNotCounted: (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "row is" : "rows are"} listed but not counted: a later filing marks ${n === 1 ? "it" : "them"} deleted. ${n === 1 ? "It is" : "They are"} in no count, total or timing figure.`,
  caveatUnmatched: (n: number) => `${n.toLocaleString("en-US")} amended ${n === 1 ? "trade has" : "trades have"} no identified original report, so ${n === 1 ? "its" : "their"} days to public are not given.`,
  csvLabel: "Later filings",
  /** Plain words for the reason keys of not_counted / lag_withheld (table and CSV never show the raw key). */
  reasonWord: { deleted_by_later_filing: "Deleted by a later filing", amended_unmatched: "Amended, original not identified", date_corrected: "Date corrected by a later filing" } as Record<string, string>,
  csvNotCounted: "Not counted (reason)",
  csvLagWithheld: "Days to public withheld (reason)",
  csvLinks: "Later filing links",
} as const;

export const DELAYS_AMEND = {
  /** The /delays row for trades whose date a later filing corrected. */
  label: "Date corrected by a later filing",
  note: "A later filing corrected the transaction date, so elapsed days are not computed. In no band and no statistic.",
  /** The /delays row for amended House rows whose original report was not identified. */
  unmatchedLabel: "Amended, original not matched",
  unmatchedNote: "The original report was not identified, so the first public date is unknown and days to public are not given. In no band and no statistic.",
  /** Column headings in the tables. */
  column: "Date corrected",
  unmatchedColumn: "Amended, original not matched",
  /** The /delays "how it is measured" line about amended trades. */
  bandsNote:
    "Bands are not additive with “amended”: an amended trade is also counted in the row it belongs to. Percentages are of all trades. A reprint of a trade in a later filing marked Amended is counted once, from its first filing.",
  amendedNote: "Overlaps the rows above.",
  /** For data built before amended reprints were folded (no date_corrected in the file): what the build did. */
  bandsNoteOld: "Bands are not additive with “amended”: an amended trade is also counted in the band it falls in. Percentages are of all trades.",
  auditSummaryOld:
    "Dates: the transaction date is as filed (empty on some rows; on some scanned filings the day of the month is approximate). The public date is the source dataset’s availability instant, read as a US Eastern calendar date. For an amended report this build shows the current version only, and it is not known whether that version’s availability date is the original filing’s or the amendment’s. A reprint the House marks Amended may appear as a separate trade in this build.",
  /** The audit summary under the definition. */
  auditSummary:
    "Dates: the transaction date is as filed (empty on some rows; on some scanned filings the day of the month is approximate). The public date is the source dataset’s availability instant, read as a US Eastern calendar date. A trade is timed from the first filing in which the public could see it; a later filing that corrected its transaction date puts it under “date corrected”, with no elapsed days.",
  /** Shown beside the member timing line when some trades have a corrected date. */
  memberUnmatched: (n: number) => `${n.toLocaleString("en-US")} amended with the original report not identified (days not given)`,
  memberCorrected: (n: number) => `${n.toLocaleString("en-US")} with a date corrected by a later filing`,
} as const;

/** /method: how amended reports are handled (what the pipeline does; see the data dictionary, "Rules the pipeline must keep"). */
export const METHOD_AMEND = {
  /** For data built before reprints were folded: what that build did (no claim of folding). */
  limitOld:
    "A report can be amended or filed on paper. This build shows the current version of each trade and flags it amended where the dataset records more than one version; a reprint the House marks Amended may still appear as a separate trade, and its timing is then counted from the later filing.",
  limit:
    "A report can be amended or filed on paper. A reprint the House marks Amended and that repeats an earlier trade exactly is counted once, timed from its first filing, with the later filing listed beside it. An amended row that changes the date, owner, action, amount or asset stays a separate trade, timed from the amending filing. A row a later filing marks Deleted stays published, flagged amended; whether to remove those is an open decision.",
  /** For builds that withhold days for unmatched amended rows and do not count Deleted rows (2026-11-25). */
  limitNew:
    "A report can be amended or filed on paper. A reprint the House marks Amended and that repeats an earlier trade exactly is counted once, timed from its first filing, with the later filing listed beside it. An amended row that changes the date, owner, action, amount or asset stays a separate trade; as its original is not identified, its days to public are withheld and counted apart. A row a later filing marks Deleted stays listed and marked but is not counted anywhere.",
  keptHeading: "Kept in the data (not excluded)",
  keptNote: "These rows are in the data and listed on member pages. All are counted except rows a later filing marks deleted, which are listed and marked but counted nowhere; they appear here so the numbers are visible.",
  excludedHeading: "Excluded",
  /** Tie kinds the rules describe but that have no ties in this data build (driven by meta counts.edges_by_type). */
  notInBuild: "not in this build",
  notInBuildTitle: "This kind of tie is defined but no tie of this kind is in the current data build.",
  /** exclusions keys that count rows that are kept, not removed. */
  keptKeys: ["amended_rows_without_original", "same_key_other_filing", "lag_withheld_date_corrected", "lag_withheld_amended_unmatched", "deleted_by_later_filing"],
} as const;
