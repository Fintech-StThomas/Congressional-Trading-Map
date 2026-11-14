// /wall: renders the current members from wall.json; WallView loads former members and years on demand.
import type { Metadata } from "next";
import { readData } from "@/lib/data/server";
import { decodeWall } from "@/lib/domain/party";
import { WallView } from "@/components/wall/WallView";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { count } from "@/lib/format";

export const metadata: Metadata = {
  title: "The wall",
  description: "Every member of Congress on one wall, now or in any year since 2000, in three party sections, with a marker for cases, trades, PAC money or outside spending against them.",
};

// Built once from wall.json: the current members are rendered into the page;
// former members are fetched from the same file only when asked for.
export default function WallPage() {
  const rows = decodeWall(readData<{ cols: string[]; rows: unknown[][] } | null>("wall.json", null));
  const current = rows.filter((r) => r.current);
  return (
    <div className="page wallpage">
      <h1>The wall</h1>
      <p className="lede">
        {current.length
          ? `All ${count(current.length)} current members by party, or everyone who served in a year you choose. Each print carries a marker for one measure. Open a print to see that member on the board.`
          : "The wall index is not in this build."}
      </p>
      {current.length > 0 && (
        <ErrorBoundary label="wall">
          <WallView current={current} />
        </ErrorBoundary>
      )}
    </div>
  );
}
