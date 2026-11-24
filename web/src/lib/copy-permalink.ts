// Wording for permanent pages of organisations and disclosure timing (/r/<release>/o/<id>, /r/<release>/delays), their
// "Cite this" packets and CSV, and the long-release-list picker on /changes. Kept apart from copy.ts (over the line cap).

export const PERMALINK = {
  /** The pinned-page notice for pages that are not a member's: what the member banner says, without its member-only exception. */
  bannerBody: "The figures on this page do not change when newer data is published. Links from this page lead to the latest data.",
  orgBannerBody: "The figures on this page do not change when newer data is published. Links to members stay on this release; other links lead to the latest data.",
  org: {
    titleOf: (name: string) => `${name}: ties`,
    citeTitle: (name: string) => `${name}: ties to members`,
    limits: [
      "Ties are links in filed records; a tie says two records connect, not that anything improper happened.",
      "The table lists the largest ties only when the organisation has more than the file lists; the totals on the page cover all of them.",
    ],
    csvFile: "paper-trail-organisation-ties",
    csvNote: "Ties as listed on the page; amounts are disclosed ranges or exact dollars as filed, blank means not disclosed.",
    csvButton: "Download CSV",
    csvButtonFiltered: "Download CSV (filtered)",
  },
  delays: {
    citeTitle: "Disclosure timing: days between the transaction date as filed and the date the report became public",
    limits: [
      "Days are counted from the transaction date as filed to the date the report became public; trades without both dates are counted apart and never given a delay.",
      "A long delay is an observed gap in the filings, not a finding of a violation.",
    ],
  },
} as const;

/** The /changes picker lists this many of the newest releases; older ones are entered by id. */
export const RELEASE_PICKER_CAP = 200;

export const RELEASE_PICKER = {
  olderLine: (shown: number, total: number) => `Showing the newest ${shown} of ${total} listed releases. To use an older one, paste its 64-character release id.`,
  inputLabel: "Older release id",
  inputHint: "Paste a release id from the list",
  notListed: "That id is not in the release list.",
  notId: "A release id is 64 characters, 0 to 9 and a to f.",
} as const;
