"use client";
// The header's site navigation. Desktop: Board, New, Cases, Organisations and a "More" menu (Wall, Timing, Review flags, Saved,
// Following, Method, Data status); `aria-current` marks the current section, and the More button when the current page
// is inside it. Phones (720px and narrower): one "Menu" button that opens a panel with every link, in the same
// order. The panel closes on Escape, on a click outside and when a link is chosen. Wording is in lib/copy-ui.ts.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { NAV_UI } from "@/lib/copy-ui";
import { delaysHref, flagsHref, newHref, savedHref, statusHref, watchHref } from "@/lib/urls";
import { ActionMenu } from "./ActionMenu";

const MORE_HREF: Record<(typeof NAV_UI.more)[number]["key"], string> = {
  wall: "/wall",
  delays: delaysHref(),
  flags: flagsHref(),
  saved: savedHref(),
  watch: watchHref(),
  method: "/method",
  status: statusHref(),
};
const PRIMARY = NAV_UI.primary.map((l) => (l.href === "/new" ? { ...l, href: newHref() } : l));
const MORE = NAV_UI.more.map((l) => ({ href: MORE_HREF[l.key], label: l.label }));

const isOn = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

export function NavLinks() {
  const path = usePathname();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // A new page closes the phone panel (state adjusted while rendering, the documented alternative to an effect).
  const [seen, setSeen] = useState(path);
  if (seen !== path) {
    setSeen(path);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [open]);

  const link = (l: { href: string; label: string }, cls?: string) => (
    <Link key={l.href} href={l.href} className={cls} aria-current={isOn(path, l.href) ? "page" : undefined}>
      {l.label}
    </Link>
  );
  const insideMore = MORE.some((l) => isOn(path, l.href));

  return (
    <nav
      ref={root}
      className="nav"
      aria-label={NAV_UI.mainAria}
      data-open={open || undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        className="btn nav__toggle"
        aria-expanded={open}
        aria-controls={`${uid}-panel`}
        aria-label={open ? NAV_UI.menuCloseAria : NAV_UI.menuOpenAria}
        onClick={() => setOpen((o) => !o)}
        data-testid="nav-toggle"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          {open ? <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /> : <path d="M2 4.5h12M2 8h12M2 11.5h12" />}
        </svg>
        <span>{NAV_UI.menuLabel}</span>
      </button>
      <div id={`${uid}-panel`} className="nav__panel">
        {PRIMARY.map((l) => link(l, "nav__link"))}
        <ActionMenu
          className="nav__more"
          label={NAV_UI.moreLabel}
          ariaLabel={NAV_UI.moreAria}
          current={insideMore}
          testId="nav-more"
          items={MORE.map((l) => link(l, "menu__item"))}
        />
      </div>
    </nav>
  );
}
