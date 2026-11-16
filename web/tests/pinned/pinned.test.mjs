// End-to-end test of pinned mode (RELEASE_BASE_URL). Opt-in: `npm run test:pinned` (it builds the site, so it is
// not part of `npm test`, which only globs tests/*.test.mjs).
//
// It builds a fake bucket from fixtures/data in a temp dir: release A = the fixtures, release B = the fixtures with one
// member renamed, plus releases/current.json; serves it with a tiny static server (404 for missing files); builds the
// site against it into its own dist dir (PT_DIST_DIR, so the main .next is untouched); starts it; and drives Chromium.
// Needs the chromium Playwright expects (PT_CHROMIUM=<path to a chrome binary> to use another one).
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
const DIST = ".next-pinned";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const A = sha("test release A");
const B = sha("test release B");
const UNKNOWN = sha("never published");
const MEMBER = "X000001";
const NAME_A = "Ada Sampleworth";
const NAME_B = "Ada Revisedname";
const BUILT_A = "2026-03-01T06:00:00Z";
const BUILT_B = "2026-03-09T06:00:00Z";
const REVALIDATE = "2";

// next build adds the alternate dist dir to tsconfig.json's include; put the file back afterwards.
const TSCONFIG = join(WEB, "tsconfig.json");
const tsconfigBefore = readFileSync(TSCONFIG, "utf8");
let tmp, bucket, bucketServer, bucketBase, siteServer, site, browser;
const bucketLog = []; // every path the site's server (or browser) asked the bucket for

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function writeRelease(id, { name, built }) {
  const dir = join(bucket, "releases", id);
  cpSync(join(WEB, "fixtures", "data"), dir, { recursive: true });
  const swap = (rel, fn) => writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), "utf8")));
  swap("meta.json", (t) => JSON.stringify({ ...JSON.parse(t), built }));
  writeFileSync(join(dir, "wall-years.json"), JSON.stringify({ years: [2000, 2026] }));
  for (const rel of ["members.json", `members/${MEMBER}.json`]) swap(rel, (t) => t.replaceAll(NAME_A, name));
  writeFileSync(join(dir, "release.json"), JSON.stringify({ schema_version: 1, release_id: id, files: {} }));
}

function setCurrent(id) {
  writeFileSync(join(bucket, "releases", "current.json"), JSON.stringify({ schema_version: 1, release_id: id, manifest_sha256: sha(`manifest ${id}`) }));
}

function startBucket() {
  bucketServer = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    bucketLog.push(path);
    const file = normalize(join(bucket, path));
    if (!file.startsWith(bucket + sep) || !existsSync(file) || !file.endsWith(".json")) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": path.endsWith("current.json") ? "no-cache" : "public, max-age=31536000, immutable" }).end(readFileSync(file));
  });
  return new Promise((resolve) => bucketServer.listen(0, "127.0.0.1", resolve));
}

async function up(url) {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start at ${url}`);
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "pt-pinned-"));
  bucket = join(tmp, "bucket");
  mkdirSync(join(bucket, "releases"), { recursive: true });
  writeRelease(A, { name: NAME_A, built: BUILT_A });
  writeRelease(B, { name: NAME_B, built: BUILT_B });
  setCurrent(A);
  await startBucket();
  bucketBase = `http://127.0.0.1:${bucketServer.address().port}/releases`;

  const env = { ...process.env, RELEASE_BASE_URL: bucketBase, PT_DIST_DIR: DIST, PT_REVALIDATE_SECONDS: REVALIDATE, DATA_BASE_URL: "", NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" };
  delete env.CI;
  rmSync(join(WEB, DIST), { recursive: true, force: true });
  // Asynchronous: the build fetches from the bucket server above, which lives in this process.
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
  // detached: its own process group, so after() can stop next-server too.
  siteServer = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: WEB, env, stdio: "ignore", detached: true });
  await up(`${site}/method`);
  browser = await chromium.launch(process.env.PT_CHROMIUM ? { executablePath: process.env.PT_CHROMIUM } : {});
});

after(async () => {
  await browser?.close();
  if (siteServer?.pid) {
    try {
      process.kill(-siteServer.pid);
    } catch {}
  }
  bucketServer?.close();
  rmSync(join(WEB, DIST), { recursive: true, force: true });
  writeFileSync(TSCONFIG, tsconfigBefore);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** A page that records every same-origin request under /releases/ and /r/, and any request for the legacy unpinned URLs. */
async function tracked() {
  const p = await browser.newPage();
  const pinned = [];
  const unpinned = [];
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin !== site) return;
    if (u.pathname.startsWith("/releases/") || u.pathname.startsWith("/r/")) pinned.push(u.pathname);
    else if (/^\/(data|sample-data|board-data|board-member|search-index)(\/|$)/.test(u.pathname)) unpinned.push(u.pathname);
  });
  return { p, pinned, unpinned };
}

