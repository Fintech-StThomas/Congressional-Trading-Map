// Input validation for URL ids (lib/data/ids.ts), the next.config rewrite patterns built from it, the single-flight
// for data reads (lib/data/flight.ts), the security headers (lib/security-headers.ts) and safeHttpUrl. No server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMemberId, isOrgId, isStateCode, MEMBER_ID_PATTERN, ORG_PATTERN, STATE_CODES, STATE_PATTERN } from "../src/lib/data/ids.ts";
import { singleFlight } from "../src/lib/data/flight.ts";
import { contentSecurityPolicy, securityHeaders } from "../src/lib/security-headers.ts";
import { safeHttpUrl } from "../src/lib/urls.ts";
import { STATE_NAMES } from "../src/lib/format.ts";

/** A rewrite parameter pattern as path-to-regexp anchors it for one path segment. */
const whole = (pattern) => new RegExp(`^(?:${pattern})$`);

test("member ids: bioguide shape only", () => {
  for (const ok of ["K000389", "X000001", "A123456"]) assert.ok(isMemberId(ok), ok);
  for (const bad of ["", "k000389", "K00038", "K0003890", "KK00389", "K000389 ", "../meta", "<script>", "K000389/x", "a".repeat(2000), null, 7])
    assert.ok(!isMemberId(bad), String(bad));
  const re = whole(MEMBER_ID_PATTERN);
  assert.ok(re.test("K000389") && !re.test("zzjunk25276") && !re.test("K000389%00"));
});

test("state codes: the known list, which covers every state name", () => {
  assert.deepEqual([...STATE_CODES].sort(), Object.keys(STATE_NAMES).sort());
  assert.ok(isStateCode("TX") && isStateCode("PR") && isStateCode("DC"));
  for (const bad of ["ZZ", "tx", "T", "TXX", "", "__proto__", "constructor"]) assert.ok(!isStateCode(bad), bad);
  const re = whole(STATE_PATTERN);
  assert.ok(re.test("MN") && !re.test("ZZ") && !re.test("MNX"));
});

test("org ids: the documented formats, length-capped", () => {
  for (const ok of ["co:320193", "tk:BRK.B", "tk:^GSPC", "pac:C00104299", "cmte:SSBK", "cmte:HSAG15", "lda:client-12345", "lda:registrant-9", "lda:lobbyist-77"])
    assert.ok(isOrgId(ok), ok);
  for (const bad of ["co:0123", "co:", "pac:C123", "pac:X00104299", "tk:", "tk:" + "A".repeat(25), "lda:x-1", "org:1", "co:1/../x", "co:1 "])
    assert.ok(!isOrgId(bad), bad);
  const re = whole(ORG_PATTERN);
  for (const ok of ["co%3A320193", "co:320193", "tk%3ABRK.B", "tk%3A%5EGSPC", "pac%3AC00104299"]) assert.ok(re.test(ok), ok);
  for (const bad of ["junk", "co%3A" + "1".repeat(41), "xx%3A1", "co"]) assert.ok(!re.test(bad), bad);
});

test("singleFlight: concurrent callers share one call; the key is released after it settles", async () => {
  let calls = 0;
  const slow = () => new Promise((r) => setTimeout(() => r(++calls), 10));
  const got = await Promise.all(Array.from({ length: 50 }, () => singleFlight("k", slow)));
  assert.equal(calls, 1);
  assert.ok(got.every((v) => v === 1));
  assert.equal(await singleFlight("k", slow), 2); // not held after settling
  await assert.rejects(singleFlight("e", () => Promise.reject(new Error("boom"))), /boom/);
  assert.equal(await singleFlight("e", async () => "ok"), "ok"); // a failure is not cached either
});

test("CSP: self only, inline allowed for RSC, no framing; dev-only allowances stay out of production", () => {
  const prod = contentSecurityPolicy({ NODE_ENV: "production", VERCEL: "1" });
  for (const d of ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "upgrade-insecure-requests"])
    assert.ok(prod.split("; ").some((x) => x === d || x.startsWith(d)), d);
  assert.doesNotMatch(prod, /unsafe-eval|va\.vercel-scripts\.com|vercel\.live|ws:/);
  const local = contentSecurityPolicy({ NODE_ENV: "production" });
  assert.doesNotMatch(local, /upgrade-insecure-requests/); // http://localhost must not be upgraded
  const dev = contentSecurityPolicy({ NODE_ENV: "development" });
  assert.match(dev, /'unsafe-eval'/);
  assert.match(dev, /script-src [^;]*https:\/\/va\.vercel-scripts\.com/);
  assert.match(contentSecurityPolicy({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview" }), /frame-src 'self' https:\/\/vercel\.live/);
});

test("security header set", () => {
  const h = Object.fromEntries(securityHeaders({ NODE_ENV: "production" }).map((x) => [x.key, x.value]));
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.equal(h["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(h["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(h["Cross-Origin-Resource-Policy"], "same-origin");
  for (const f of ["camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()"]) assert.ok(h["Permissions-Policy"].includes(f), f);
});

test("safeHttpUrl: only http(s) links from data", () => {
  assert.equal(safeHttpUrl("https://bioguide.congress.gov/x"), "https://bioguide.congress.gov/x");
  for (const bad of ["javascript:alert(1)", " JAVASCRIPT:alert(1)", "data:text/html,x", "//evil.example", "", null, undefined, 3])
    assert.equal(safeHttpUrl(bad), null, String(bad));
});
