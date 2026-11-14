# Paper Trail

Paper Trail maps every member of Congress since 2000 to the organisations and colleagues they are tied to by filed
public records: stock trades, House holdings, PAC money, outside spending, member-to-member money and committee
seats. Every tie on the site links to the records it comes from. A tie is not a finding: the site shows what the
filings say, not why.

Live site: https://red-paper-trail.vercel.app/

## Where things are

| Path | What |
|---|---|
| [`web/`](web/README.md) | the site (Next.js), deployed on Vercel |
| [`pipeline/`](pipeline/README.md) | the Python pipeline that builds the data from the public sources |
| [`docs/data-dictionary.md`](docs/data-dictionary.md) | the data contract between the two: every file, field and rule |
| [`docs/validation/`](docs/validation/README.md) | hand-check samples of the published records |

## Data

The generated data is not stored in git. A GitHub Actions workflow (`.github/workflows/data.yml`) rebuilds it daily
from the sources, runs the validators, and publishes it to a Cloudflare R2 bucket:
`https://pub-b6acb08f97e345d68ebc4629e915f8ab.r2.dev/data` (start with `meta.json`, which gives the build time and
each source's revision). The site reads it from there and picks up a new build within about 15 minutes. Sources
and licences are listed in `pipeline/README.md`.

## Corrections

Report an error through the "Report a correction" link on any page of the site, which opens a prefilled public
issue in this repository with the `correction` label. Every report and its outcome is in the open:
https://github.com/Fintech-StThomas/Congressional-Trading-Map/issues?q=label%3Acorrection

## Use restriction

Use is restricted by 5 U.S.C. 13107(c): it is unlawful to obtain or use a financial disclosure report for any
unlawful purpose, for any commercial purpose other than by news and communications media for dissemination to the
general public, for determining or establishing the credit rating of any individual, or for use, directly or
indirectly, in the solicitation of money for any political, charitable or other purpose.

Nothing here is investment advice.
