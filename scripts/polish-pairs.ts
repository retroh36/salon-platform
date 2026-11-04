// node scripts/polish-pairs.ts <before folder> <after folder> <out folder>
//
// Before-and-after pairs of `npm run screenshots -- --out=…` shots: for each
// shot in both folders, one image with the two side by side under "Before"
// and "After" labels, drawn by Chromium (Playwright), saved to <out>.

import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [before, after, out] = process.argv.slice(2);
if (!before || !after || !out) {
  console.error("Usage: node scripts/polish-pairs.ts <before folder> <after folder> <out folder>");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const names = readdirSync(after).filter((n) => n.endsWith(".png") && existsSync(join(before, n))).sort();
const dataUrl = (path: string) => `data:image/png;base64,${readFileSync(path).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
for (const name of names) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#17273b;font:600 28px system-ui,sans-serif;color:#fff">
    <div style="display:inline-flex;gap:40px;padding:24px 20px;align-items:flex-start">
      ${[["Before", join(before, name)], ["After", join(after, name)]]
        .map(([label, path]) => `<figure style="margin:0"><figcaption style="margin:0 0 16px">${label}: ${name.replace(/\.png$/, "")}</figcaption><img style="display:block;background:#fff" src="${dataUrl(path)}"></figure>`)
        .join("")}
    </div></body></html>`);
  // Each shot at its own size (they're taken at 2×): a phone shot stays a phone.
  await page.evaluate(() => Promise.all([...document.images].map(async (i) => {
    await i.decode();
    i.style.width = `${i.naturalWidth / 2}px`;
  })));
  await page.screenshot({ path: join(out, name), fullPage: true });
  console.log(`  ${name}`);
}
await browser.close();
console.log(`${names.length} pairs in ${out}/.`);
