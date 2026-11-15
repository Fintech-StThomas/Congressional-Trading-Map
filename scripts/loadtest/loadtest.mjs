#!/usr/bin/env node
// Paper Trail load test: a polite, ramping load generator with a realistic page/data mix, plus the two
// worst cases for the on-demand (ISR) architecture: many distinct cold member pages, and a herd on one URL.
// No dependencies (Node 20+ global fetch). See README.md in this folder. TEST ONLY YOUR OWN DEPLOYMENT.
//
//   node loadtest.mjs ramp  --base https://your-deployment.vercel.app [--stages 5,10] [--duration 30] [--think 1000]
//   node loadtest.mjs cold  --base ... [--count 50] [--concurrency 10]
//   node loadtest.mjs herd  --base ... --path /m/<id> [--concurrency 50]
//
// Stops a stage early (and skips the rest) when the error rate over the last 10 s exceeds --max-error (5%)
// or 20+ responses in that window are 403/429/5xx, and reports where it stopped.

const args = process.argv.slice(2);
const mode = args[0] && !args[0].startsWith("--") ? args.shift() : "ramp";
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = (opt("base", process.env.LOADTEST_BASE ?? "") || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(BASE)) {
  console.error("Missing --base https://<your own deployment>. Never point this at a site you do not own.");
  process.exit(2);
}
const STAGES = opt("stages", "5,10").split(",").map(Number);
const DURATION = Number(opt("duration", "30")) * 1000;
const THINK = Number(opt("think", "1000"));
const MAX_ERR = Number(opt("max-error", "0.05"));
const TIMEOUT = Number(opt("timeout", "30000"));
const SEED = Number(opt("seed", "1"));
const UA = "paper-trail-loadtest/1 (owner-run)";

// Deterministic PRNG so runs are repeatable.
let s = SEED >>> 0 || 1;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function hit(path) {
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(BASE + path, { headers: { "user-agent": UA, "accept-encoding": "br, gzip" }, signal: ctl.signal, redirect: "manual" });
    const buf = await res.arrayBuffer();
    return { path, status: res.status, ms: performance.now() - t0, bytes: buf.byteLength, cache: res.headers.get("x-vercel-cache") ?? "-" };
  } catch (err) {
    return { path, status: err.name === "AbortError" ? "timeout" : "neterr", ms: performance.now() - t0, bytes: 0, cache: "-" };
  } finally {
    clearTimeout(timer);
  }
}

const isBad = (r) => typeof r.status !== "number" || r.status === 403 || r.status === 429 || r.status >= 500;

function summary(label, results, wallMs) {
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const codes = {};
  const cache = {};
  for (const r of results) {
    codes[r.status] = (codes[r.status] ?? 0) + 1;
    cache[r.cache] = (cache[r.cache] ?? 0) + 1;
  }
  const bad = results.filter(isBad).length;
  const mb = results.reduce((a, r) => a + r.bytes, 0) / 1e6;
  const line = {
    label, requests: results.length, rps: +(results.length / (wallMs / 1000)).toFixed(1),
    p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), p99: Math.round(pct(ms, 99)), max: Math.round(ms.at(-1) ?? 0),
    errorRate: +(bad / Math.max(1, results.length)).toFixed(4), codes, cache, decodedMB: +mb.toFixed(1),
  };
  console.log(JSON.stringify(line));
  return line;
}

async function loadMembers() {
  const r = await fetch(`${BASE}/data/members.json`, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`members.json: ${r.status}`);
  const all = await r.json();
  const b = await (await fetch(`${BASE}/data/board.json`, { headers: { "user-agent": UA } })).json();
  return { ids: all.map((m) => m.id), states: Object.keys(b.states) };
}

// 70% page views, 30% the data a board session fetches.
function journey(ctx) {
  const x = rand();
  if (x < 0.7) {
    const y = rand();
    if (y < 0.3) return "/";
    if (y < 0.45) return "/wall";
    if (y < 0.6) return "/cases";
    return `/m/${pick(ctx.pageIds)}`;
  }
  const y = rand();
  if (y < 0.35) return `/board-data/${pick(ctx.states)}`;
  if (y < 0.7) return `/data/members/${pick(ctx.pageIds)}.json`;
  if (y < 0.9) return `/data/orgs/${Math.floor(rand() * 256).toString(16).padStart(2, "0")}.json`;
  return "/search-index";
}

async function ramp() {
  const { ids, states } = await loadMembers();
  // Exclude the biggest member (7.5 MB trade file is never fetched here; its page is ~1 MB HTML) from random picks.
  const ctx = { pageIds: ids.filter((id) => id !== "K000389"), states };
  const out = [];
  for (const vus of STAGES) {
    const results = [];
    const start = performance.now();
    let stop = null;
    const deadline = start + DURATION;
    const vu = async () => {
      while (!stop && performance.now() < deadline) {
        results.push(await hit(journey(ctx)));
        if (THINK) await new Promise((r) => setTimeout(r, THINK * (0.5 + rand())));
      }
    };
    const watchdog = setInterval(() => {
      const now = performance.now();
      const recent = results.slice(-Math.max(50, vus * 10)); // roughly the last 10 s at ~1 req/s per VU
      const bad = recent.filter(isBad).length;
      if (recent.length >= 50 && (bad / recent.length > MAX_ERR || bad >= 20)) stop = `stopped at ${Math.round((now - start) / 1000)} s: ${bad}/${recent.length} recent responses were errors`;
    }, 2000);
    await Promise.all(Array.from({ length: vus }, vu));
    clearInterval(watchdog);
    out.push(summary(`ramp ${vus} VUs`, results, performance.now() - start));
    if (stop) {
      console.log(`STOP: ${stop}. Point of failure: ${vus} VUs.`);
      break;
    }
  }
  return out;
}

async function cold() {
  const { ids } = await loadMembers();
  const count = Number(opt("count", "50"));
  const conc = Number(opt("concurrency", "10"));
  // Members from the end of a seeded shuffle, so a cold run does not reuse the ramp's most likely picks.
  const shuffled = ids.filter((id) => id !== "K000389").sort(() => rand() - 0.5).slice(-count);
  const queue = [...shuffled];
  const results = [];
  const start = performance.now();
  await Promise.all(Array.from({ length: conc }, async () => {
    while (queue.length) results.push(await hit(`/m/${queue.shift()}`));
  }));
  const wall = performance.now() - start;
  summary(`cold ${count} distinct members @${conc}`, results, wall);
  const miss = results.filter((r) => r.cache === "MISS").map((r) => r.ms).sort((a, b) => a - b);
  console.log(JSON.stringify({ label: "cold: MISS only", n: miss.length, p50: Math.round(pct(miss, 50)), p95: Math.round(pct(miss, 95)), max: Math.round(miss.at(-1) ?? 0) }));
}

async function herd() {
  const path = opt("path", "/");
  const conc = Number(opt("concurrency", "50"));
  const start = performance.now();
  const results = await Promise.all(Array.from({ length: conc }, () => hit(path)));
  summary(`herd ${conc} x ${path}`, results, performance.now() - start);
}

({ ramp, cold, herd })[mode]?.().catch((e) => {
  console.error(e);
  process.exit(1);
}) ?? (console.error(`unknown mode ${mode}`), process.exit(2));
