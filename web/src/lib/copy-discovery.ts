// Fixed wording for the discovery features: the new-this-week page (NEW), organisation feeds (ORG_FEED) and watchlists
// without accounts (WATCH). Kept apart from copy.ts (which is large); import from here. Reports what filings say, never
// asserts wrongdoing; missing is never zero; amounts are the disclosed ranges.
import { SITE } from "./copy.ts";

export const NEW = {
  title: "New this week",
  nav: "New",
  description: "Stock trades by members of Congress that became public in the last 7 days of this data build, newest first, with the disclosed range and the filing.",
  lede: "Trades that became public in the 7 days before the date of this data build. The window is counted back from that build date, not from your clock, so the page agrees with the data.",
  /** "42 trades made public in the 7 days to 13 Nov 2026". */
  count: (n: number, to: string) => `${n} ${n === 1 ? "trade" : "trades"} made public in the 7 days to ${to}`,
  noBuildDate: "The build date of this data is not recorded, so no 7-day window can be drawn. Nothing is shown rather than a guess.",
  /** `files` is the bound on member trade files read (the same bound as the site feed). */
  bound: (files: number) =>
    `From members with recent activity in this data build: at most ${files} members with trades in the latest years are read, so this is not every trade made public across Congress.`,
  dated: "Trades with no public-availability date are left out, because the page lists trades by the date they became public.",
  empty: "No trades from these members became public in this window. That says nothing about members outside the bound above.",
  filterChamber: "Chamber",
  filterAction: "Action",
  all: "All",
  chambers: { all: "All", rep: "House", sen: "Senate" },
  actionAll: "Any action",
  subscribe: "Subscribe (RSS)",
  filtered: (shown: number, total: number) => `Showing ${shown} of ${total}`,
  cols: {
    available: "Made public",
    member: "Member",
    action: "Action",
    asset: "Asset",
    amount: "Amount as disclosed",
    owner: "Owner as filed",
    date: "Transaction date",
    lag: "Days to public",
    filing: "Filing",
  },
  noTicker: "no ticker",
  noFiling: "no public link",
  filingLink: "Filing",
  unavailable: "The recent trades could not be read just now. Try again in a few minutes.",
  caption: "Trades made public in the last 7 days of this data build, newest first",
} as const;

export const ORG_FEED = {
  title: (name: string) => `${SITE.name}: ${name}, trades and money ties`,
  /** `files` is the most member files read for one organisation feed. */
  note: (name: string, files: number) =>
    `Recent items from the organisation file for ${name}: trades in this organisation by tied members and PAC contributions from it. At most ${files} members' files are read, the members with the most recent ties first, so this is not every trade or contribution.`,
  moneyRule: "Money items are one line per tie, dated by the latest record date the data gives for it; where only a year is known the item is dated 31 December of that year and says so. Spending against a member is never listed as a tie. Outside spending is listed only where the filing says it supports the member.",
  /** The source named on a money item. */
  moneySource: "filed public records named in the tie (see the case file for each record)",
  yearOnly: (year: number) => `Date: year only (${year}); the data gives no day, so the item is dated at the end of ${year}, or on the data build date while ${year} is still in progress.`,
  latest: (d: string) => `Latest record in this tie: ${d}.`,
  records: (n: number) => `${n} ${n === 1 ? "record" : "records"} in this tie.`,
  years: (span: string) => `Years: ${span}.`,
  subscribe: "Subscribe (RSS)",
  subscribeTitle: "A feed of recent trades and money ties for this organisation",
  alternateTitle: (name: string) => `${SITE.name}: ${name}`,
} as const;

export const WATCH = {
  title: "Following",
  description: "The members and organisations you follow, kept only in this browser, and one feed address that lists new filings about all of them.",
  lede: "Follow members and organisations from their pages, then use one feed address in any feed reader to see new filings about them.",
  follow: "Follow",
  following: "Following",
  unfollow: "Unfollow",
  followLabel: (name: string) => `Follow ${name}`,
  unfollowLabel: (name: string) => `Stop following ${name}`,
  feedLink: "Your feed link",
  manage: "Manage list",
  limitMembers: "You follow the most members one feed can hold (25). Unfollow one to add another.",
  limitOrgs: "You follow the most organisations one feed can hold (25). Unfollow one to add another.",
  memoryNotice: "This browser is blocking storage, so what you follow is kept only until you leave or reload this page.",
  corruptNotice: "The saved list could not be read, so it starts empty.",
  loading: "Reading your list…",
  privacyTitle: "Where this list lives",
  privacy: [
    "The list is kept only in this browser. Nothing is uploaded and there is no account.",
    "The feed link contains only the ids of what you follow. Anyone who has the link sees the same public records, and the link tells them what you follow, so share it with care.",
    "Clearing this site's data in your browser clears the list. The same list on another device or browser needs the link or following again.",
  ],
  membersHeading: "Members",
  orgsHeading: "Organisations",
  noneMembers: "No members followed yet. Open a member's page and press Follow.",
  noneOrgs: "No organisations followed yet. Open an organisation's page and press Follow.",
  remove: "Remove",
  removeLabel: (name: string) => `Remove ${name} from the list`,
  notInIndex: "name not in the search index",
  feedHeading: "Your feed",
  feedEmpty: "Follow at least one member or organisation to get a feed link.",
  copy: "Copy feed link",
  copied: "Feed link copied.",
  copyFailed: "Copying is not available here. Select the link and press Ctrl+C (Cmd+C on a Mac).",
  open: "Open the feed",
  howHeading: "How to use it",
  how: [
    "Paste the feed link into any feed reader to see new items as they are published.",
    "To get them by email, paste the same link into an RSS-to-email service. Paper Trail does not send email and cannot see who reads a feed.",
    "The feed lists at most 100 items, newest first, from at most 25 members and 25 organisations. It is rebuilt with each data build, about once a day. Each item says what a filing says; none says anything about why.",
  ],
  limits: "One feed holds at most 25 members and 25 organisations.",
  channelTitle: `${SITE.name}: what you follow`,
  /** `members` and `orgs` are the counts followed in this feed. */
  channelNote: (members: number, orgs: number) =>
    `New items from ${members} ${members === 1 ? "member" : "members"} and ${orgs} ${orgs === 1 ? "organisation" : "organisations"} named in this address: members' most recent trades made public, and for organisations the PAC contributions and trades by tied members found within a bound of 25 member files per request. The newest 100 items are shown, so this is not every filing.`,
  badRequest: "Bad request",
  fromBoard: {
    follow: "Follow everything on this board",
    exportFeed: "Export as feed",
    followed: (added: number, skipped: number) =>
      skipped > 0 ? `Now following ${added} more. ${skipped} did not fit within the limit of 25 members and 25 organisations.` : `Now following ${added} more.`,
    nothing: "Everything on this board is already followed, or the board has no members or organisations.",
    overLimit: "This board has more than 25 members or organisations; the feed holds the first 25 of each by id.",
    hint: "Adds the members and organisations on this board to what you follow. Kept only in this browser.",
  },
  savedLink: "Following",
  footerLink: "Following",
} as const;
