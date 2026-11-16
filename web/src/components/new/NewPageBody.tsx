// The body of /new for the latest data (server): reads the build date and the bounded set of recent trades (the same
// reader as the site feed), builds the rows for the 7 days to the build date and hands them to the client view.
// Shared by app/new/page.tsx (local mode, prerendered) and its remote-mode live twin (ISR).
import { latestData, metaBuilt } from "@/lib/data/server";
import { readRecentActivityTrades } from "@/lib/data/recentTrades";
import { SITE_MEMBER_FILES } from "@/lib/domain/feed";
import { weekRows, weekWindow } from "@/lib/domain/newweek";
import { date } from "@/lib/format";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { NewView } from "./NewView";

export async function NewPageBody() {
  const data = await latestData();
  const built = metaBuilt(await data.getMeta());
  const w = weekWindow(built);
  const rows = w ? weekRows(await readRecentActivityTrades(data, SITE_MEMBER_FILES), w) : [];
  return (
    <>
      <ReleasePin release={data.release} />
      <NewView rows={rows} windowEnd={w ? date(w.to) : null} windowStart={w ? date(w.from) : null} files={SITE_MEMBER_FILES} />
    </>
  );
}
