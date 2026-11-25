// The "Later filings" cell of the trades table: what a later filing says about the trade (deleted, date corrected),
// then a link to each later filing (its official address from the trade file's `filings`). Wording in lib/copy-amend.ts.
import type { TradeRow } from "@/lib/data/decode";
import { AMEND } from "@/lib/copy-amend";
import { amendmentView, type AmendmentMap } from "@/lib/domain/amendments";
import { ExternalIcon } from "@/components/shared/ExternalIcon";

/** The later-filings map and the filing addresses that go with it (from the trade file; empty for builds without `amendments`). */
export type Later = { map: AmendmentMap; filings: Record<string, string>; marked: boolean };

export function LaterCell({ t, later }: { t: TradeRow; later: Later }) {
  const v = amendmentView(t, later.map, later.filings);
  const shown = v.later.slice(0, 2);
  const text: string[] = [];
  // A deleted row is "not counted" in builds that say so (notCounted); older builds only report the filing's mark.
  if (t.notCounted) text.push(AMEND.notCounted);
  // Deleted is decided only by not_counted. In a build that has it, a Deleted printing on a counted trade is just a later filing.
  else if (v.deleted) text.push(later.marked ? AMEND.deletedOnePrinting : AMEND.deleted);
  if (t.lagWithheld === "amended_unmatched") text.push(AMEND.unmatched);
  else if (v.dateCorrected) text.push(AMEND.dateCorrected);
  const all = [...text, ...v.later.map((l) => AMEND.laterFiling(l.status, l.available, l.doc))];
  if (!all.length) return null;
  return (
    <span className="trades__laterbox" title={AMEND.lineTitle(all)}>
      {text.length > 0 && <span className="trades__latertext">{text.join("; ")}</span>}
      {(shown.length > 0 || v.later.length > shown.length) && (
        <span className="trades__laterlinks">
          {shown.map((l, i) => (
            <span key={`${l.doc}|${l.status}`}>
              {i > 0 && " · "}
              {l.url ? (
                <a href={l.url} target="_blank" rel="noopener noreferrer">{AMEND.laterFiling(l.status, l.available, l.doc)} <ExternalIcon /></a>
              ) : (
                AMEND.laterFiling(l.status, l.available, l.doc)
              )}
            </span>
          ))}
          {v.later.length > shown.length && ` · ${AMEND.more(v.later.length - shown.length)}`}
        </span>
      )}
    </span>
  );
}
