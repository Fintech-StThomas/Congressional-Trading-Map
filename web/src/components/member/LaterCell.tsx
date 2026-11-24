// The "Later filings" cell of the trades table: what a later filing says about the trade (deleted, date corrected),
// then a link to each later filing (its official address from the trade file's `filings`). Wording in lib/copy-amend.ts.
import type { TradeRow } from "@/lib/data/decode";
import { AMEND } from "@/lib/copy-amend";
import { amendmentView, type AmendmentMap } from "@/lib/domain/amendments";
import { ExternalIcon } from "@/components/shared/ExternalIcon";

/** The later-filings map and the filing addresses that go with it (from the trade file; empty for builds without `amendments`). */
export type Later = { map: AmendmentMap; filings: Record<string, string> };

export function LaterCell({ t, later }: { t: TradeRow; later: Later }) {
  const v = amendmentView(t, later.map, later.filings);
  const shown = v.later.slice(0, 2);
  const text: string[] = [];
  if (v.deleted) text.push(AMEND.deleted);
  if (v.dateCorrected) text.push(AMEND.dateCorrected);
  const all = [...text, ...v.later.map((l) => AMEND.laterFiling(l.status, l.available))];
  if (!all.length) return null;
  return (
    <span className="trades__laterbox" title={AMEND.lineTitle(all)}>
      {text.length > 0 && <span className="trades__latertext">{text.join("; ")}</span>}
      {(shown.length > 0 || v.later.length > shown.length) && (
        <span className="trades__laterlinks">
          {shown.map((l, i) => (
            <span key={l.doc}>
              {i > 0 && " · "}
              {l.url ? (
                <a href={l.url} target="_blank" rel="noopener noreferrer">{AMEND.laterFiling(l.status, l.available)} <ExternalIcon /></a>
              ) : (
                AMEND.laterFiling(l.status, l.available)
              )}
            </span>
          ))}
          {v.later.length > shown.length && ` · ${AMEND.more(v.later.length - shown.length)}`}
        </span>
      )}
    </span>
  );
}
