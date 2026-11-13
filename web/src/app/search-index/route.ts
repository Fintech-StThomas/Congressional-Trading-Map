// A compact name index for search and labels, built once at build time so
// the browser never downloads orgs.json whole.
import { getMembers, getOrgs } from "@/lib/data";

export const dynamic = "force-static";

const MAX_ORGS = 6000;

export function GET() {
  const m = getMembers().map((x) => [x.id, x.name, x.last, x.party, x.state, x.chamber, x.district, x.current ? 1 : 0, x.photo ? 1 : 0, x.counts?.cases ?? 0]);
  const o = getOrgs()
    .slice()
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))
    .slice(0, MAX_ORGS)
    .map((x) => [x.id, x.name, x.kind, x.degree, x.ticker]);
  return Response.json({ m, o });
}
