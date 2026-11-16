"use client";
// A board opened from a share link: read-only, not stored. The link carried only ids, so each record is looked up in
// the data now (in the item's own release when the site serves releases, else the current data). A record that cannot
// be found is listed as "not found in the current data", never dropped. "Save a copy" stores it in this browser.
import Link from "next/link";
import { useEffect, useState } from "react";
import { SAVED } from "@/lib/copy";
import { PARTY_NAMES, releaseShort } from "@/lib/format";
import { memberHref, orgHref, releaseMemberHref, savedHref } from "@/lib/urls";
import { addItem, createBoard, makeItem, type Item } from "@/lib/domain/saved";
import type { SharedBoard, SharedItem } from "@/lib/domain/saved-share";
import { apply, newId, nowIso } from "./store";
import { lookup, type Resolved } from "./resolve";

const LIMIT = 6;

export function SharedBoardView({ board, pinned }: { board: SharedBoard; pinned: boolean }) {
  const [found, setFound] = useState<Record<string, Resolved | undefined>>({});
  const [msg, setMsg] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    const queue = board.items.slice();
    async function worker() {
      for (let it = queue.shift(); it; it = queue.shift()) {
        const r = await lookup(it, { useItemRelease: true, pinned });
        if (live) setFound((f) => ({ ...f, [it.key]: r }));
      }
    }
    for (let n = 0; n < LIMIT; n++) void worker();
    return () => {
      live = false;
    };
  }, [board, pinned]);

  function saveCopy() {
    const now = nowIso();
    const items = board.items.map((s): Item | null => {
      const r = found[s.key];
      const ok = r && r.state === "found" ? r : null;
      return makeItem({
        kind: s.kind, member: s.member, org: s.org, edge: s.edge, release: s.release,
        label: ok?.label ?? `${SAVED.kind[s.kind]} ${s.edge ?? s.org ?? s.member}`, amount_text: ok?.amount_text ?? "", years: ok?.years ?? "", parties: ok?.parties,
      }, now);
    }).filter((i): i is Item => i !== null);
    const id = newId();
    const op = apply((st) => {
      const made = createBoard(st, board.title, { id, now });
      return items.reduce((acc, it) => (acc.ok ? addItem(acc.state, id, it, now) : acc), made);
    });
    setSaved(op.ok);
    setMsg(op.ok ? SAVED.shared.copySaved : op.reason === "limit" ? SAVED.save.boardsFull : SAVED.save.failed);
  }

  return (
    <section className="saved-shared" aria-labelledby="shared-h" data-testid="saved-shared">
      <p className="saved-banner" role="note" data-testid="saved-shared-banner">{SAVED.shared.banner}</p>
      <h2 id="shared-h">{board.title}</h2>
      <p className="saved-hint">{SAVED.shared.intro}</p>
      <div className="saved-export__row no-print">
        <button type="button" className="btn" onClick={saveCopy} disabled={saved} data-testid="saved-save-copy">{SAVED.shared.saveCopy}</button>
        <Link className="btn" href={savedHref()}>{SAVED.shared.openMine}</Link>
      </div>
      <p className="saved-msg" role="status" aria-live="polite">{msg}</p>
      <ol className="saved-items">
        {board.items.map((s) => <SharedCard key={s.key} item={s} r={found[s.key]} />)}
      </ol>
    </section>
  );
}

function SharedCard({ item, r }: { item: SharedItem; r: Resolved | undefined }) {
  const S = SAVED.shared;
  const ids = [item.member, item.org, item.edge && `tie ${item.edge}`].filter(Boolean).join(" · ");
  const ok = r && r.state === "found" ? r : null;
  return (
    <li className="saved-item" data-testid="saved-shared-item">
      <div className="saved-item__head">
        <span className="saved-item__kind">{SAVED.kind[item.kind]}</span>
        <h3 className="saved-item__label">{ok ? ok.label : r ? S.notFound : S.loading}</h3>
      </div>
      {ok ? (
        <dl className="saved-item__facts">
          {item.kind === "tie" && <div><dt>{SAVED.item.amountLabel}</dt><dd className="mono">{ok.amount_text}</dd></div>}
          <div><dt>{SAVED.item.yearsLabel}</dt><dd className="mono">{ok.years || SAVED.compare.notRecorded}</dd></div>
          {ok.parties.length > 0 && <div><dt>{SAVED.compare.rows.parties}</dt><dd>{ok.parties.map((p) => PARTY_NAMES[p]).join(", ")}</dd></div>}
          <div><dt>{SAVED.compare.rows.release}</dt><dd className="mono">{ok.from === "release" && item.release ? S.fromRelease(releaseShort(item.release)) : S.fromCurrent}</dd></div>
        </dl>
      ) : null}
      <p className="saved-item__ids mono">{ids}</p>
      <p className="saved-item__links">
        {item.member && <Link href={memberHref(item.member)}>{SAVED.item.openMember}</Link>}
        {item.org && <Link href={orgHref(item.org)}>{SAVED.item.openOrg}</Link>}
        {item.release && item.member && <Link href={releaseMemberHref(item.release, item.member)}>{SAVED.item.openPinned(releaseShort(item.release))}</Link>}
      </p>
    </li>
  );
}
