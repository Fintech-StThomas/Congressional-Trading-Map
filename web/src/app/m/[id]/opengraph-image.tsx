// The share card of one member's case file: name, seat, counts as published, data build date and the site name.
// No claims and no ties drawn except the single red yarn mark the site uses for a tie. Local data: drawn at build time
// for every member. Remote modes: nothing is drawn at build time; the image is made on first request and kept (ISR), and
// the live twin app/live/m/[id]/opengraph-image.tsx serves the member page's twin. Ids are checked before any read.
import { ImageResponse } from "next/og";
import { SITE } from "@/lib/copy";
import { IS_REMOTE, latestData, metaBuilt } from "@/lib/data/server";
import { isMemberId } from "@/lib/data/ids";
import { count, date, PARTY_NAMES, seat } from "@/lib/format";
import { oneLine } from "@/lib/domain/escape";

export const alt = `${SITE.name}: a member of Congress and the records that tie them to organisations`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamicParams = true; // literal; in local mode ids outside the build answer 404 (below)
export const revalidate = 3600;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  return (await (await latestData()).getMembers()).map((m) => ({ id: m.id }));
}

const NOT_FOUND = () => new Response("Not found", { status: 404 });

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isMemberId(id)) return NOT_FOUND();
  let m, built: string | null;
  try {
    const data = await latestData();
    m = (await data.getMemberIndex()).get(id);
    built = metaBuilt(await data.getMeta());
  } catch {
    return NOT_FOUND(); // local mode at request time has no data files: only the ids prerendered at build exist
  }
  if (!m) return NOT_FOUND();
  const name = oneLine(m.name);
  const stats: [string, string][] = [
    ["Trades", count(m.counts?.trades ?? 0)],
    ["Organisations", count(m.counts?.orgs ?? 0)],
    ["Cases", count(m.counts?.cases ?? 0)],
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#1d1916", padding: "56px 72px", color: "#efe9df", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 30, color: "#c7bfb3" }}>{`${seat(m)} · ${PARTY_NAMES[m.party] ?? "Independent"} (${m.party})`}</div>
          <div style={{ fontSize: name.length > 28 ? 72 : 92, fontWeight: 700, letterSpacing: -2, marginTop: 14, lineHeight: 1.05 }}>{name}</div>
          <svg width="420" height="40" viewBox="0 0 420 40" style={{ marginTop: 26 }}>
            <path d="M12 20 Q110 40 210 18 Q310 -2 408 22" fill="none" stroke="#dd4535" strokeWidth="8" strokeLinecap="round" />
            <circle cx="12" cy="20" r="10" fill="#3e3a36" />
            <circle cx="408" cy="22" r="10" fill="#3e3a36" />
          </svg>
        </div>
        <div style={{ display: "flex", gap: 56 }}>
          {stats.map(([label, value]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 64, fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: 26, color: "#9d958a" }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#9d958a" }}>
          <div style={{ display: "flex" }}>{`${SITE.name} · filed records, as published`}</div>
          <div style={{ display: "flex" }}>{built ? `Data built ${date(built)}` : "Build date not recorded"}</div>
        </div>
      </div>
    ),
    size,
  );
}
