// Looks a saved record up in the site's data, in the browser, for "re-check" and for shared boards. Uses the same
// loaders as the pages (getJSON, the member file, the organisation shard). Never writes anything and never throws:
// the outcome is found, missing or error.
import type { MemberFile, OrgFileWire } from "@/lib/types";
import { getJSON } from "@/lib/data/fetch";
import { orgShard } from "@/lib/hash";
import { amountText, NOT_DISCLOSED, served, yearRange, yearSpan } from "@/lib/format";
import { dataUrl, releaseDataUrl } from "@/lib/urls";
import { tieLabel, type ItemKind, type Party } from "@/lib/domain/saved";

export type Lookup = { kind: ItemKind; member?: string; org?: string; edge?: string; release: string | null };
export type Resolved =
  | { state: "found"; label: string; amount_text: string; years: string; parties: Party[]; from: "release" | "current" }
  | { state: "missing" | "error" };

type Opts = {
  /** The item's own release is used when true and the site serves releases (pinned mode). */
  useItemRelease: boolean;
  pinned: boolean;
};

async function read(it: Lookup, o: Opts, from: "release" | "current"): Promise<Resolved> {
  const url = (rel: string) => (from === "release" && it.release ? releaseDataUrl(it.release, rel) : dataUrl(rel));
  if (it.kind === "org" && it.org) {
    const shard = await orgShard(it.org);
    const file = (await getJSON<Record<string, OrgFileWire>>(url(`orgs/${shard}.json`)))[it.org];
    if (!file) return { state: "missing" };
    return { state: "found", label: file.org.name, amount_text: "", years: file.years ? yearRange(file.years) : "", parties: [], from };
  }
  if (!it.member) return { state: "missing" };
  const file = await getJSON<MemberFile>(url(`members/${it.member}.json`));
  const m = file.member;
  if (it.kind === "member") return { state: "found", label: m.name, amount_text: "", years: served(m.served), parties: [m.party], from };
  const e = file.edges.find((x) => x.id === it.edge);
  if (!e) return { state: "missing" };
  const name = (n: { kind: string; id: string }) => (n.id === m.id ? m.name : file.nodes?.[n.id]?.name ?? n.id);
  const parties = [e.from, e.to].filter((n) => n.kind === "member").map((n) => (n.id === m.id ? m.party : null)).filter((p): p is Party => p !== null);
  return {
    state: "found", label: tieLabel(e, { from: name(e.from), to: name(e.to) }), amount_text: amountText(e.amount) ?? NOT_DISCLOSED,
    years: yearSpan(e.first, e.last), parties, from,
  };
}

/** Looks one record up. A record saved from a release is read from that release when `useItemRelease` and the site
 *  is pinned; if that fails (or is not asked for) the current data is read. */
export async function lookup(it: Lookup, o: Opts): Promise<Resolved> {
  if (o.useItemRelease && o.pinned && it.release) {
    try {
      const r = await read(it, o, "release");
      if (r.state === "found") return r;
    } catch {
      /* fall back to the current data */
    }
  }
  try {
    return await read(it, o, "current");
  } catch (e) {
    return { state: /^404 /.test(e instanceof Error ? e.message : "") ? "missing" : "error" };
  }
}
