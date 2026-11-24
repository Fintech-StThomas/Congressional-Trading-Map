// All-in money totals on the member page: per kind, full ties plus further ties, with record counts; outside spending
// split for / against and money between members received / paid; "at least" where a cut ledger leaves rows unsplit.
import { money, plural } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/domain/edges";
import { partAmountText, type KindTotal, type Part } from "@/lib/domain/money-totals";
import { MONEY_TOTALS } from "@/lib/copy-member-totals";

const line = (p: Part, unit = "tie", atLeast = false) => `${plural(p.ties, unit)} · ${plural(p.records, "record")} · ${atLeast && p.size !== null ? `${MONEY_TOTALS.atLeast} ` : ""}${partAmountText(p, (n) => money(n), MONEY_TOTALS.noAmount)}`;
/** Funds ties run between members, in both directions; the shared type label ("Gave money") would contradict "received". */
const label = (t: KindTotal["type"]) => (t === "funds" ? "Money between members" : TYPE_LABEL[t]);

export function MoneyTotals({ kinds, seats }: { kinds: KindTotal[]; seats: number }) {
  if (!kinds.length && !seats) return null;
  return (
    <div data-testid="money-totals">
      <h3 className="hold__h">{MONEY_TOTALS.heading}</h3>
      <p className="hold__small">{MONEY_TOTALS.note}</p>
      <ul className="ledger__totals">
        {kinds.flatMap((k) => k.sides.map((s) => {
          const cut = k.incomplete && s.side !== "unstated";
          const rows = s.side === "against"; // opposing spending is not a tie: rows and spenders, never ties
          const unit = rows ? MONEY_TOTALS.against : "tie";
          return (
          <li key={`${k.type}-${s.side}`} data-testid={`money-total-${k.type}-${s.side}`}>
            <span>{label(k.type)}{MONEY_TOTALS.sides[s.side]}{cut ? ` · ${rows ? MONEY_TOTALS.incompleteRows : MONEY_TOTALS.incomplete}` : ""}</span>
            <span className="mono">{line(s.all, unit, cut)}</span>
            {s.ledger.ties > 0 && s.full.ties > 0 && (
              <span className="mono sub">Of these, {rows ? MONEY_TOTALS.smallerRows : MONEY_TOTALS.smallerOnly}: {line(s.ledger, unit)}</span>
            )}
          </li>
          );
        }))}
        {kinds.filter((k) => k.unsplit).map((k) => (
          <li key={`${k.type}-unsplit`}>
            <span>{label(k.type)} · {MONEY_TOTALS.unsplit}</span>
            <span className="mono">{line(k.unsplit as Part, k.type === "outside_spending" ? "row" : "tie")}</span>
          </li>
        ))}
        {seats > 0 && <li><span>{MONEY_TOTALS.seats}</span><span className="mono">{plural(seats, "colleague")}</span></li>}
      </ul>
      {kinds.filter((k) => k.incomplete).flatMap((k) => (k.type === "outside_spending" ? ["for", "against"] as const : k.type === "funds" ? ["in", "out"] as const : [])
        .filter((side) => !k.sides.some((x) => x.side === side))
        .map((side) => <p key={`${k.type}-${side}`} className="hold__small">{MONEY_TOTALS.missingSide(`${label(k.type).toLowerCase()} ${MONEY_TOTALS.sides[side].replace(/^\s*·\s*/, "")}`)}</p>))}
    </div>
  );
}
