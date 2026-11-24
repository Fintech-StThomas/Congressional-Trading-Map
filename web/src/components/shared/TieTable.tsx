"use client";
// The ties table (board table view, member page): one row per full Edge with amount, records, years and an Evidence button.
import Link from "next/link";
import type { Edge } from "@/lib/types";
import { weakTag, FAMILY_LABEL, typeLabel, amountLabel, filteredAmount, otherEnd, stringStyle, directionWord, edgeDir, type Family } from "@/lib/domain/edges";
import { count, NOT_DISCLOSED, seat, yearSpan } from "@/lib/format";
import { memberHref, orgHref } from "@/lib/urls";
import { nodeName, ORG_KIND_LABEL, type NameBook } from "@/lib/domain/names";
import { LineSample } from "./LineSample";
import { useAssumptionContext } from "./Assume";
import { isAgainst } from "@/lib/domain/pick";

type Props = {
  edges: Edge[];
  selfId: string;
  book: NameBook;
  range?: [number, number];
  onOpen: (e: Edge, trigger: HTMLElement) => void;
  activeId?: string | null;
  caseEdges?: Set<string>;
  caption: string;
  groupBy?: "family" | null;
  emptyText?: string;
  /** Edge ids excluded by the assumption switches (they fade). Defaults to the page's assumption context. */
  excluded?: Set<string>;
  /** Rows past this many (counted across groups) are marked `is-fold` and hidden by CSS until the table is expanded; print shows them all. */
  foldAfter?: number;
  /** The table is showing its first `foldAfter` rows only. */
  folded?: boolean;
};

const NO_VALUE_TYPES = new Set(["oversees", "revolving_door", "sits_with", "legislates_with", "shared_staff", "position", "shared_donors", "traded_together"]);

export function TieTable({ edges, selfId, book, range, onOpen, activeId, caseEdges, caption, groupBy = null, emptyText, excluded, foldAfter, folded = false }: Props) {
  const ctx = useAssumptionContext();
  const out = excluded ?? ctx?.effect?.excluded;
  if (!edges.length) {
    return <p className="empty">{emptyText ?? "No ties match these filters."}</p>;
  }
  const groups: [Family | "all", Edge[]][] = [];
  if (groupBy === "family") {
    const order: Family[] = ["money", "holding", "people", "context"];
    for (const f of order) {
      const list = edges.filter((e) => e.family === f);
      if (list.length) groups.push([f, list]);
    }
  } else groups.push(["all", edges]);

  // Position of each row in reading order, so the fold cuts the same rows whatever the grouping.
  let seen = 0;
  const foldFrom = (n: number) => foldAfter !== undefined && n >= foldAfter;
  return (
    <div className="tablewrap" data-folded={folded || undefined}>
      <table className="ties">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Tie</th>
            <th scope="col">With</th>
            <th scope="col" className="num">Amount</th>
            <th scope="col" className="num">Records</th>
            <th scope="col">Years</th>
            <th scope="col"><span className="visually-hidden">Evidence</span></th>
          </tr>
        </thead>
        {groups.map(([g, list]) => {
          const groupStart = seen;
          return (
          <tbody key={g}>
            {g !== "all" && (
              <tr className={`ties__group${foldFrom(groupStart) ? " is-fold" : ""}`}>
                <th colSpan={6} scope="colgroup">
                  {FAMILY_LABEL[g]} <span className="mono">{list.length}</span>
                </th>
              </tr>
            )}
            {list.map((e) => {
              const o = otherEnd(e, selfId);
              const name = nodeName(o, book);
              const m = o.kind === "member" ? book.members[o.id] : null;
              const org = o.kind === "org" ? book.orgs[o.id] : null;
              const amt = amountLabel(e, range);
              const n = filteredAmount(e, range).n;
              const folds = foldFrom(seen++);
              return (
                <tr key={e.id} className={[activeId === e.id ? "is-active" : "", out?.has(e.id) ? "is-excluded" : "", folds ? "is-fold" : "", isAgainst(e) ? "is-against" : ""].join(" ").trim() || undefined} data-edge={e.id}>
                  <td data-label="Tie">
                    <span className="ties__type">
                      <LineSample style={stringStyle(e)} />
                      <span>
                        {typeLabel(e)}
                        <span className="ties__dir">{directionWord(edgeDir(e, selfId))}</span>
                      </span>
                    </span>
                    <span className="ties__flags">
                      {e.basis === "derived" && <span className="flag">derived</span>}
                      {e.weak && <span className="flag">thin evidence</span>}
                      {caseEdges?.has(e.id) && !(ctx?.effect && !ctx.effect.cases.has(otherEnd(e, selfId).id)) && <span className="flag flag--case">case</span>}
                      {weakTag(e) && <span className="tag tag--weak">{weakTag(e)}</span>}
                    </span>
                  </td>
                  <td data-label="With">
                    <Link href={o.kind === "member" ? memberHref(o.id) : orgHref(o.id)} className="ties__name">
                      {name}
                    </Link>
                    <span className="ties__sub">
                      {m ? `${m.party} · ${seat(m, false)}` : org ? ORG_KIND_LABEL[org.kind] + (org.ticker ? ` · ${org.ticker}` : "") : ""}
                      {e.via ? ` · via ${e.via.name}` : ""}
                    </span>
                  </td>
                  <td data-label="Amount" className="num mono">
                    {amt ?? <span className="nd">{NO_VALUE_TYPES.has(e.type) ? "no dollar value" : NOT_DISCLOSED}</span>}
                  </td>
                  <td data-label="Records" className="num mono">{count(n)}</td>
                  <td data-label="Years" className="mono">{yearSpan(e.first, e.last)}</td>
                  <td className="ties__act">
                    <button type="button" className="btn btn--small" onClick={(ev) => onOpen(e, ev.currentTarget)} aria-label={`Evidence: ${typeLabel(e)}, ${name}`}>
                      Evidence
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          );
        })}
      </table>
    </div>
  );
}
