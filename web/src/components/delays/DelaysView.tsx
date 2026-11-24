// /delays: what is measured, a neutral caveat, the site-wide bands, chambers, years and the member table.
// All figures come from delays.json; when that file is absent (older data builds) the page says so and shows no numbers.
import "@/styles/delays.css";
import Link from "next/link";
import { DELAYS } from "@/lib/copy";
import { DELAYS_AMEND } from "@/lib/copy-amend";
import type { Data } from "@/lib/data/server";
import { metaBuilt, metaSources } from "@/lib/data/meta";
import { decodeDelayMembers, readDelays, viewRows } from "@/lib/domain/delays";
import { count } from "@/lib/format";
import { delaysHref } from "@/lib/urls";
import { PERMALINK } from "@/lib/copy-permalink";
import type { Delays } from "@/lib/types";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { ReleaseBanner } from "@/components/shared/ReleaseBanner";
import { CiteEnvProvider } from "@/components/shared/CiteEnv";
import { DelaysCite } from "./DelaysCite";
import "@/styles/cite.css";
import { BandSummary } from "./BandSummary";
import { GroupsTable } from "./GroupsTable";
import { MembersTable } from "./MembersTable";

function Caveat() {
  return (
    <aside className="dl-caveat" aria-labelledby="dl-caveat-h" data-testid="delays-caveat">
      <h2 id="dl-caveat-h">{DELAYS.caveatTitle}</h2>
      <ul>
        {DELAYS.caveat.map((c) => <li key={c}>{c}</li>)}
      </ul>
    </aside>
  );
}

function Definition({ d, newBuild = true }: { d: Delays["definition"] | undefined; newBuild?: boolean }) {
  const measured = typeof d?.measured === "string" && d.measured ? d.measured : DELAYS.fallbackMeasured;
  const caveats = Array.isArray(d?.caveats) && d.caveats.length ? d.caveats : [...DELAYS.fallbackCaveats];
  return (
    <section className="dl-sec" aria-labelledby="dl-def">
      <h2 id="dl-def">{DELAYS.measuredHeading}</h2>
      <p>
        Measured: {measured}.{d?.percentile ? ` Percentiles: ${d.percentile}.` : ""}
      </p>
      <ul className="dl-list">
        {caveats.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <p className="dl-sub">{newBuild ? DELAYS_AMEND.auditSummary : DELAYS_AMEND.auditSummaryOld}</p>
      <p><Link href="/method">{DELAYS.methodLink}</Link></p>
    </section>
  );
}

/** The page for one data reader: the latest release at /delays, or `pinned` (a permanent page, /r/<release>/delays) with its banner. */
export async function DelaysView({ data, pinned = false }: { data: Data; pinned?: boolean }) {
  const delays = readDelays(await data.readData<unknown>("delays.json", null));
  const meta = await data.getMeta();
  const built = metaBuilt(meta);
  const head = (
    <>
      <ReleasePin release={data.release} />
      {pinned && data.release && <ReleaseBanner release={data.release} built={built} latestHref={delaysHref()} body={PERMALINK.bannerBody} />}
      <h1>{DELAYS.title}</h1>
      <p className="lede">{DELAYS.lede}</p>
    </>
  );
  if (!delays) {
    return (
      <div className="page page--narrow delays">
        {head}
        <Caveat />
        <div className="dl-unavailable" role="status" data-testid="delays-unavailable">
          <h2>{DELAYS.unavailableTitle}</h2>
          <p>{DELAYS.unavailableBody}</p>
        </div>
        <Definition d={undefined} newBuild={false} />
      </div>
    );
  }
  const index = await data.getMemberIndex();
  const rows = viewRows(decodeDelayMembers(delays.members), (id) => {
    const m = index.get(id);
    return m && { name: m.name, party: m.party, state: m.state, chamber: m.chamber, current: m.current };
  });
  const chambers = [
    { key: "sen", label: "Senate", g: delays.by_chamber.sen },
    { key: "rep", label: "House", g: delays.by_chamber.rep },
  ];
  const years = Object.keys(delays.by_year)
    .filter((y) => y !== "none")
    .sort()
    .concat(Object.keys(delays.by_year).includes("none") ? ["none"] : [])
    .map((y) => ({ key: y, label: y === "none" ? "None (no transaction date)" : y, g: delays.by_year[y] }));

  const sources = metaSources(meta).map((x) => ({
    id: x.id, name: typeof x.name === "string" ? x.name : x.id, url: typeof x.url === "string" ? x.url : null,
    revision: x.revision ? String(x.revision) : null, retrieved: x.retrieved ? String(x.retrieved) : null,
  }));
  return (
    <CiteEnvProvider release={data.release} built={built} sources={sources}>
    <div className="page delays">
      {head}
      <div className="dl-cite"><DelaysCite counts={{ published_trades: delays.totals.count, members: rows.length }} /></div>
      <Caveat />
      <Definition d={delays.definition} newBuild={delays.totals.date_corrected !== undefined} />
      <BandSummary g={delays.totals} />
      <GroupsTable id="dl-chambers" heading={DELAYS.chamberHeading} note={DELAYS.chamberNote} first="Chamber" rows={chambers} />
      <GroupsTable id="dl-years" heading={DELAYS.yearHeading} note={DELAYS.yearNote} first="Year" rows={years} />
      <section className="dl-sec" aria-labelledby="dl-members">
        <h2 id="dl-members">{DELAYS.membersHeading}</h2>
        <p className="dl-sub">{DELAYS.membersNote}</p>
        <MembersTable rows={rows} />
      </section>
      <p className="dl-sub">{count(delays.totals.count)} published trades in this build.</p>
    </div>
    </CiteEnvProvider>
  );
}
