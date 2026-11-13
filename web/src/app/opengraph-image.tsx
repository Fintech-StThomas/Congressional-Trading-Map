import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const alt = `${SITE.name}: ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#1d1916", padding: "64px 72px", color: "#efe9df", fontFamily: "sans-serif" }}>
        <svg width="1056" height="250" viewBox="0 0 1056 250">
          <path d="M60 60 Q330 260 600 90 Q800 -10 1000 120" fill="none" stroke="#4d1913" strokeWidth="14" strokeLinecap="round" transform="translate(2 5)" />
          <path d="M60 60 Q330 260 600 90 Q800 -10 1000 120" fill="none" stroke="#dd4535" strokeWidth="10" strokeLinecap="round" />
          <circle cx="60" cy="60" r="18" fill="#3e3a36" />
          <circle cx="600" cy="90" r="18" fill="#3e3a36" />
          <circle cx="1000" cy="120" r="18" fill="#3e3a36" />
          <circle cx="55" cy="55" r="5" fill="#d8d2c8" />
          <circle cx="595" cy="85" r="5" fill="#d8d2c8" />
          <circle cx="995" cy="115" r="5" fill="#d8d2c8" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -3 }}>{SITE.name}</div>
          <div style={{ fontSize: 40, color: "#c7bfb3", marginTop: 8 }}>{SITE.tagline}</div>
          <div style={{ fontSize: 26, color: "#9d958a", marginTop: 26 }}>Every member of Congress, every tie in the filed record, every record one click away.</div>
        </div>
      </div>
    ),
    size,
  );
}
