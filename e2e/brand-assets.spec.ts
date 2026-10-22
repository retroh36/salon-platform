import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";

// Width and height from a PNG's header.
async function pngSize(request: APIRequestContext, url: string) {
  const res = await request.get(url);
  expect(res.status(), url).toBe(200);
  const body = await res.body();
  expect(body.subarray(1, 4).toString(), url).toBe("PNG");
  return [body.readUInt32BE(16), body.readUInt32BE(20)];
}

test("the app's icons, manifest and link preview are Maestra's, and load signed out", async ({ page, request }) => {
  await page.goto("/login");
  const href = (sel: string) => page.locator(sel).first().getAttribute("href");
  const content = (sel: string) => page.locator(sel).first().getAttribute("content");

  // Favicons: the .ico (16, 32, 48) and the SVG.
  const ico = await request.get((await href("link[rel=icon][type='image/x-icon']"))!);
  const icoBody = await ico.body();
  expect(icoBody.readUInt16LE(4)).toBe(3);
  expect([icoBody[6], icoBody[22], icoBody[38]]).toEqual([16, 32, 48]);
  const svg = await request.get((await href("link[rel=icon][type='image/svg+xml']"))!);
  expect(svg.headers()["content-type"]).toContain("image/svg+xml");

  expect(await pngSize(request, (await href("link[rel=apple-touch-icon]"))!)).toEqual([180, 180]);
  expect(await content("meta[name=theme-color]")).toBe("#17273b");
  expect(await content("meta[name=apple-mobile-web-app-title]")).toBe("Maestra");

  const manifest = await (await request.get((await href("link[rel=manifest]"))!)).json();
  expect(manifest).toMatchObject({ name: "Maestra", short_name: "Maestra", display: "standalone", theme_color: "#17273b" });
  for (const icon of manifest.icons) expect(await pngSize(request, icon.src)).toEqual(icon.sizes.split("x").map(Number));
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toContain("maskable");

  const og = new URL((await content("meta[property='og:image']"))!);
  expect(await pngSize(request, og.pathname + og.search)).toEqual([1200, 630]);
  expect(await content("meta[property='og:description']")).toBe("Your salon’s brain. Meet Denise.");
  expect(await content("meta[name='twitter:card']")).toBe("summary_large_image");

  // The platform email header.
  expect(await pngSize(request, "/brand/maestra/email-header.png")).toEqual([1120, 200]);
});

test.describe("login", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("shows Maestra's logo and tagline beside the form", async ({ page }) => {
    await page.goto("/login");
    const panel = page.getByRole("region", { name: "Maestra" });
    await expect(panel.getByRole("img", { name: "Maestra" })).toBeVisible();
    await expect(panel).toContainText("Your salon’s brain.");
    await expect(panel).toContainText("Meet Denise.");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});

test.describe("narrow login", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("folds the panel to the logo above the form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("region", { name: "Maestra" })).toBeHidden();
    await expect(page.getByText("Your salon’s brain. Meet Denise.")).toBeVisible();
  });
});

test.describe("loading screen", () => {
  const breathing = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const img = document.createElement("img");
      img.className = "animate-breathe";
      document.body.appendChild(img);
      const s = getComputedStyle(img);
      return { name: s.animationName, duration: s.animationDuration, count: s.animationIterationCount };
    });

  test("the mark breathes", async ({ page }) => {
    await page.goto("/login");
    expect(await breathing(page)).toEqual({ name: "breathe", duration: "1.4s", count: "infinite" });
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("it stays still", async ({ page }) => {
      await page.goto("/login");
      expect(await breathing(page)).toMatchObject({ count: "1" });
      expect(parseFloat((await breathing(page)).duration)).toBeLessThan(0.001);
    });
  });
});
