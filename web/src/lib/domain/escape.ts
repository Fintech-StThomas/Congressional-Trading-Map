// Text safety for documents built as strings (RSS feeds, the embed card, the research export): filings are untrusted
// text, so every data string is stripped of control characters and escaped before it is placed in XML or HTML.
// Pure; tests/feed.test.mjs and tests/embed.test.mjs load it directly.

// C0 controls except tab, line feed and carriage return; DEL and C1 controls; the noncharacters XML forbids; lone surrogates.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** A string from the data with control characters removed; anything that is not a string becomes "". */
export function stripControl(s: unknown): string {
  return typeof s === "string" ? s.replace(CONTROL, "") : "";
}

/** One line of data text: control characters removed, runs of whitespace (including line breaks) collapsed, trimmed. */
export function oneLine(s: unknown): string {
  return stripControl(s).replace(/\s+/g, " ").trim();
}

/** Escape for XML or HTML text and attribute values (the same five characters serve both). */
export function escapeXml(s: unknown): string {
  return stripControl(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
