"use client";
// "Follow" on member and organisation pages: adds the id to the watchlist kept in this browser (components/watch/store.ts),
// shows the followed state and, once followed, offers the personal feed link and the list. Nothing is uploaded.
import Link from "next/link";
import { useState } from "react";
import { WATCH } from "@/lib/copy-discovery";
import { follow, isFollowing, unfollow, watchlistFeedHref, type Kind } from "@/lib/domain/watchlist";
import { watchHref } from "@/lib/urls";
import { currentWatchlist, setWatchlist, useWatchlist } from "@/components/watch/store";

export function FollowButton({ kind, id, name }: { kind: Kind; id: string; name: string }) {
  const { ready, list, memory } = useWatchlist();
  const [limit, setLimit] = useState(false);
  const on = ready && isFollowing(list, kind, id);
  const feed = on ? watchlistFeedHref(list) : null;

  function toggle() {
    const now = currentWatchlist();
    if (isFollowing(now, kind, id)) {
      setWatchlist(unfollow(now, kind, id));
      setLimit(false);
      return;
    }
    const r = follow(now, kind, id);
    if (r.ok) {
      setWatchlist(r.list);
      setLimit(false);
    } else setLimit(r.reason === "limit");
  }

  return (
    <span className="follow no-print" data-testid="follow">
      <button type="button" className="btn btn--small" aria-pressed={on} aria-label={on ? WATCH.unfollowLabel(name) : WATCH.followLabel(name)} onClick={toggle} data-testid="follow-button">
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M8 2.5a3.5 3.5 0 00-3.5 3.5v2.2L3 11h10l-1.5-2.8V6A3.5 3.5 0 008 2.5zM6.6 12.5a1.5 1.5 0 002.8 0" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        {on ? `${WATCH.following} ✓` : WATCH.follow}
      </button>
      {feed && (
        <>
          {" "}
          <Link className="btn btn--small" href={feed} prefetch={false} data-testid="follow-feed">{WATCH.feedLink}</Link>{" "}
          <Link className="btn btn--small" href={watchHref()} data-testid="follow-manage">{WATCH.manage}</Link>
        </>
      )}
      {limit && <span className="saved-warn" role="status">{kind === "member" ? WATCH.limitMembers : WATCH.limitOrgs}</span>}
      {memory && <span className="saved-warn" role="status" data-testid="follow-memory">{WATCH.memoryNotice}</span>}
    </span>
  );
}
