"use client";
// The "Embed" control on /embed: pick a member and a theme, see the card, copy the <iframe> snippet. The snippet and the
// address are built by lib/domain/embed.ts; nothing is sent anywhere.
import { useState } from "react";
import { EMBED } from "@/lib/copy";
import { embedPath, embedSnippet, type EmbedTheme } from "@/lib/domain/embed";
import { MemberPicker, type PickedMember } from "@/components/export/MemberPicker";
import "@/styles/export.css";

export function EmbedBuilder({ release }: { release: string | null }) {
  const [member, setMember] = useState<PickedMember | null>(null);
  const [theme, setTheme] = useState<EmbedTheme>("light");
  const [note, setNote] = useState("");
  const code = member ? embedSnippet({ id: member.id, name: member.name, release, theme }) : "";
  // The preview is same-origin, so it uses the page's own address rather than the live site's.
  const preview = member ? embedPath({ id: member.id, release, theme }) : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setNote(EMBED.copied);
    } catch {
      setNote(EMBED.copyFailed);
    }
  }

  return (
    <div>
      <MemberPicker value={member} onChange={(m) => { setMember(m); setNote(""); }} />
      <fieldset className="export__field">
        <legend>Theme</legend>
        {(["light", "dark"] as const).map((t) => (
          <label key={t} className="export__kind">
            <input type="radio" name="embed-theme" checked={theme === t} onChange={() => setTheme(t)} /> {t === "light" ? "Light" : "Dark"}
          </label>
        ))}
      </fieldset>
      {member && (
        <>
          <p>
            <button type="button" className="btn" onClick={copy}>{EMBED.copy}</button>
          </p>
          <pre className="embedhelp__code" tabIndex={0} aria-label="Embed code">{code}</pre>
          <p role="status" aria-live="polite">{note}</p>
          {preview && <iframe className="embedhelp__preview" title={EMBED.frameTitle(member.name)} src={preview} height={EMBED.height} loading="lazy" />}
        </>
      )}
    </div>
  );
}
