// The bounded read of recent trades shared by the site feed (/feed/trades.xml) and the new-this-week page (/new):
// pick at most SITE_MEMBER_FILES members with recent activity (pickFeedMembers), read their trade files with bounded
// concurrency, return every trade row with its member. One function so both always describe the same set.
import type { Data } from "./reader.ts";
import { mapLimit } from "./server.ts";
import { decodeTradeFile } from "./decode.ts";
import { decodeWallYears, type WallYears, type WallYearsRaw } from "../domain/wallyears.ts";
import { READ_CONCURRENCY, SITE_MEMBER_FILES, pickFeedMembers, type FeedMember, type FeedTrade } from "../domain/feed.ts";

/** wall-years.json when this build has it and it decodes; null otherwise (older builds, the fixtures). */
export async function wallYears(data: Data): Promise<WallYears | null> {
  try {
    const raw = await data.readData<WallYearsRaw | null>("wall-years.json", null);
    return raw ? decodeWallYears(raw) : null;
  } catch {
    return null;
  }
}

/** Every current trade of one member, each with the member it belongs to. */
export async function tradesOf(data: Data, m: FeedMember): Promise<FeedTrade[]> {
  const member = { id: m.id, name: m.name, party: m.party, state: m.state, chamber: m.chamber, district: m.district };
  return decodeTradeFile(await data.getTradeFile(m.id)).map((trade) => ({ member, trade }));
}

/** All trades of the (at most `cap`) members with recent activity in this data build: the bound both readers state honestly. */
export async function readRecentActivityTrades(data: Data, cap = SITE_MEMBER_FILES): Promise<FeedTrade[]> {
  const [members, wall] = await Promise.all([data.getMembers(), wallYears(data)]);
  const picked = pickFeedMembers(members, wall, cap);
  return (await mapLimit(picked, READ_CONCURRENCY, (m) => tradesOf(data, m))).flat();
}
