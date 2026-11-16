// Reads for an organisation's feed items: its shard entry, then (within a hard bound on member files) the trade files
// and member files the plan in lib/domain/orgfeed.ts asks for. Shared by /feed/o/<id>.xml and the combined watch feed,
// which passes one RequestFiles so a member file is read at most once per request and the bound covers both.
import type { Data } from "./reader.ts";
import type { MemberFileWire, OrgFileWire } from "../types.ts";
import { decodeOrgTies } from "./decode.ts";
import { mapLimit } from "./server.ts";
import { tradesOf } from "./recentTrades.ts";
import { orgShard } from "../hash.ts";
import { isOrgId } from "./ids.ts";
import { READ_CONCURRENCY, type FeedContext, type FeedItem, type FeedMember, type FeedTrade } from "../domain/feed.ts";
import { candidates, evidenceDates, listableMoney, moneyItem, orgTradeItems, planOrgFeed, type Need } from "../domain/orgfeed.ts";

/** Member files read so far in one request (memoised), so the bound is shared and nothing is read twice. */
export class RequestFiles {
  trades = new Map<string, Promise<FeedTrade[]>>();
  members = new Map<string, Promise<MemberFileWire | null>>();
  constructor(private data: Data) {}
  get size(): number {
    return this.trades.size + this.members.size;
  }
  keys(): Set<string> {
    return new Set([...this.trades.keys()].map((k) => `trades:${k}`).concat([...this.members.keys()].map((k) => `member:${k}`)));
  }
  tradesOf(m: FeedMember): Promise<FeedTrade[]> {
    let p = this.trades.get(m.id);
    if (!p) this.trades.set(m.id, (p = tradesOf(this.data, m)));
    return p;
  }
  memberFile(id: string): Promise<MemberFileWire | null> {
    let p = this.members.get(id);
    if (!p) this.members.set(id, (p = this.data.getMemberFile(id)));
    return p;
  }
}

/** The organisation's entry in its shard, or null for an unknown id (shape checked first, no read for junk). */
export async function readOrgFile(data: Data, id: string): Promise<OrgFileWire | null> {
  if (!isOrgId(id)) return null;
  const shard = await data.readData<Record<string, OrgFileWire> | null>(`orgs/${await orgShard(id)}.json`, null);
  return shard && Object.prototype.hasOwnProperty.call(shard, id) ? shard[id] : null;
}

/**
 * Feed items for one organisation, using at most `budget` new member-file reads from `files` (default: the whole bound).
 * `prefix` goes before each money title (the followed name in a combined feed) and each trade title.
 */
export async function orgFeedItems(data: Data, file: OrgFileWire, files: RequestFiles, c: FeedContext, budget: number, prefix = ""): Promise<FeedItem[]> {
  const org = file.org;
  const plan = planOrgFeed(candidates(decodeOrgTies(file)), budget, files.keys());
  const mi = await data.getMemberIndex();
  const member = (id: string): FeedMember | null => {
    const m = mi.get(id);
    return m ? { id: m.id, name: m.name, party: m.party, state: m.state, chamber: m.chamber, district: m.district } : null;
  };
  const read = (n: Need): Promise<unknown> => {
    const m = member(n.id);
    return m ? (n.kind === "trades" ? files.tradesOf(m) : files.memberFile(n.id)) : Promise.resolve(null);
  };
  await mapLimit(plan.reads, READ_CONCURRENCY, read);

  const items: FeedItem[] = [];
  const byMember = new Map<string, FeedTrade[]>();
  for (const { tie, kind } of plan.chosen) {
    const id = tie._tie!.member;
    const m = member(id);
    if (!m) continue;
    if (kind === "trades") {
      const t = files.trades.get(id);
      if (t && !byMember.has(id)) byMember.set(id, await t);
      continue;
    }
    const mf = files.members.has(id) ? await files.members.get(id) : null;
    const full = tie._tie!.edge ? mf?.edges?.find((e) => e.id === tie._tie!.edge) : undefined;
    if (!listableMoney(tie, full)) continue;
    const it = moneyItem(org, tie, m, evidenceDates(mf?.edges, tie._tie!.edge), c);
    if (it) items.push({ ...it, title: prefix + it.title });
  }
  return [...orgTradeItems(org.id, byMember, c).map((it) => ({ ...it, title: prefix + it.title })), ...items];
}
