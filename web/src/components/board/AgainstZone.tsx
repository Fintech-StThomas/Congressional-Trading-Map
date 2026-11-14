"use client";

import type { Edge, NodeRef } from "@/lib/types";
import { nodeName, ORG_KIND_LABEL, type NameBook } from "@/lib/client";
import { otherEnd } from "@/lib/edges";
import { money } from "@/lib/format";

/**
 * Spending against the member (or, on an organisation's board, members it spent
 * for or against where the side is not recorded): pinned cards with no yarn,
 * kept apart from the ties because they are not a relationship.
 */
export function AgainstZone({ edges, more, selfId, book, title, line, onOpen, onRecenter }: {
  edges: Edge[]; more: number; selfId: string; book: NameBook; title: string; line: string;
  onOpen: (e: Edge, el: Element) => void; onRecenter: (n: NodeRef) => void;
}) {
  if (!edges.length) return null;
  return (
    <section className="against" aria-labelledby="against-h" data-testid="against-zone">
      <div className="against__head">
        <h3 id="against-h">{title}</h3>
        <p>{line}</p>
      </div>
      <ul className="against__cards">
        {edges.map((e) => {
          const o = otherEnd(e, selfId);
          const name = nodeName(o, book);
          const org = o.kind === "org" ? book.orgs[o.id] : null;
          const amt = e.amount.exact ?? e.amount.high ?? e.amount.low;
          const side = e.note === "oppose" ? "opposing" : e.note === "support" ? "supporting" : "for or against (side not recorded here)";
          return (
            <li key={e.id} className="against__card">
              <span className="pinhead-css" aria-hidden="true" />
              <button type="button" className="against__open" onClick={(ev) => onOpen(e, ev.currentTarget)}
                aria-label={`${name}: spent ${amt != null ? money(amt) : "an undisclosed amount"} ${side}. Independent spending, not a tie. Open the evidence.`}>
                <span className="against__tag">{e.note === "oppose" ? "AGAINST" : "SPENT"}</span>
                <span className="against__kind">{org ? ORG_KIND_LABEL[org.kind] : "Member"}</span>
                <span className="against__name">{name}</span>
                <span className="against__amt">spent {amt != null ? money(amt) : "an undisclosed amount"} {side}</span>
              </button>
              <button type="button" className="against__recentre" onClick={() => onRecenter(o)} aria-label={`Re-centre the board on ${name}`} title="Re-centre the board here">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="8" cy="8" r="1.6" fill="currentColor" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
      {more > 0 && <p className="against__more">plus {more.toLocaleString("en-US")} more in the full list</p>}
    </section>
  );
}
