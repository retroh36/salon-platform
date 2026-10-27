import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, putBackSales, test, ui, waitForHydration } from "./fixtures";

// Stock and sales this file uses are put back afterwards.
putBackSales();

// Booking links for Google and social, where online bookings came from,
// and how the booking site shows up in search.

const SLUG = "maple-and-ash";

test.describe("owner", () => {
  test.use({ storageState: AUTH.owner });

  test("copies a booking link for each place, with steps, and sees where bookings came from", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/settings/booking");
    const links = ui(page).getByRole("list", { name: "Booking links" });
    await expect(links.getByTestId("share-link")).toHaveCount(4);
    const google = links.locator("[data-source=google]");
    await expect(google.getByRole("textbox")).toHaveValue(new RegExp(`/book/${SLUG}\\?src=google$`));
    await waitForHydration(page, "[data-source=google] button");
    await google.getByRole("button", { name: "Copy link" }).click();
    await expect(google.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/book/${SLUG}\\?src=google$`));
    await google.getByText("How to add it").click();
    await expect(google.getByRole("listitem")).toHaveCount(3);
    await expect(links.locator("[data-source=instagram]")).toContainText("Instagram");

    await page.goto("/reports?period=last_30_days");
    const table = ui(page).getByRole("table", { name: "Online bookings by source" });
    await expect(table.locator("[data-source=google]")).toContainText("Google");
    const { count } = await admin.from("appointments").select("id", { count: "exact", head: true }).eq("business_id", SEED.business).eq("source", "online").eq("online_source", "google").gte("created_at", new Date(Date.now() - 31 * 86_400_000).toISOString());
    expect(Number(await table.locator("[data-source=google] td").nth(1).innerText())).toBeLessThanOrEqual(count!);
  });
});

test.describe("search engines", () => {
  test("see the booking site's title, description, link and structured data; and only the booking sites", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    try {
      await page.goto(`/book/${SLUG}?src=instagram`);
      await expect(page).toHaveTitle(/^Book online at Maple & Ash Hair Studio · /);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Maple & Ash Hair Studio/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/book/${SLUG}$`));
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /^Book online at Maple & Ash Hair Studio/);
      const data = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
      expect(data).toMatchObject({ "@context": "https://schema.org", "@type": "HairSalon", name: "Maple & Ash Hair Studio", potentialAction: { "@type": "ReserveAction" } });
      expect(data.openingHoursSpecification.length).toBeGreaterThan(0);
      expect(data.hasOfferCatalog.itemListElement.length).toBeGreaterThan(5);

      const robots = await page.request.get("/robots.txt");
      expect(robots.ok()).toBe(true);
      const text = await robots.text();
      expect(text).toContain("Allow: /book/");
      expect(text).toContain("Disallow: /pay/");
      expect(text).toMatch(/Sitemap: .+\/sitemap\.xml/);
      const sitemap = await page.request.get("/sitemap.xml");
      expect(sitemap.ok()).toBe(true);
      expect(await sitemap.text()).toContain(`/book/${SLUG}</loc>`);
    } finally {
      await page.context().close();
    }
  });
});
