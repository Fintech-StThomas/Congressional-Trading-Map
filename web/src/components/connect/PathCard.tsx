"use client";
// One documented path: the route, then each step with every tie that joins its two nodes (what the record says, in the
// direction it gives, with amount, years and an Evidence button), the temporal label and the fixed note.
import Link from "next/link";
import type { NodeRef } from "@/lib/types";
import { CONNECT } from "@/lib/copy";
import { isMemberId } from "@/lib/data/ids";
import { WEAK_WHY } from "@/lib/domain/edges";
import { hopSentence, type Hop, type Path } from "@/lib/domain/paths";
import { amountText, NOT_DISCLOSED, yearRanges, yearSpan } from "@/lib/format";
import { memberHref, orgHref } from "@/lib/urls";
import type { Named } from "./load";

type Props = {
  path: Path;
  index: number;
  names: Record<string, Named>;
  onEvidence: (h: Hop, trigger: HTMLElement) => void;
  activeKey: string | null;
};

const nameOf = (names: Props["names"], id: string) => names[id]?.name ?? id;

function NodeName({ n, names }: { n: NodeRef | { id: string }; names: Props["names"] }) {
  const id = n.id;
  return <Link href={isMemberId(id) ? memberHref(id) : orgHref(id)}>{nameOf(names, id)}</Link>;
}

function TemporalLabel({ path }: { path: Path }) {
  const t = path.temporal;
  if (t.status === "single") return null;
  return (
    <p className={`cpath__time cpath__time--${t.status}`} data-testid="path-temporal">
      {t.status === "overlap" ? CONNECT.temporal.overlap(yearRanges(t.years)) : t.status === "none" ? CONNECT.temporal.none : CONNECT.temporal.unknown}
      {t.status === "overlap" && t.spanBased && <span className="cpath__timeNote"> {CONNECT.temporal.overlapSpan}</span>}
    </p>
  );
}

function HopRow({ h, from, names, onEvidence, active, a, b }: { h: Hop; from: string; names: Props["names"]; onEvidence: Props["onEvidence"]; active: boolean; a: string; b: string }) {
  const s = hopSentence(h, from);
  return (
    <li className={`chop${h.basis === "derived" ? " chop--stat" : ""}${active ? " is-active" : ""}`}>
      <p className="chop__says">
        <NodeName n={s.subject} names={names} /> {CONNECT.verbs[h.type]} <NodeName n={s.object} names={names} />
      </p>
      <p className="chop__meta mono">
        <span>{h.label}</span>
        <span>{amountText(h.amount) ?? NOT_DISCLOSED}</span>
        <span>{CONNECT.records(h.count)}</span>
        <span>{yearSpan(h.first, h.last)}</span>
        {!s.directed && <span>no direction published</span>}
        {h.basis === "derived" && <span className="tag chop__tag">{CONNECT.statistical}</span>}
        {!h.full && <span className="chop__sum" title={CONNECT.summaryOnlyWhy}>{CONNECT.summaryOnly}</span>}
      </p>
      {h.basis === "derived" && <p className="chop__why">{WEAK_WHY.STATISTICAL}</p>}
      <button
        type="button"
        className="btn btn--small chop__ev no-print"
        onClick={(ev) => onEvidence(h, ev.currentTarget)}
        aria-label={CONNECT.evidenceFor(h.label, nameOf(names, a), nameOf(names, b))}
      >
        {CONNECT.evidence}
      </button>
    </li>
  );
}

export function PathCard({ path, index, names, onEvidence, activeKey }: Props) {
  const first = path.nodes[0];
  const last = path.nodes[path.nodes.length - 1];
  const headId = `path-${index}-h`;
  return (
    <li className="cpath" data-testid="path">
      <article aria-labelledby={headId}>
        <h3 id={headId} className="cpath__head">{CONNECT.pathHeading(index + 1, path.steps.length)}</h3>
        <p className="cpath__route">
          {path.nodes.map((id, i) => (
            <span key={id}>
              {i > 0 && <span className="cpath__sep" aria-hidden="true"> — </span>}
              <NodeName n={{ id }} names={names} />
            </span>
          ))}
        </p>
        {path.anyDerived && <p className="cpath__flag"><span className="tag chop__tag">{CONNECT.statistical}</span> {CONNECT.pathNoteStat}</p>}
        <TemporalLabel path={path} />
        <ol className="cpath__steps">
          {path.steps.map((st, i) => (
            <li key={`${st.from}>${st.to}`} className="cstep">
              <h4 className="cstep__head">{CONNECT.stepHeading(i + 1, nameOf(names, st.from), nameOf(names, st.to))}</h4>
              <ul className="cstep__hops">
                {st.hops.map((h) => (
                  <HopRow key={h.key} h={h} from={st.from} names={names} onEvidence={onEvidence} active={activeKey === h.key} a={st.from} b={st.to} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <p className="cpath__note">{CONNECT.pathNote(nameOf(names, first), nameOf(names, last))}</p>
      </article>
    </li>
  );
}
