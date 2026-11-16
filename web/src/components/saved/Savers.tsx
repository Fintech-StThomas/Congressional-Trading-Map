"use client";
// The two places a Save control is wired in: one tie in the evidence drawer (saved with its citation packet, captured
// at the moment of saving) and a member in the case-file header. Both build their saved item from data already on
// the page and use the page's release; nothing is fetched or sent.
import { useMemo, useState } from "react";
import type { Edge } from "@/lib/types";
import { buildTieCitation, buildViewCitation } from "@/lib/domain/citation";
import { edgeFacts } from "@/lib/domain/coverage";
import { isEdgeId, tieLabel, type ItemInput, type Party } from "@/lib/domain/saved";
import { amountText, NOT_DISCLOSED, yearSpan } from "@/lib/format";
import { isReleaseId } from "@/lib/data/release";
import { useCiteEnv } from "@/components/shared/CiteEnv";
import type { NameBook } from "@/lib/domain/names";
import { SaveButton } from "./SaveButton";

const release = (r: string | null) => (isReleaseId(r) ? r : null);

export function TieSave({ edge, book, names, sources, range, ledgerOnly }: {
  edge: Edge; book: NameBook; names: { from: string; to: string }; sources: Record<string, string>; range?: [number, number]; ledgerOnly: boolean;
}) {
  const [active, setActive] = useState(false);
  const env = useCiteEnv(active, sources);
  const ends = [edge.from, edge.to];
  const member = ends.find((n) => n.kind === "member")?.id;
  const org = ends.find((n) => n.kind === "org")?.id;
  const parties = useMemo(
    () => ends.filter((n) => n.kind === "member").map((n) => book.members[n.id]?.party).filter((p): p is Party => Boolean(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edge, book],
  );
  // A tie that has no full record (no real edge id) or no member end cannot be found again, so it cannot be saved.
  if (!member || !isEdgeId(edge.id)) return null;
  const build = (): ItemInput => {
    const citation = buildTieCitation({ edge, names, range, ledgerOnly, limitations: edgeFacts(edge, ledgerOnly).map((f) => f.text), env: { ...env, retrieved: new Date().toISOString() } });
    return {
      kind: "tie", member, org, edge: edge.id, release: release(env.release), label: tieLabel(edge, names),
      amount_text: amountText(edge.amount) ?? NOT_DISCLOSED, years: yearSpan(edge.first, edge.last), parties, citation,
    };
  };
  return <SaveButton identity={{ kind: "tie", member, org, edge: edge.id }} build={build} onOpenChange={setActive} testId="save-tie" />;
}

export function MemberSave({ member, years, party, counts, dates, limitations }: {
  member: { id: string; name: string }; years: string; party: Party; counts: Record<string, number | null>;
  dates: { first: string | null; last: string | null }; limitations: string[];
}) {
  const env = useCiteEnv(true);
  const build = (): ItemInput => ({
    kind: "member", member: member.id, release: release(env.release), label: member.name, amount_text: "", years, parties: [party],
    citation: buildViewCitation({ kind: "member", member, limitations, dates, counts, env: { ...env, retrieved: new Date().toISOString() } }),
  });
  return <SaveButton identity={{ kind: "member", member: member.id }} build={build} testId="save-member" />;
}
