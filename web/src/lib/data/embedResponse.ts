// The member embed card as a complete HTML response (/embed/m/<id>, /embed/r/<release>/m/<id>), as a function of a `Data`
// reader so the static routes, their remote-mode live twins and the release permalink share one implementation. The
// markup is built by lib/domain/embed.ts; this reads the member's files and sets the embed headers.
import type { Data } from "./reader.ts";
import { metaBuilt } from "./meta.ts";
import { isMemberId } from "./ids.ts";
import { buildEmbedHtml, topTies, type EmbedTheme } from "../domain/embed.ts";
import { decodeTradeFile } from "./decode.ts";
import { embedHeaders } from "../security-headers.ts";

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function embedResponse(data: Data, id: string, theme: EmbedTheme): Promise<Response> {
  if (!isMemberId(id) || !(await data.isKnownMember(id))) return NOT_FOUND(); // shape and (remote) membership before any member file
  const [member, file, meta] = await Promise.all([data.getMemberIndex().then((m) => m.get(id)), data.getMemberFile(id), data.getMeta()]);
  if (!member) return NOT_FOUND();
  // Buys and sells apart for the trade ties: the card reads the member's trade rows (none when the member has no trade file).
  // A failed trade-file read drops the detail line; the card itself still renders.
  const trades = file && file.edges.some((e) => e.type === "traded") ? await data.getTradeFile(id).then((f) => decodeTradeFile(f), () => []) : [];
  const html = buildEmbedHtml({ member, ties: file ? topTies(file, id, undefined, trades) : [], release: data.release, built: metaBuilt(meta), theme });
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  for (const h of embedHeaders(process.env)) headers.set(h.key, h.value); // the same rules next.config.ts applies to /embed/*
  return new Response(html, { headers });
}