const idsIn = (paths) => new Set(paths.map((x) => /^\/(?:releases|r)\/([^/]+)/.exec(x)[1]));

test("a latest page and every request it makes carry one release id (A)", async () => {
  const { p, pinned, unpinned } = await tracked();
  const res = await p.goto(`${site}/m/${MEMBER}`);
  assert.equal(res.status(), 200);
  const html = await res.text();
  assert.match(html, new RegExp(`/releases/${A}/members/${MEMBER}\\.json`));
  assert.ok(!html.includes(B), "the HTML names only release A");
  assert.ok(!html.includes(NAME_B));
  assert.ok((await p.locator("h1").first().innerText()).includes(NAME_A));
  assert.equal(await p.getByTestId("release-banner").count(), 0, "the latest page has no permalink banner");

  // Search loads /r/<A>/search-index.
  await p.getByRole("search").getByRole("combobox").fill("Ada");
  await p.waitForResponse((r) => r.url().includes("/search-index"));
  // The full file loads the member file from /releases/<A>/.
  await p.goto(`${site}/m/${MEMBER}/records`);
  await p.waitForResponse((r) => r.url().includes(`/releases/${A}/members/${MEMBER}.json`));
  // The board loads a state's strings from /r/<A>/board-data/<state>.
  await p.goto(`${site}/?s=VT&m=X000008`);
  await p.waitForResponse((r) => r.url().includes("/board-data/VT"));

  assert.ok(pinned.some((x) => x === `/r/${A}/search-index`), pinned.join("\n"));
  assert.ok(pinned.some((x) => x === `/releases/${A}/members/${MEMBER}.json`));
  assert.ok(pinned.some((x) => x === `/r/${A}/board-data/VT`));
  assert.deepEqual([...idsIn(pinned)], [A]);
  assert.deepEqual(unpinned, [], "no request to an unpinned data URL");
  await p.close();
});

