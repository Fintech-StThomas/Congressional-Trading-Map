// Types of delays.json (disclosure timing), split out of types.ts to keep it under the line cap. Data dictionary:
// "Disclosure timing (`delays.json`)".
// ---------------------------------------------------------------------------
// Disclosure timing (delays.json). Data dictionary: "Disclosure timing (`delays.json`)".
// Observed elapsed days between the transaction date as filed and the date the report became
// public. Not a finding about whether any filing was on time or lawful.
// ---------------------------------------------------------------------------

export type DelayBands = { "0-30": number; "31-45": number; "46-90": number; "91-365": number; "over-365": number };

export type DelayGroup = {
  count: number;              // trades in the group
  dated: number;              // count - undated - date_corrected (includes negative lags)
  bands: DelayBands;          // trades by lag_days; the band keys are fixed text; 31-45 ends at the threshold (45)
  negative: number;           // lag_days < 0: in no band, no statistic
  undated: number;            // lag_days is null because a date is missing: never counted as 0 days
  amended_unmatched?: number; // lag withheld because the trade is a House row marked Amended whose original was not identified (first public date unknown); absent in older files
  date_corrected?: number;    // lag_days is null though both dates are present (a later version changed the transaction date); absent in files built before this field existed (then inside `undated`)
  amended: number;            // current version of an event with more than one version; also inside the buckets above
  median: number | null;      // nearest-rank percentiles over dated, non-negative trades; all null when that set is empty
  p90: number | null;
  max: number | null;
};

export type DelayMemberCol =
  | "id" | "count" | "dated" | "b0_30" | "b31_45" | "b46_90" | "b91_365" | "b366_plus" | "negative"
  | "undated" | "amended" | "median" | "p90" | "max" | "first_year" | "last_year" | "date_corrected" | "amended_unmatched";

export type Delays = {
  definition: {
    measured: string;
    threshold_days: number;
    bands: string[];
    percentile: string;
    caveats: string[];
  };
  totals: DelayGroup;
  by_chamber: { rep: DelayGroup; sen: DelayGroup };
  by_year: { [year: string]: DelayGroup };   // calendar year of the transaction date; "none" when missing
  members: { cols: DelayMemberCol[]; rows: unknown[][] };
};
