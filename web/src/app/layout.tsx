// The root layout: fonts, global CSS (in cascade order), header with search and navigation, footer.
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Public_Sans, JetBrains_Mono, Courier_Prime } from "next/font/google";
import { FEED, SITE } from "@/lib/copy";
import { IS_SAMPLE, getMetaForLayout, latestData, metaBuilt } from "@/lib/data/server";
import { date } from "@/lib/format";
import { statusHref } from "@/lib/urls";
import { SearchBox } from "@/components/shared/SearchBox";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { Wordmark } from "@/components/shared/Wordmark";
import { CorrectionLink, CorrectionProvider } from "@/components/shared/CorrectionLink";
import { FooterAsOf } from "@/components/shared/FooterAsOf";
import { StaleBanner } from "@/components/shared/StaleBanner";
import { NewerDataNote } from "@/components/shared/NewerDataNote";
import { SiteHeader } from "@/components/shared/SiteHeader";
import { Notice } from "@/components/shared/Notice";
import { Analytics } from "@vercel/analytics/next";
import "@/styles/tokens.css";
import "@/styles/globals.css";
import "@/styles/board.css";
import "@/styles/pages.css";
import "@/styles/notices.css";

const sans = Public_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap", weight: ["400", "500", "600", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500", "600"] });
const type = Courier_Prime({ subsets: ["latin"], variable: "--font-type", display: "swap", weight: ["700"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : SITE.url),
  title: { default: `${SITE.name}: ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  openGraph: { title: SITE.name, description: SITE.description, type: "website", siteName: SITE.name },
  twitter: { card: "summary_large_image", title: SITE.name, description: SITE.description },
  // Feed discovery: readers and browsers find the site-wide feed of trades made public (app/feed/trades.xml).
  alternates: { types: { "application/rss+xml": [{ url: "/feed/trades.xml", title: FEED.siteTitle }] } },
  robots: IS_SAMPLE ? { index: false, follow: false } : undefined,
};

export const viewport: Viewport = {
  themeColor: "#151210",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const built = metaBuilt(await getMetaForLayout());
  // The release this page is rendered from (pinned mode only), so an open tab can tell when the pointer has moved.
  const release = (await latestData().catch(() => null))?.release ?? null;
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${type.variable}`}>
      <body className={IS_SAMPLE ? "is-sample" : undefined}>
        <CorrectionProvider built={built}>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <SiteHeader
            brand={
              <Link href="/" className="brand" aria-label={`${SITE.name}, home`}>
                <Wordmark />
                <span className="brand__name">{SITE.name}</span>
                <span className="brand__tagline">{SITE.tagline}</span>
              </Link>
            }
            search={
              <ErrorBoundary label="search" fallback={<span />}>
                <SearchBox />
              </ErrorBoundary>
            }
            stamp={
              IS_SAMPLE ? (
                <span className="stamp" title="Every name, company, amount and link on this build is invented test data.">
                  Sample data
                </span>
              ) : undefined
            }
          />
        </header>
        {/* Under the header, always in this order: sample band, stale banner, newer-data note. A release banner (permalink pages) opens the page itself. */}
        <div className="notices">
          {IS_SAMPLE && (
            <Notice tone="warning" band className="sample-band">
              <strong>Sample data.</strong> Every member, company, amount and record link on this build is invented for testing. Nothing here describes a real person.
            </Notice>
          )}
          <StaleBanner built={built} sample={IS_SAMPLE} />
          <NewerDataNote built={built} release={release} />
        </div>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          <div className="site-footer__inner">
            <p>
              <span className="mono">{SITE.name}</span> maps ties named in filed public records. {SITE.disclaimer}
            </p>
            <p className="site-footer__meta">
              <FooterAsOf asOf={built ? date(built) : "unknown"} built={built} sample={IS_SAMPLE} />
              <Link href="/method">Sources and method</Link>
              <Link href={statusHref()}>Data status</Link>
              <Link href="/watch" data-testid="footer-following">Following</Link>
              <Link href="/about">About</Link>
              <span>Not investment advice</span>
              <span>No commercial use or solicitation (5 U.S.C. 13107(c))</span>
              <CorrectionLink />
            </p>
          </div>
        </footer>
        </CorrectionProvider>
        {/* Cookie-free page-view counts (Vercel Web Analytics). Active only on Vercel. */}
        <Analytics />
      </body>
    </html>
  );
}
