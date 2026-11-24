// Unit tests for the organisation and disclosure-timing citations (permanent link only from an archived release), the
// organisation ties CSV, the permalink URLs and the /changes picker's bounded option list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDelaysCitation, buildOrgCitation } from "../src/lib/domain/citation-page.ts";
import { citationFilename, citationText } from "../src/lib/domain/citation.ts";
import { orgTiesCsv } from "../src/lib/domain/orgcsv.ts";
import { releaseDelaysHref, releaseOrgHref } from "../src/lib/urls.ts";
import { findListedRelease, pickerEntries } from "../src/lib/domain/releaseOptions.ts";
import { RELEASE_PICKER_CAP } from "../src/lib/copy-permalink.ts";

const REL = "ab".repeat(32);
const env = (release) => ({ release, built: "2026-11-13T04:00:00Z", retrieved: "2026-11-16T10:00:00.000Z", sources: [{ id: "ptr", name: "House periodic transaction reports" }] });
const org = { id: "co:320193", name: "Apple Inc." };

test("an organisation citation offers the permanent page only from an archived release", () => {
  const c = buildOrgCitation({ org, env: env(REL), dates: { first: null, last: null }, counts: { members_tied: 12 } });
  assert.equal(c.kind, "org");
  assert.match(c.links.permanent, new RegExp(`/r/${REL}/o/co%3A320193$`));
  assert.match(c.links.latest, /\/o\/co%3A320193$/);
  assert.equal(c.permanence_note, null);
  const none = buildOrgCitation({ org, env: env(null), dates: { first: null, last: null }, counts: {} });
  assert.equal(none.links.permanent, null);
  assert.ok(none.permanence_note);
  assert.match(citationText(none), /No permanent link/);
  assert.equal(citationFilename(c), "paper-trail-citation-co-320193.json");
});

test("a malformed release is never turned into a permanent link", () => {
  assert.equal(buildDelaysCitation({ env: env("not-a-release"), counts: {} }).links.permanent, null);
});

test("an organisation citation records the member search and rows in view", () => {
  const c = buildOrgCitation({ org, env: env(REL), dates: { first: null, last: null }, counts: {}, view: { query: "smith", shown: 2, total: 40 } });
  assert.deepEqual(c.filters.table, [{ column: "Member", value: "smith" }]);
  assert.deepEqual([c.filters.rows_shown, c.filters.rows_total], [2, 40]);
  const all = buildOrgCitation({ org, env: env(REL), dates: { first: null, last: null }, counts: {}, view: { query: " ", shown: 40, total: 40 } });
  assert.equal(all.filters.rows_total, null);
});

test("a delays citation names the permanent timing page", () => {
  const c = buildDelaysCitation({ env: env(REL), counts: { published_trades: 5, members: 2 } });
  assert.equal(c.kind, "delays");
  assert.equal(c.links.permanent.endsWith(`/r/${REL}/delays`), true);
  assert.equal(c.links.latest.endsWith("/delays"), true);
  assert.equal(citationFilename(c), "paper-trail-citation-delays.json");
  assert.equal(buildDelaysCitation({ env: env(null), counts: {} }).links.permanent, null);
});

test("permalink urls", () => {
  assert.equal(releaseOrgHref(REL, "co:320193"), `/r/${REL}/o/co%3A320193`);
  assert.equal(releaseDelaysHref(REL), `/r/${REL}/delays`);
});

test("the ties CSV keeps missing amounts empty and neutralises formulas", () => {
  const edge = { id: "aaaaaaaaaaaa", type: "traded", amount: { low: 1001, high: 15000, exact: null }, count: 3, first: "2021-01-02", last: "" };
  const csv = orgTiesCsv([{ edge, member: { id: "M000001", name: "=Evil, Jo", party: "D", state: "CA" } }], "note");
  const [head, row] = csv.trim().split("\r\n");
  assert.match(head, /^member_id,member,party,state,tie,amount_low,amount_high,amount_exact,records,first,last,tie_id,note$/);
  assert.match(row, /^M000001,"'=Evil, Jo",D,CA,.+,1001,15000,,3,2021-01-02,,aaaaaaaaaaaa,note$/);
});

test("the /changes picker renders the newest 200 plus the selected releases", () => {
  const hex = (i) => i.toString(16).padStart(64, "0");
  const entries = Array.from({ length: 1000 }, (_, i) => ({ release_id: hex(i + 1), build_time: "2026-01-01T00:00:00Z", activated_at: "2026-01-01T00:00:00Z" }));
  const out = pickerEntries(entries, [hex(900), null, hex(5000)]);
  assert.equal(out.length, RELEASE_PICKER_CAP + 1);
  assert.equal(out[0].release_id, hex(1));
  assert.equal(out.at(-1).release_id, hex(900));
  assert.equal(pickerEntries(entries.slice(0, 10), [hex(3)]).length, 10);
});

test("a pasted release id is accepted only when it is 64 hex digits and in the list", () => {
  const id = "0f".repeat(32);
  const entries = [{ release_id: id, build_time: "x", activated_at: "x" }];
  assert.deepEqual(findListedRelease(entries, `  ${id.toUpperCase()} \n`), { status: "ok", id });
  assert.equal(findListedRelease(entries, "abc").status, "notId");
  assert.equal(findListedRelease(entries, "1".repeat(64)).status, "notListed");
  assert.equal(findListedRelease(entries, `${id}\u0000`).status, "notId");
});
