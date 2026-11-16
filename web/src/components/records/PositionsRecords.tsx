"use client";
// Full transition ledger loaded on demand, with the shared sortable table and CSV export.
import { useMemo, useState } from "react";
import { getJSON } from "@/lib/data/fetch";
import { dataUrl } from "@/lib/urls";
import { decodePositions, transitionRows, TRANSITION_COLS, type PositionsFile } from "@/lib/domain/positions";
import { HOLDINGS_NOT_SHOWN, POSITION_STATUS_NOTE } from "@/lib/copy";
import { DataTable } from "./DataTable";

export function PositionsRecords({ id, available }: { id: string; available: boolean }) {
  const [file, setFile] = useState<PositionsFile | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const rows = useMemo(() => file ? transitionRows(file, decodePositions(file)) : [], [file]);
  async function load() {
    setState("loading");
    try { setFile(await getJSON<PositionsFile>(dataUrl(`holdings/positions/${id}.json`))); setState("idle"); }
    catch { setState("error"); }
  }
  return <section id="rec-positions" className="rec__sec" aria-labelledby="rec-positions-h">
    <h2 id="rec-positions-h">Every position transition</h2>
    <p className="rec__note">{POSITION_STATUS_NOTE} {HOLDINGS_NOT_SHOWN.positions}</p>
    {!available ? <p>Position transitions are not available in this data build.</p> : file ? <DataTable id="positions" title="Position transitions" cols={TRANSITION_COLS} rows={rows} file={`${id}-position-transitions`} /> : <>
      <button className="btn btn--paper" disabled={state === "loading"} onClick={load}>{state === "loading" ? "Loading transitions…" : state === "error" ? "Retry loading transitions" : "Load every position transition"}</button>
      {state === "error" && <p role="alert">The positions file failed to load.</p>}
    </>}
  </section>;
}
