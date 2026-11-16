"use client";
// "Newer data has been published. Reload to see it." for pages left open. At most one check every 30 minutes, only
// while the tab is visible, at most 12 checks, never on a permalink (/r/<release>/..., which never changes by design).
// It compares the build (or, in pinned mode, the release id) the page loaded with what the server publishes now, and
// never reloads the page itself. Rules are in lib/data/latest.ts; wording in lib/copy.ts (FRESH).
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FRESH } from "@/lib/copy";
import { isReleasePath } from "@/lib/data/release";
import { decidePoll, newerDataPublished } from "@/lib/data/latest";
import { dataUrl } from "@/lib/urls";
import { Notice } from "./Notice";

const get = (url: string) => fetch(url, { cache: "no-store" });

/** `built` and `release` are what the server rendered this page from (`release` is null outside pinned mode). */
export function NewerDataNote({ built, release }: { built: string | null; release: string | null }) {
  const onPermalink = isReleasePath(usePathname());
  const [newer, setNewer] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (onPermalink) return;
    const baseline = { release, built };
    const state = { lastCheck: Date.now(), checks: 0, busy: false };
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      const visible = document.visibilityState === "visible";
      const verdict = decidePoll({ now: Date.now(), lastCheck: state.lastCheck, checks: state.checks, visible });
      if (verdict === "stop") return stop();
      if (verdict !== "check" || state.busy) return;
      state.busy = true;
      state.lastCheck = Date.now();
      state.checks++;
      try {
        if (await newerDataPublished(baseline, dataUrl("meta.json"), get)) {
          setNewer(true);
          stop();
        }
      } catch {
        // A failed check is counted and ignored: the note is a courtesy, never an error.
      } finally {
        state.busy = false;
      }
    };
    const start = () => {
      if (!timer) timer = setInterval(() => void tick(), 60_000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        start();
        void tick();
      } else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [onPermalink, built, release]);

  return (
    <div aria-live="polite" className="newer-slot no-print">
      {newer && !dismissed && (
        <Notice tone="info" band className="newer-note" data-testid="newer-data-note">
          <p>{FRESH.newer}</p>
          <button type="button" className="newer-note__x" onClick={() => setDismissed(true)} aria-label={FRESH.newerDismiss}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </Notice>
      )}
    </div>
  );
}
