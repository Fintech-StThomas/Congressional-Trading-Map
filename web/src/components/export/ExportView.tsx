"use client";
// /export: pick a member and the kinds of record, fetch the published files in the browser, hash their bytes (SHA-256)
// and download one JSON bundle (lib/domain/export.ts). Nothing is uploaded; the files come from the same data tree
// the pages read, pinned to the page's release.
import { useState } from "react";
import { EXPORT } from "@/lib/copy";
import { dataUrl } from "@/lib/urls";
import { EXPORT_KINDS, buildExport, exportFilename, exportJson, kindPath, sha256Hex, type ExportKind, type FetchedFile } from "@/lib/domain/export";
import type { SourceRef } from "@/lib/domain/citation";
import { download } from "@/components/shared/download";
import { MemberPicker, type PickedMember } from "./MemberPicker";
import "@/styles/export.css";

type Props = { release: string | null; built: string | null; sources: SourceRef[] };

/** One file's bytes, hashed, parsed from those same bytes; null json when the file is not published (404). */
async function fetchFile(kind: ExportKind, memberId: string): Promise<FetchedFile> {
  const res = await fetch(dataUrl(kindPath(kind, memberId)));
  if (res.status === 404) return { kind, json: null, sha256: null, bytes: null };
  if (!res.ok) throw new Error(`${res.status}`);
  const buf = await res.arrayBuffer();
  return { kind, json: JSON.parse(new TextDecoder().decode(buf)), sha256: await sha256Hex(buf), bytes: buf.byteLength };
}

export function ExportView({ release, built, sources }: Props) {
  const [member, setMember] = useState<PickedMember | null>(null);
  const [kinds, setKinds] = useState<ExportKind[]>(["ties", "trades"]);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  const toggle = (k: ExportKind) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const ready = member !== null && kinds.length > 0;

  async function run() {
    if (!member || !kinds.length) return;
    setState("busy");
    try {
      const files = await Promise.all(kinds.map((k) => fetchFile(k, member.id)));
      const bundle = buildExport({ member, kinds, files, release, built, sources, exportedAt: new Date().toISOString() });
      download(exportFilename(bundle), exportJson(bundle), "application/json");
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="page page--read">
      <h1>{EXPORT.title}</h1>
      <p className="lede">{EXPORT.lede}</p>

      <MemberPicker value={member} onChange={(m) => { setMember(m); setState("idle"); }} />

      <fieldset className="export__field">
        <legend>{EXPORT.kindsLabel}</legend>
        {EXPORT_KINDS.map((k) => (
          <label key={k} className="export__kind">
            <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(k)} /> {EXPORT.kinds[k]}
          </label>
        ))}
      </fieldset>

      <p>
        <button type="button" className="btn" disabled={!ready || state === "busy"} onClick={run}>
          {state === "busy" ? EXPORT.building : EXPORT.download}
        </button>
      </p>
      <p role="status" aria-live="polite">
        {state === "error" ? EXPORT.failed : state === "done" ? EXPORT.done : !ready ? EXPORT.none : ""}
      </p>
      <p>{EXPORT.rowsUnmodified}</p>
      <p>{EXPORT.hashNote}</p>
      {!release && <p>{EXPORT.noRelease}</p>}
    </div>
  );
}
