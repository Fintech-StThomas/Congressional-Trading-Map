"use client";
// On a saved board: "Follow everything on this board" (adds its members and organisations to the watchlist kept in this
// browser) and "Export as feed" (the combined feed address for exactly this board). Nothing is uploaded.
import Link from "next/link";
import { useState } from "react";
import { WATCH } from "@/lib/copy-discovery";
import { boardWatchlist, mergeWatchlists, watchlistFeedHref, watchSize, WATCH_MEMBERS_MAX, WATCH_ORGS_MAX, type Watchlist } from "@/lib/domain/watchlist";
import { currentWatchlist, setWatchlist } from "@/components/watch/store";
import { watchHref } from "@/lib/urls";
import type { Board } from "@/lib/domain/saved";

const over = (l: Watchlist) => l.members.length > WATCH_MEMBERS_MAX || l.orgs.length > WATCH_ORGS_MAX;

export function BoardFollow({ board }: { board: Board }) {
  const [msg, setMsg] = useState("");
  const ids = boardWatchlist(board);
  const feed = watchlistFeedHref(ids);
  if (watchSize(ids) === 0) return null;

  function followAll() {
    const r = mergeWatchlists(currentWatchlist(), ids);
    if (r.added > 0) setWatchlist(r.list);
    setMsg(r.added === 0 && r.skipped === 0 ? WATCH.fromBoard.nothing : WATCH.fromBoard.followed(r.added, r.skipped));
  }

  return (
    <div className="saved-follow" data-testid="board-follow">
      <p className="saved-hint">{WATCH.fromBoard.hint}</p>
      <button type="button" className="btn btn--small" onClick={followAll} data-testid="board-follow-all">{WATCH.fromBoard.follow}</button>{" "}
      {feed && <Link className="btn btn--small" href={feed} prefetch={false} data-testid="board-export-feed">{WATCH.fromBoard.exportFeed}</Link>}{" "}
      <Link className="btn btn--small" href={watchHref()}>{WATCH.manage}</Link>
      {over(ids) && <p className="saved-warn">{WATCH.fromBoard.overLimit}</p>}
      {msg && <p className="saved-hint" role="status" data-testid="board-follow-msg">{msg}</p>}
    </div>
  );
}
