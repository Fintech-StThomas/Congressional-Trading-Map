"use client";
// The header row: brand, search, navigation. On phones (720px and narrower) the row stays one line, brand on the
// left with a search button and a menu button on the right; the search field replaces the row while it is open.
// Brand, search and the sample stamp are server-rendered by the layout and passed in. Styles: styles/globals.css, pages.css.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { NAV_UI } from "@/lib/copy-ui";
import { NavLinks } from "./NavLinks";

export function SiteHeader({ brand, search, stamp }: { brand: ReactNode; search: ReactNode; stamp?: ReactNode }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) box.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [open]);

  return (
    <div className={`site-header__inner${open ? " is-searching" : ""}`}>
      {brand}
      <div
        id={`${uid}-search`}
        ref={box}
        className="site-header__search"
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            setOpen(false);
            btn.current?.focus();
          }
        }}
      >
        {search}
        <button type="button" className="btn site-header__searchclose" aria-label={NAV_UI.searchCloseAria} onClick={() => { setOpen(false); btn.current?.focus(); }}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
        </button>
      </div>
      <button
        ref={btn}
        type="button"
        className="btn site-header__searchbtn"
        aria-expanded={open}
        aria-controls={`${uid}-search`}
        aria-label={NAV_UI.searchOpenAria}
        onClick={() => setOpen(true)}
        data-testid="search-toggle"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
      </button>
      <NavLinks />
      {stamp}
    </div>
  );
}
