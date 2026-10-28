// npm run demo:warm [-- <site>]
//
// Loads the demo's main pages once, as a tester would, so the first tester
// after a release (or a quiet spell) doesn't wait for the server to start:
// the sign-in page, a one-tap sign-in to the calendar for each salon, the
// pages in the sidebar, My day, and a client's booking site. Prints how long
// each took; the release (scripts/release-demo.ts) runs it straight after
// the new version is live, so the first line is also the first sign-in's
// time. Reads nothing private and changes nothing (a one-tap sign-in only
// starts a session).

import { chromium, type Page } from "@playwright/test";

const SITE = (process.argv[2] ?? process.env.DEMO_URL ?? "https://maestra-demo.vercel.app").replace(/\/+$/, "");
const PAGES = ["/dashboard", "/clients", "/sales", "/scheduling", "/team", "/inventory", "/reports", "/settings"];

async function timed(what: string, step: () => Promise<unknown>): Promise<number> {
  const started = Date.now();
  await step();
  const ms = Date.now() - started;
  console.log(`${String(ms).padStart(6)} ms  ${what}`);
  return ms;
}

async function oneTap(page: Page, who: RegExp) {
  await page.goto(`${SITE}/login`);
  await page.getByRole("button", { name: who }).click();
  await page.getByRole("navigation", { name: "Main" }).waitFor({ timeout: 60_000 });
}

const browser = await chromium.launch();
try {
  const owner = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await timed("Sign-in page", () => owner.goto(`${SITE}/login`));
  await timed("One tap to the calendar (Maple & Ash owner)", () => oneTap(owner, /Owner.*Olivia Bennett/));
  for (const path of PAGES) await timed(path, () => owner.goto(`${SITE}${path}`));
  await timed("/calendar again", () => owner.goto(`${SITE}/calendar`));

  const stylist = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await timed("One tap to My day (stylist)", () => oneTap(stylist, /Stylist.*Bridget Callahan/));

  const large = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await timed("One tap to the calendar (Harbor & Vine owner)", () => oneTap(large, /Owner.*Renata Albright/));

  const client = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await timed("A client's booking site", () => client.goto(`${SITE}/book/maple-and-ash`));
} finally {
  await browser.close();
}
