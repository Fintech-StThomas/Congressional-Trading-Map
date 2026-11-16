// Regenerate the compiled homepage in an isolated server with no public/geo or
// .cache assets. A cached prerender alone would hide the serverless regression.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("production homepage regenerates with all outlines without runtime geometry files", { timeout: 60000 }, async (t) => {
  const root = resolve(import.meta.dirname, "..");
  const manifestPath = join(root, ".next/required-server-files.json");
  assert.ok(existsSync(manifestPath), "Run npm run build before the deployment test");
  const { config } = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (config.env.PT_REMOTE_DATA || config.env.NEXT_PUBLIC_SAMPLE !== "1") {
    t.skip("requires the fixture build used by CI; runs without external data services");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "paper-trail-geo-"));
  let child;
  let logs = "";
  try {
    cpSync(join(root, ".next"), join(dir, ".next"), {
      recursive: true,
      filter: (path) => path !== join(root, ".next/cache"),
    });
    // Only the invented dataset is supplied; geometry must come from compiled JS.
    cpSync(join(root, "fixtures"), join(dir, "fixtures"), { recursive: true });
    symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
    assert.ok(!existsSync(join(dir, "public")) && !existsSync(join(dir, ".cache")));
    const prerender = JSON.parse(readFileSync(join(dir, ".next/prerender-manifest.json"), "utf8"));
    const serverCode = `
      import next from './node_modules/next/dist/server/next.js';
      import { createServer } from 'node:http';
      import { readFileSync } from 'node:fs';
      const { config } = JSON.parse(readFileSync('.next/required-server-files.json', 'utf8'));
      const app = next({ dev: false, dir: process.cwd(), conf: config });
      await app.prepare();
      const server = createServer(app.getRequestHandler());
      server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
    `;
    child = spawn(process.execPath, ["--input-type=module", "-e", serverCode], {
      cwd: dir,
      env: { ...process.env, NODE_ENV: "production", PT_DATA: "fixtures", DATA_BASE_URL: "", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.stdout.on("data", (data) => { logs += data; });
    child.stderr.on("data", (data) => { logs += data; });
    const { port } = await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${logs}`)), 20000);
      child.once("message", (message) => { clearTimeout(timer); resolveReady(message); });
      child.once("error", (err) => { clearTimeout(timer); reject(err); });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${logs}`)); });
    });
    // This is Next's on-demand ISR header, using only this local build's key.
    // REVALIDATED proves we exercised the server instead of serving build-time HTML.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { "x-prerender-revalidate": prerender.preview.previewModeId },
        signal: AbortSignal.timeout(15000),
      });
      const html = await response.text();
      assert.equal(response.status, 200, logs);
      assert.equal(response.headers.get("x-nextjs-cache"), "REVALIDATED", logs);
      assert.ok(!html.includes("State outlines are unavailable"), "Regenerated homepage lost its state outlines");
      const codes = [...html.matchAll(/<path\b[^>]*data-state="([A-Z]{2})"/g)].map((m) => m[1]);
      assert.equal(codes.length, 51);
      assert.equal(new Set(codes).size, 51);
      assert.match(html, /class="usmap__nation" d="M/);
      assert.match(html, /class="usmap__borders" d="M/);
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
