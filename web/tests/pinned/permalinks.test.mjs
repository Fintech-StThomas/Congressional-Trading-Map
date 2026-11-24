// Pinned mode end to end for the permanent organisation and disclosure-timing pages (/r/<release>/o/<id>, /r/<release>/delays).
// Opt-in like pinned.test.mjs (`npm run test:pinned` runs both, one after the other): a fake bucket of two releases built
// from fixtures/data (B differs from A only in one member's trade count in delays.json), a site built against it into its
// own dist dir, and Chromium. Checks: the banner and noindex, the release's own data and CSV, "Cite this" offering the
// permanent link, the latest page's Cite pointing at the permanent page, and 404s that never fall back to latest data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, normalize, sep } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const WEB = new URL("../..", import.meta.url).pathname;
const DIST = ".next-pinned-links";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const A = sha("permalink release A");
const B = sha("permalink release B");
const UNKNOWN = sha("permalink never published");
const ORG = "co:9000001";
const ORG_NAME = "Example Dynamics Inc";
const TSCONFIG = join(WEB, "tsconfig.json");
const tsconfigBefore = readFileSync(TSCONFIG, "utf8");
let tmp, bucket, bucketServer, siteServer, site, browser;
const bucketLog = [];

const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

function writeRelease(id, built) {
  const dir = join(bucket, "releases", id);
  cpSync(join(WEB, "fixtures", "data"), dir, { recursive: true });
  const swap = (rel, fn) => writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), "utf8")));
  swap("meta.json", (t) => JSON.stringify({ ...JSON.parse(t), built }));
  writeFileSync(join(dir, "wall-years.json"), JSON.stringify({ years: [2000, 2026] }));
  if (id === B) swap("delays.json", (t) => { const d = JSON.parse(t); d.members.rows[0][1] = 999; return JSON.stringify(d); });
  writeFileSync(join(dir, "release.json"), JSON.stringify({ schema_version: 1, release_id: id, files: {} }));
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "pt-links-"));
  bucket = join(tmp, "bucket");
  mkdirSync(join(bucket, "releases"), { recursive: true });
  writeRelease(A, "2026-03-09T06:00:00Z");
  writeRelease(B, "2026-03-01T06:00:00Z");
  const releases = [{ release_id: A, build_time: "2026-03-09T06:00:00Z", activated_at: "2026-03-09T07:00:00Z" }, { release_id: B, build_time: "2026-03-01T06:00:00Z", activated_at: "2026-03-01T07:00:00Z" }];
  writeFileSync(join(bucket, "releases", "index.json"), JSON.stringify({ schema_version: 1, releases }));
  writeFileSync(join(bucket, "releases", "current.json"), JSON.stringify({ schema_version: 1, release_id: A, manifest_sha256: sha("manifest A") }));
  bucketServer = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    bucketLog.push(path);
    const file = normalize(join(bucket, path));
    if (!file.startsWith(bucket + sep) || !existsSync(file) || !file.endsWith(".json")) return void res.writeHead(404).end("not found");
    res.writeHead(200, { "content-type": "application/json" }).end(readFileSync(file));
  });
  await new Promise((resolve) => bucketServer.listen(0, "127.0.0.1", resolve));
  const env = { ...process.env, RELEASE_BASE_URL: `http://127.0.0.1:${bucketServer.address().port}/releases`, PT_DIST_DIR: DIST, PT_REVALIDATE_SECONDS: "2", DATA_BASE_URL: "", NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" };
  delete env.CI;
  rmSync(join(WEB, DIST), { recursive: true, force: true });
  const build = await new Promise((resolve) => {
    const child = spawn("npx", ["next", "build"], { cwd: WEB, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (status) => resolve({ status, out }));
  });
  if (build.status !== 0) throw new Error(`pinned build failed:\n${build.out}`);
  const port = await freePort();
  site = `http://127.0.0.1:${port}`;
  siteServer = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: WEB, env, stdio: "ignore", detached: true });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${site}/method`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch(process.env.PT_CHROMIUM ? { executablePath: process.env.PT_CHROMIUM } : {});
});

after(async () => {
  await browser?.close();
  if (siteServer?.pid) try { process.kill(-siteServer.pid); } catch {}
  bucketServer?.close();
  rmSync(join(WEB, DIST), { recursive: true, force: true });
  writeFileSync(TSCONFIG, tsconfigBefore);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function csvOf(p, testId) {
  const dl = p.waitForEvent("download");
  await p.getByTestId(testId).click();
  const path = await (await dl).path();
  return readFileSync(path, "utf8");
}

test("an organisation permalink is built like the member one and cites itself", async () => {
  const p = await browser.newPage();
  const seen = [];
  p.on("request", (r) => { const u = new URL(r.url()); if (u.origin === site) seen.push(u.pathname); });
  const res = await p.goto(`${site}/r/${A}/o/${encodeURIComponent(ORG)}`);
  assert.equal(res.status(), 200);
  assert.match(await p.getByTestId("release-banner").innerText(), new RegExp(`Pinned to data release ${A.slice(0, 12)}`));
  assert.equal(await p.locator("meta[name=robots]").getAttribute("content"), "noindex");
  assert.match(await p.locator("link[rel=canonical]").getAttribute("href"), new RegExp(`/o/co%3A9000001$`));
  await p.getByTestId("org-page").waitFor();
  assert.ok((await p.locator("h1").first().innerText()).includes(ORG_NAME));
  assert.ok(seen.some((x) => x.startsWith(`/releases/${A}/orgs/`)), seen.join("\n"));
  assert.ok(!seen.some((x) => /^\/(data|sample-data)\//.test(x)), "no unpinned data request");

  await p.getByTestId("cite-org-button").click();
  const link = await p.getByTestId("cite-org-permanent").innerText();
  assert.ok(link.includes(`/r/${A}/o/co%3A9000001`), link);
  assert.match(await p.getByTestId("cite-org-text").inputValue(), /Permanent link \(fixed to this data release\)/);
  const csv = await csvOf(p, "org-csv");
  assert.match(csv.split("\r\n")[0], /^member_id,member,party,state,tie,/);
  assert.ok(csv.split("\r\n").length > 2, "has rows");
  await p.close();
});

test("the latest organisation page's Cite control links to the permanent page", async () => {
  const p = await browser.newPage();
  await p.goto(`${site}/o/${encodeURIComponent(ORG)}`);
  await p.getByTestId("org-page").waitFor();
  assert.equal(await p.getByTestId("release-banner").count(), 0);
  await p.getByTestId("cite-org-button").click();
  assert.ok((await p.getByTestId("cite-org-permanent").innerText()).includes(`/r/${A}/o/co%3A9000001`));
  await p.close();
});

test("a delays permalink is the release's own page: its CSV and its permanent link", async () => {
  const p = await browser.newPage();
  const resB = await p.goto(`${site}/r/${B}/delays`);
  assert.equal(resB.status(), 200);
  assert.match(await p.getByTestId("release-banner").innerText(), new RegExp(`Pinned to data release ${B.slice(0, 12)}`));
  assert.equal(await p.locator("meta[name=robots]").getAttribute("content"), "noindex");
  assert.match(await p.locator("link[rel=canonical]").getAttribute("href"), /\/delays$/);
  assert.match(await csvOf(p, "delays-csv"), /^X000001,.*?,.*?,.*?,.*?,999,/m);
  await p.getByTestId("cite-delays-button").click();
  assert.ok((await p.getByTestId("cite-delays-permanent").innerText()).includes(`/r/${B}/delays`));

  // The current release has its own numbers, and the latest page points at its permanent page.
  await p.goto(`${site}/r/${A}/delays`);
  assert.doesNotMatch(await csvOf(p, "delays-csv"), /^X000001,.*?,999,/m);
  await p.goto(`${site}/delays`);
  assert.equal(await p.getByTestId("release-banner").count(), 0);
  await p.getByTestId("cite-delays-button").click();
  assert.ok((await p.getByTestId("cite-delays-permanent").innerText()).includes(`/r/${A}/delays`));
  await p.close();
});

test("an unpublished release, an unknown organisation or a malformed id is a 404, never the latest data", async () => {
  const p = await browser.newPage();
  for (const path of [`${UNKNOWN}/delays`, `${UNKNOWN}/o/${encodeURIComponent(ORG)}`, `${A}/o/co%3A1`, `${A}/o/not-an-org`, `${A}/o/${"x".repeat(60)}`, "abc/delays"]) {
    const res = await p.goto(`${site}/r/${path}`);
    assert.equal(res.status(), 404, path);
    assert.equal(await p.getByTestId("release-not-found").count(), 1, path);
    assert.equal(await p.getByTestId("org-page").count(), 0, path);
  }
  assert.ok(!bucketLog.some((x) => x.includes(UNKNOWN)), "nothing was fetched for an unlisted release");
  await p.close();
});
