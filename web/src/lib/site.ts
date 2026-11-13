// The site's name and voice live here and only here. Change them in one place.
export const SITE = {
  name: "Paper Trail",
  tagline: "Talk is cheap. Follow the money.",
  description:
    "A map of every member of Congress and the organisations and colleagues they are tied to by filed public records: stock trades, PAC money, outside spending, member-to-member money and committee seats. Every string shows its records.",
  // Placeholder: replace with a monitored address before launch.
  correctionsEmail: "corrections@example.org",
  disclaimer: "A tie is not a finding. This shows what the filings say, not why.",
} as const;

export const YEAR_MIN = 2000;
export const YEAR_MAX = 2026;
