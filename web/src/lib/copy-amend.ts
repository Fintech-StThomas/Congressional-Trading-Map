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
  laterFiling: (status: LaterFiling["status"], available: string | null) =>
    `${status === "Version" ? "later version" : "later filing"}${available ? ` ${date(available)}` : ""}`,
  /** Column heading in the trades table. */
  column: "Later filings",
  more: (n: number) => `+${n} more`,
  deleted: "a later filing marks this transaction deleted",
  deletedNote: "The trade stays in the data and in the totals; the filing's mark is only reported.",
  dateCorrected: "date corrected by a later filing",
  dateCorrectedShort: "corrected",
  dateCorrectedTitle: "A later filing corrected the transaction date, so elapsed days are not computed.",
  /** Title attribute for the whole line under the asset. */
  lineTitle: (parts: string[]) => parts.join(" · "),
  csvLabel: "Later filings",
  csvLinks: "Later filing links",
} as const;

export const DELAYS_AMEND = {
  /** The /delays row for trades whose date a later filing corrected. */
  label: "Date corrected by a later filing",
  note: "A later filing corrected the transaction date, so elapsed days are not computed. In no band and no statistic.",
  /** Column heading in the tables. */
  column: "Date corrected",
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
  memberCorrected: (n: number) => `${n.toLocaleString("en-US")} with a date corrected by a later filing`,
} as const;

/** /method: how amended reports are handled (what the pipeline does; see the data dictionary, "Rules the pipeline must keep"). */
export const METHOD_AMEND = {
  /** For data built before reprints were folded: what that build did (no claim of folding). */
  limitOld:
    "A report can be amended or filed on paper. This build shows the current version of each trade and flags it amended where the dataset records more than one version; a reprint the House marks Amended may still appear as a separate trade, and its timing is then counted from the later filing.",
  limit:
    "A report can be amended or filed on paper. A reprint the House marks Amended and that repeats an earlier trade exactly is counted once, timed from its first filing, with the later filing listed beside it. An amended row that changes the date, owner, action, amount or asset stays a separate trade, timed from the amending filing. A row a later filing marks Deleted stays published, flagged amended; whether to remove those is an open decision.",
  keptHeading: "Kept and counted (not excluded)",
  keptNote: "These rows are in the data and in every total; they are listed here only so the counts are visible.",
  excludedHeading: "Excluded",
  /** Tie kinds the rules describe but that have no ties in this data build (driven by meta counts.edges_by_type). */
  notInBuild: "not in this build",
  notInBuildTitle: "This kind of tie is defined but no tie of this kind is in the current data build.",
  /** exclusions keys that count rows that are kept, not removed. */
  keptKeys: ["amended_rows_without_original", "same_key_other_filing", "lag_withheld_date_corrected"],
} as const;
