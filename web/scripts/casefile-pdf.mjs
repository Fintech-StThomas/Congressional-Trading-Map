// Print the case file to PDF (A4 and US Letter) for given members, and a PNG of print media.
// node scripts/casefile-pdf.mjs http://localhost:3100 W000800 K000389
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [base = "http://localhost:3100", ...ids] = process.argv.slice(2);
const out = new URL("../.screenshots/casefile/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const id of ids) {
  const p = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  await p.goto(`${base}/m/${id}`, { waitUntil: "networkidle" });
  await p.emulateMedia({ media: "print" });
  for (const format of ["A4", "Letter"]) {
    const path = `${out}${id}-${format}.pdf`;
    await p.pdf({ path, format, printBackground: true, preferCSSPageSize: false });
    console.log(path);
  }
  await p.screenshot({ path: `${out}${id}-print.png`, fullPage: true });
  console.log(`${out}${id}-print.png`);
  await p.close();
}
await browser.close();
