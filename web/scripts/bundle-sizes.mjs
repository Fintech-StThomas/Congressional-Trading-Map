#!/usr/bin/env node
// First-load JavaScript per route: the script chunks each page's HTML references, raw and gzipped.
// Usage (server running): node scripts/bundle-sizes.mjs [baseUrl]
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const base = process.argv[2] ?? "http://localhost:3100";
const ROUTES = ["/", "/wall", "/m/K000389", "/m/K000389/records", "/o/co%3A732717", "/orgs", "/cases", "/method"];
const root = new URL("../.next/", import.meta.url).pathname;

for (const route of ROUTES) {
  const html = await (await fetch(base + route)).text();
  const chunks = [...new Set([...html.matchAll(/\/_next\/(static\/[^"'\s]+?\.js)/g)].map((m) => m[1]))];
  let raw = 0, gz = 0;
  for (const c of chunks) {
    const buf = readFileSync(root + decodeURIComponent(c));
    raw += buf.length;
    gz += gzipSync(buf).length;
  }
  console.log(`${route.padEnd(22)} ${String(chunks.length).padStart(2)} chunks  ${(raw / 1024).toFixed(0).padStart(5)} KB raw  ${(gz / 1024).toFixed(0).padStart(4)} KB gzip`);
}
