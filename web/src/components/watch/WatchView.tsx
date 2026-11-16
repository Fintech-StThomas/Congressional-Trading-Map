"use client";
// The /watch page body (client): what this browser follows, with names from the search index, remove buttons, the
// personal feed link with a copy button, and plain instructions. The list lives only in this browser's storage.
import "@/styles/saved.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { WATCH } from "@/lib/copy-discovery";
import { loadSearchIndex, type SearchIndex } from "@/lib/data/fetch";
import { absoluteFeedUrl, unfollow, watchlistFeedHref, WATCH_MEMBERS_MAX, WATCH_ORGS_MAX, type Kind } from "@/lib/domain/watchlist";
import { memberHref, orgHref } from "@/lib/urls";
import { setWatchlist, useWatchlist } from "./store";

export function WatchView() {
  const { ready, list, status, memory } = useWatchlist();
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [origin, setOrigin] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    loadSearchIndex().then(setIndex).catch(() => setIndex(null));
  }, []);

  const names = {
    member: new Map((index?.members ?? []).map((m) => [m.id, m.name])),
    org: new Map((index?.orgs ?? []).map((o) => [o.id, o.name])),
  };
  const href = watchlistFeedHref(list);
  const url = href && origin ? absoluteFeedUrl(origin, href) : "";
  const trimmed = list.members.length > WATCH_MEMBERS_MAX || list.orgs.length > WATCH_ORGS_MAX;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMsg(WATCH.copied);
    } catch {
      setMsg(WATCH.copyFailed);
    }
  }

  const section = (kind: Kind, heading: string, ids: string[], none: string) => (
    <section className="saved-board" aria-labelledby={`w-${kind}`}>
      <h2 id={`w-${kind}`}>{heading} <span className="mono">({ids.length})</span></h2>
      {ids.length === 0 ? (
        <p className="saved-empty">{none}</p>
      ) : (
        <ul className="saved-items" data-testid={`watch-${kind}s`}>
          {ids.map((id) => {
            const name = names[kind].get(id);
            return (
              <li key={id} className="saved-item" data-testid="watch-item">
                <Link href={kind === "member" ? memberHref(id) : orgHref(id)}>{name ?? id}</Link>
                {!name && index && <span className="nd"> ({WATCH.notInIndex})</span>}{" "}
                <button type="button" className="btn btn--small" aria-label={WATCH.removeLabel(name ?? id)} onClick={() => setWatchlist(unfollow(list, kind, id))} data-testid="watch-remove">{WATCH.remove}</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <div className="page page--narrow saved" data-testid="watch-page">
      <h1>{WATCH.title}</h1>
      <p className="lede">{WATCH.lede}</p>
      <aside className="saved-privacy no-print" aria-labelledby="watch-priv" data-testid="watch-privacy">
        <h2 id="watch-priv">{WATCH.privacyTitle}</h2>
        {WATCH.privacy.map((p) => <p key={p}>{p}</p>)}
      </aside>
      {memory && <p className="saved-warn" role="status" data-testid="watch-memory">{WATCH.memoryNotice}</p>}
      {status === "corrupt" && <p className="saved-warn" role="status">{WATCH.corruptNotice}</p>}
      {!ready ? (
        <p className="saved-hint" role="status">{WATCH.loading}</p>
      ) : (
        <>
          {section("member", WATCH.membersHeading, list.members, WATCH.noneMembers)}
          {section("org", WATCH.orgsHeading, list.orgs, WATCH.noneOrgs)}
          <section className="saved-board" aria-labelledby="w-feed">
            <h2 id="w-feed">{WATCH.feedHeading}</h2>
            {href ? (
              <>
                <p><input type="text" readOnly value={url} aria-label={WATCH.feedHeading} style={{ width: "100%" }} onFocus={(e) => e.currentTarget.select()} data-testid="watch-feed-url" /></p>
                <p>
                  <button type="button" className="btn btn--small" onClick={copy} data-testid="watch-copy">{WATCH.copy}</button>{" "}
                  <Link className="btn btn--small" href={href} prefetch={false}>{WATCH.open}</Link>
                </p>
                {msg && <p className="saved-hint" role="status">{msg}</p>}
                {trimmed && <p className="saved-warn">{WATCH.limits}</p>}
              </>
            ) : (
              <p className="saved-empty">{WATCH.feedEmpty}</p>
            )}
          </section>
          <section aria-labelledby="w-how">
            <h2 id="w-how">{WATCH.howHeading}</h2>
            {WATCH.how.map((p) => <p key={p}>{p}</p>)}
          </section>
        </>
      )}
    </div>
  );
}
