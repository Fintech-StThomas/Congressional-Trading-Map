"use client";
// Rows of a full-file table that have no date under the chosen basis while a year window is on: counted here, apart
// from the years, and listed on request. They are never dropped and never placed in a year.
import { useState } from "react";
import { VIEW } from "@/lib/copy";
import type { Cell, Col } from "@/lib/domain/records";
import { DataTable } from "./DataTable";

export function UndatedBucket({ id, title, cols, rows, file }: { id: string; title: string; cols: Col[]; rows: Cell[][]; file: string }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <div className="rec__undated" data-testid={`rec-${id}-undated`}>
      <p className="view-undated">
        {VIEW.undatedRows(rows.length)}{" "}
        <button type="button" className="linkbtn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? VIEW.hideUndated : VIEW.showUndated(rows.length)}
        </button>
      </p>
      {open && <DataTable id={`${id}-undated`} title={`${title}: undated`} cols={cols} rows={rows} file={`${file}-undated`} />}
    </div>
  );
}
