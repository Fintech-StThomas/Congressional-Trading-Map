// "New this week" (/new): the seven-day window counted back from the data build date (never the visitor's clock), the
// rows for trades made public in it (newest first by the available date, then member), and the chamber and action
// filters. Pure: the page reads the files and hands the trades here; every figure is formatted here so the component
// only renders. tests/newweek.test.mjs loads this directly.
import type { MemberSummary } from "../types.ts";
import type { FeedTrade } from "./feed.ts";
import { amountText, date, days, NOT_DISCLOSED, seat } from "../format.ts";
import { isOrgId } from "../data/ids.ts";
import { memberHref, orgHref, safeHttpUrl } from "../urls.ts";
import { oneLine } from "./escape.ts";

/** Days in the window, the build date included. */
export const WEEK_DAYS = 7;

export type WeekWindow = { from: string; to: string };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** `iso` (YYYY-MM-DD) moved by `n` days, by calendar arithmetic in UTC (no local time zone). Null when `iso` is not a date. */
export function addDays(iso: string, n: number): string | null {
  const m = ISO_DAY.exec(iso);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (Number.isNaN(t) || new Date(t).getUTCMonth() !== +m[2] - 1) return null;
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The window of `days` calendar days ending on the build date, both ends included: the 7 days to 13 Nov are 7 to 13 Nov.
 * Null when the build date is unknown or malformed (the page then says so rather than guess).
 */
export function weekWindow(built: string | null | undefined, span = WEEK_DAYS): WeekWindow | null {
  const to = typeof built === "string" ? ISO_DAY.exec(built)?.[0] : undefined;
  const from = to ? addDays(to, -(span - 1)) : null;
  return to && from ? { from, to } : null;
}

/** Is a made-public date inside the window? Dates compare as text (ISO). No available date is never inside. */
export function inWindow(available: string | null | undefined, w: WeekWindow): boolean {
  const d = typeof available === "string" ? ISO_DAY.exec(available)?.[0] : undefined;
  return d !== undefined && d >= w.from && d <= w.to;
}

export type Chamber = "all" | MemberSummary["chamber"];

export type NewRow = {
  id: string;
  /** ISO day it became public (the sort key). */
  available: string;
  availableText: string;
  member: { id: string; name: string; party: "D" | "R" | "I"; seatText: string; href: string };
  chamber: MemberSummary["chamber"] | null;
  action: string;
  actionText: string;
  asset: string;
  ticker: string | null;
  org: { id: string; href: string } | null;
  amountText: string;
  ownerText: string;
  dateText: string;
  lagText: string;
  /** Public more than 45 days after the stated transaction date (the pipeline's flag; the chip is neutral). */
  over: boolean;
  filing: string | null;
};

const ACTION_TEXT: Record<string, string> = { buy: "Buy", sell: "Sell", exchange: "Exchange", other: "Other" };
const OWNER_TEXT: Record<string, string> = { self: "Self", spouse: "Spouse", joint: "Joint", dependent: "Dependent", unspecified: "Not stated" };

function toRow({ member, trade: t }: FeedTrade): NewRow {
  const orgId = isOrgId(t.org) ? t.org : null;
  return {
    id: t.id,
    available: (t.available as string).slice(0, 10),
    availableText: date(t.available),
    member: {
      id: member.id,
      name: oneLine(member.name),
      party: member.party,
      seatText: seat({ chamber: member.chamber ?? "rep", state: oneLine(member.state), district: member.district ?? null }, false),
      href: memberHref(member.id),
    },
    chamber: member.chamber ?? null,
    action: t.action,
    actionText: (ACTION_TEXT[t.action] ?? "Other") + (t.action === "sell" && t.partial ? " (partial)" : ""),
    asset: oneLine(t.asset),
    ticker: oneLine(t.ticker) || null,
    org: orgId ? { id: orgId, href: orgHref(orgId) } : null,
    amountText: amountText({ low: t.low ?? null, high: t.high ?? null, exact: null }) ?? NOT_DISCLOSED,
    ownerText: OWNER_TEXT[t.owner] ?? "Not stated",
    dateText: date(t.date),
    lagText: t.lag_days == null || t.lag_days < 0 ? "not disclosed" : days(t.lag_days),
    over: t.late === true,
    filing: safeHttpUrl(t.url),
  };
}

/**
 * Trades made public inside the window, newest first by the available date, then member name, then member id and trade
 * id (so the order is stable). Trades with no available date are left out; duplicates (one trade id) appear once.
 */
export function weekRows(items: readonly FeedTrade[], w: WeekWindow): NewRow[] {
  const seen = new Set<string>();
  return items
    .filter((x) => inWindow(x.trade.available, w))
    .map(toRow)
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((a, b) => b.available.localeCompare(a.available) || a.member.name.localeCompare(b.member.name) || a.member.id.localeCompare(b.member.id) || a.id.localeCompare(b.id));
}

/** The rows for a chamber ("all" keeps every row, including those whose chamber is unknown) and an action ("all" keeps every action). */
export function filterRows(rows: readonly NewRow[], f: { chamber: Chamber; action: string }): NewRow[] {
  return rows.filter((r) => (f.chamber === "all" || r.chamber === f.chamber) && (f.action === "all" || r.action === f.action));
}

/** The actions present in the rows, in a fixed order (buy, sell, exchange, other), for the action filter. */
export function actionsIn(rows: readonly NewRow[]): string[] {
  const have = new Set(rows.map((r) => r.action));
  return ["buy", "sell", "exchange", "other"].filter((a) => have.has(a));
}