test("a permalink shows its release's value, the banner, and fetches from that release", async () => {
  const { p, pinned, unpinned } = await tracked();
  const res = await p.goto(`${site}/r/${A}/m/${MEMBER}`);
  assert.equal(res.status(), 200);
  assert.ok((await p.locator("h1").first().innerText()).includes(NAME_A));
  const banner = p.getByTestId("release-banner");
  const text = await banner.innerText();
  assert.match(text, new RegExp(`Pinned to data release ${A.slice(0, 12)} \\(built 1 Mar 2026\\)\\.`));
  assert.match(text, /The figures on this page do not change when newer data is published/);
  assert.equal(await banner.getByRole("link", { name: "View the latest data" }).getAttribute("href"), `/m/${MEMBER}`);
  assert.equal(await p.locator("meta[name=robots]").getAttribute("content"), "noindex");
  assert.match(await p.locator("link[rel=canonical]").getAttribute("href"), new RegExp(`/m/${MEMBER}$`));
  assert.doesNotMatch(await p.locator("link[rel=canonical]").getAttribute("href"), /\/r\//);
  assert.match(await p.locator(".site-footer__meta").innerText(), /Latest data as of/);

  // Client navigation to the full file stays on the release.
  await p.getByRole("link", { name: "Open the full file" }).click();
  await p.waitForURL(`${site}/r/${A}/m/${MEMBER}/records`);
  await p.waitForResponse((r) => r.url().includes(`/releases/${A}/members/${MEMBER}.json`));
  assert.ok(pinned.length > 0 && [...idsIn(pinned)].every((id) => id === A));
  assert.deepEqual(unpinned, []);
  await p.close();
});

test("after the latest pointer moves to B, the permalink to A still shows A", async () => {
  setCurrent(B);
  // Optional part: with the 2 s revalidation override, the latest page moves to B (it never mixes: each response is one release).
  let movedToB = false;
  for (let i = 0; i < 30 && !movedToB; i++) {
    const html = await (await fetch(`${site}/m/${MEMBER}`)).text();
    const hasA = html.includes(`/releases/${A}/`), hasB = html.includes(`/releases/${B}/`);
    assert.ok(!(hasA && hasB), "one response never names two releases");
    movedToB = hasB;
    if (!movedToB) await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(movedToB, "the latest page picked up release B");

  const { p, pinned, unpinned } = await tracked();
  await p.goto(`${site}/r/${A}/m/${MEMBER}`);
  assert.ok((await p.locator("h1").first().innerText()).includes(NAME_A));
  assert.ok(!(await p.content()).includes(NAME_B));
  await p.getByRole("search").getByRole("combobox").fill("Ada");
  await p.waitForResponse((r) => r.url().includes("/search-index"));
  await p.getByRole("link", { name: "Open the full file" }).click();
  await p.waitForResponse((r) => r.url().includes(`/releases/${A}/members/${MEMBER}.json`));
  assert.deepEqual([...idsIn(pinned)], [A]);
  assert.deepEqual(unpinned, []);
  // The latest page, opened in the same browser, is B and its fetches are B's.
  pinned.length = 0;
  // (This route has its own ISR entry, so it may need a revalidation or two to show B; each response is one release.)
  for (let i = 0; i < 20; i++) {
    pinned.length = 0;
    await p.goto(`${site}/m/${MEMBER}/records`, { waitUntil: "networkidle" });
    if ((await p.locator("h1").first().innerText()).includes(NAME_B)) break;
    assert.deepEqual([...idsIn(pinned)], [A], "a not-yet-revalidated latest page is entirely A");
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok((await p.locator("h1").first().innerText()).includes(NAME_B));
  assert.ok(pinned.length > 0);
  assert.deepEqual([...idsIn(pinned)], [B]);
  await p.close();
});

test("an unpublished release is a 404 with explicit wording and never the latest data", async () => {
  const p = await browser.newPage();
  for (const path of [`m/${MEMBER}`, `m/${MEMBER}/records`]) {
    const res = await p.goto(`${site}/r/${UNKNOWN}/${path}`);
    assert.equal(res.status(), 404, path);
    const body = await p.locator("main").innerText();
    assert.match(body, /This data release is not available/);
    assert.match(body, /never published or it has been withdrawn/);
    assert.match(body, /not replaced by the latest data/);
    assert.ok(!body.includes(NAME_A) && !body.includes(NAME_B), "no member data from any release");
    assert.equal(await p.getByRole("link", { name: "Go to the latest data" }).getAttribute("href"), "/");
  }
  for (const path of ["search-index", "board-data/CA", `board-member/${MEMBER}`]) {
    assert.equal((await fetch(`${site}/r/${UNKNOWN}/${path}`)).status, 404, path);
  }
  assert.ok(bucketLog.includes(`/releases/${UNKNOWN}/meta.json`), "availability is checked against that release only");
  assert.ok(!bucketLog.some((x) => x.includes(UNKNOWN) && !x.endsWith("/meta.json")), "nothing else was fetched for it");
  await p.close();
});

test("malformed ids are 404s that never reach the bucket", async () => {
  const before = bucketLog.length;
  const bad = [
    `/r/not-a-release/m/${MEMBER}`,
    `/r/${A.toUpperCase()}/m/${MEMBER}`,
    `/r/${A.slice(1)}/m/${MEMBER}`,
    `/r/${A}0/m/${MEMBER}`,
    `/r/${A}/m/Z99`,
    `/r/${A}/m/x000001`,
    `/r/${A}/board-data/ZZ`,
    `/r/${A}/board-member/../${MEMBER}`,
    `/r/..%2f..%2fcurrent.json/m/${MEMBER}`,
    `/releases/not-a-release/meta.json`,
    `/releases/${A.toUpperCase()}/meta.json`,
  ];
  for (const path of bad) assert.equal((await fetch(site + path)).status, 404, path);
  // A well-formed release with a member it does not hold: 404, and only members.json (the roster) is consulted.
  assert.equal((await fetch(`${site}/r/${A}/m/Z000999`)).status, 404);
  const touched = bucketLog.slice(before);
  assert.ok(!touched.some((x) => /Z000999|not-a-release|Z99|x000001|\.\./i.test(x) && !/members\.json$/.test(x)), touched.join("\n"));
  assert.ok(!touched.some((x) => x.includes("Z000999")), "junk member ids never reach the bucket");
});

test("proxied release files: right bytes, immutable caching, nothing outside the release tree", async () => {
  const res = await fetch(`${site}/releases/${A}/meta.json`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).built, BUILT_A);
  assert.match(res.headers.get("cache-control"), /immutable/);
  assert.equal((await fetch(`${site}/releases/${A}/nope.json`)).status, 404);
  assert.equal((await fetch(`${site}/releases/current.json`)).status, 404, "the pointer is not exposed under /releases/<id>");
  const json = await fetch(`${site}/r/${A}/search-index`);
  assert.equal(json.status, 200);
  assert.match(json.headers.get("cache-control"), /immutable/);
});
