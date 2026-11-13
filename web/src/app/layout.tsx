import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Public_Sans, JetBrains_Mono, Courier_Prime } from "next/font/google";
import { SITE } from "@/lib/site";
import { IS_SAMPLE, getMeta, metaBuilt } from "@/lib/data";
import { date } from "@/lib/format";
import { SearchBox } from "@/components/SearchBox";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Wordmark } from "@/components/Wordmark";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

const sans = Public_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap", weight: ["400", "500", "600", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500", "600"] });
const type = Courier_Prime({ subsets: ["latin"], variable: "--font-type", display: "swap", weight: ["700"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
  title: { default: `${SITE.name}: ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  openGraph: { title: SITE.name, description: SITE.description, type: "website", siteName: SITE.name },
  twitter: { card: "summary_large_image", title: SITE.name, description: SITE.description },
  robots: IS_SAMPLE ? { index: false, follow: false } : undefined,
};

export const viewport: Viewport = {
  themeColor: "#151210",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const built = metaBuilt(getMeta());
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${type.variable}`}>
      <body className={IS_SAMPLE ? "is-sample" : undefined}>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <div className="site-header__inner">
            <Link href="/" className="brand" aria-label={`${SITE.name}, home`}>
              <Wordmark />
              <span className="brand__name">{SITE.name}</span>
              <span className="brand__tagline">{SITE.tagline}</span>
            </Link>
            <ErrorBoundary label="search" fallback={<span />}>
              <SearchBox />
            </ErrorBoundary>
            <NavLinks />
            {IS_SAMPLE && (
              <span className="stamp" title="Every name, company, amount and link on this build is invented test data.">
                Sample data
              </span>
            )}
          </div>
          {IS_SAMPLE && (
            <p className="sample-band" role="note">
              <strong>Sample data.</strong> Every member, company, amount and record link on this build is invented for testing. Nothing here describes a real person.
            </p>
          )}
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          <div className="site-footer__inner">
            <p>
              <span className="mono">{SITE.name}</span> maps ties named in filed public records. {SITE.disclaimer}
            </p>
            <p className="site-footer__meta">
              <span>
                Data as of <span className="mono">{built ? date(built) : "unknown"}</span>
                {IS_SAMPLE ? " (sample)" : ""}
              </span>
              <Link href="/method">Sources and method</Link>
              <span>Not investment advice</span>
              <span>No commercial use or solicitation (5 U.S.C. 13107(c))</span>
              <a href={`mailto:${SITE.correctionsEmail}`}>Corrections</a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
