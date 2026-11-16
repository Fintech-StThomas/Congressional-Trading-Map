// The browser security headers sent on every response (next.config.ts headers()); see docs/SECURITY-REVIEW.md 1.1.
// Pure, so tests load it with node --test and next.config.ts imports it.
//
// Why 'unsafe-inline' for scripts: Next streams the RSC payload in inline <script> tags. A nonce would force every
// page to render per request (no ISR or static caching, which this site depends on), and hashes cannot work
// because the inline scripts differ per page. Nothing from a reader is reflected and React escapes all data, so
// the CSP's job here is to block third-party scripts, plugins, framing, <base> hijacking and exfiltration.

type Env = Record<string, string | undefined>;

/** The Content-Security-Policy value for this build. */
export function contentSecurityPolicy(env: Env): string {
  const dev = env.NODE_ENV !== "production";
  // Vercel's toolbar (comments, preview feedback) on preview deployments only.
  const toolbar = env.VERCEL_ENV === "preview" ? " https://vercel.live" : "";
  // Vercel Web Analytics is same-origin (/_vercel/insights/*) in production; its debug script in development
  // comes from va.vercel-scripts.com.
  const analyticsDev = dev ? " https://va.vercel-scripts.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}${analyticsDev}${toolbar}`, // eval: dev HMR only
    `style-src 'self' 'unsafe-inline'${toolbar}`, // style={} attributes, next/font's @font-face
    `img-src 'self' data: blob:${toolbar}`,
    `font-src 'self'${toolbar}`,
    `connect-src 'self'${dev ? " ws: wss:" : ""}${analyticsDev}${toolbar}`, // all data is same-origin (/data, /board-data, /search-index)
    `frame-src 'self'${toolbar}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only on Vercel (HTTPS); a local `next start` on http://localhost must not be upgraded.
    ...(env.VERCEL ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Every security header, as next.config.ts headers() entries. */
export function securityHeaders(env: Env): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" }, // older browsers; frame-ancestors for the rest
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];
}
