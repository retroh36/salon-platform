import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Settings → Booking page: the owner adds a cover photo, a stylist's
// specialty and work, a category photo and a service description, and the
// booking site shows them on a phone; a signed-in client gets Book again at
// the top. Everything changed is put back after.

const B = SEED.business;
const BRIDGET = SEED.staff.bridget;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

test.use({ storageState: AUTH.owner });

test("owners set up the booking page, and clients see it", async ({ page, browser }) => {
  const [{ data: settings }, { data: bridget }, { data: blowout }, { data: categoryBefore }] = await Promise.all([
    admin.from("online_booking_settings").select("welcome, cover_path").eq("business_id", B).single(),
    admin.from("staff").select("specialty, bio, portfolio_paths, photo_path").eq("id", BRIDGET).single(),
    admin.from("services").select("id, description").eq("business_id", B).eq("name", "Blowout").single(),
    admin.from("service_category_photos").select("*").eq("business_id", B).eq("category", "Blowouts & Styling").maybeSingle(),
  ]);
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] }, ...phone });
  const site = await visitor.newPage();
  try {
    await page.goto("/settings/booking-page");
    await waitForHydration(page, "[data-testid=cover-field] input[type=file]");
    await expect(ui(page).getByRole("link", { name: "Booking page", exact: true })).toHaveAttribute("aria-current", "page");

    // The cover photo and description.
    await ui(page).getByTestId("cover-field").locator("input[type=file]").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG });
    await expect(ui(page).getByTestId("cover-field").getByRole("status")).toHaveText("Saved the cover photo.");
    const cover = ui(page).getByRole("region", { name: "Cover and description" });
    await cover.getByLabel("Short description").fill("A calm studio for color and cuts.");
    await cover.getByRole("button", { name: "Save description", exact: true }).click();
    await expect(cover.getByText("Saved the description.")).toBeVisible();

    // Bridget's specialty and a photo of her work.
    const profile = ui(page).getByTestId("stylist-profile").filter({ hasText: "Bridget Callahan" });
    await profile.getByLabel("Specialty").fill("Soft blondes and balayage");
    await profile.getByRole("button", { name: "Save Bridget's profile" }).click();
    await expect(profile.getByText("Saved Bridget's profile.")).toBeVisible();
    await profile.getByLabel("Upload a photo of Bridget's work").setInputFiles({ name: "work.png", mimeType: "image/png", buffer: PNG });
    await expect(profile.getByRole("img", { name: /^Bridget's work, photo \d$/ })).toHaveCount(bridget!.portfolio_paths.length + 1);

    // A photo for Blowouts & Styling, and the Blowout's description.
    const category = ui(page).locator("li").filter({ has: page.getByRole("heading", { name: "Blowouts & Styling" }) });
    await category.getByLabel(/^(Upload|Replace) Photo for Blowouts & Styling$/).setInputFiles({ name: "blowouts.png", mimeType: "image/png", buffer: PNG });
    await expect(category.getByRole("status")).toHaveText("Saved the photo for Blowouts & Styling.");
    const descriptions = ui(page).getByRole("region", { name: "Service descriptions" });
    await descriptions.getByLabel("Blowout", { exact: true }).fill("A smooth, full blow-dry that lasts.");
    await descriptions.getByRole("button", { name: "Save descriptions" }).click();
    await expect(descriptions.getByText("Saved the description.")).toBeVisible();

    // On a phone: the cover, name and description, where and when, Book now.
    await site.goto("/book/maple-and-ash");
    const intro = site.getByTestId("salon-intro");
    await expect(site.getByTestId("salon-cover")).toHaveAttribute("src", /\/storage\/v1\/object\/public\/salon-logos\//);
    await expect(intro.getByRole("heading", { level: 1 })).toHaveText("Maple & Ash Hair Studio");
    await expect(intro).toContainText("A calm studio for color and cuts.");
    await expect(intro.getByRole("link", { name: "Map" })).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\//);
    await expect(intro.getByRole("link", { name: "(555) 010-0100" })).toHaveAttribute("href", "tel:5550100100");
    await intro.getByText("All hours").click();
    await expect(intro.getByTestId("salon-hours")).toContainText("Sat8am–5pm");
    await expect(site.getByTestId("book-again")).toHaveCount(0);
    await waitForHydration(site, "[data-testid=booking-flow] button[aria-pressed]");
    await intro.getByRole("link", { name: "Book now" }).click();
    await expect(site.getByTestId("step-label")).toHaveText("Services · Step 1 of 5");
    await expect(site.getByTestId("step-label")).toBeInViewport();

    // The menu: the category's photo, the description, the length and price.
    await expect(site.getByTestId("category-photo")).not.toHaveCount(0);
    const service = site.getByRole("button", { name: /^Blowout\s*45 min/ });
    await expect(service).toContainText("A smooth, full blow-dry that lasts.");
    await expect(service).toContainText("45 min");
    await expect(service).toContainText(/From \$\d+/);
    await service.click();
    await site.getByRole("button", { name: "Continue" }).click();

    // The stylist: full name, level, specialty, and their work under About.
    await expect(site.getByTestId("step-label")).toHaveText("Stylist · Step 2 of 5");
    const card = site.getByTestId("stylist-card").filter({ hasText: "Bridget Callahan" });
    await expect(card).toContainText("Master stylist");
    await expect(card).toContainText("Soft blondes and balayage");
    await card.getByRole("button", { name: "About Bridget" }).click();
    await expect(card.getByTestId("stylist-about").getByRole("img")).toHaveCount(bridget!.portfolio_paths.length + 1);
    // Opening About doesn't choose them.
    await expect(card.getByRole("button", { name: /Bridget Callahan/ })).toHaveAttribute("aria-pressed", "false");

    // On a laptop: the links at the top right, then the cover, then the
    // intro beside the steps, staying in view while the services scroll.
    const laptop = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 900 } });
    const wide = await laptop.newPage();
    await wide.goto("/book/maple-and-ash");
    const links = wide.getByTestId("site-links");
    await expect(links.getByRole("link", { name: "My account" })).toBeVisible();
    await expect(wide.getByTestId("salon-cover")).toBeVisible();
    const wideIntro = wide.getByTestId("salon-intro");
    const [linksBox, coverBox, introBox] = await Promise.all([links.boundingBox(), wide.getByTestId("salon-cover").boundingBox(), wideIntro.boundingBox()]);
    expect(linksBox!.y).toBeLessThan(coverBox!.y);
    expect(linksBox!.x + linksBox!.width).toBeGreaterThan(1100);
    expect(coverBox!.y).toBeLessThan(introBox!.y);
    await waitForHydration(wide, "[data-testid=booking-flow] button[aria-pressed]");
    // Down to the treatments, near the end of the menu.
    await wide.getByRole("button", { name: /^Scalp Treatment/ }).scrollIntoViewIfNeeded();
    expect(await wide.evaluate(() => window.scrollY)).toBeGreaterThan(1500);
    await expect(wideIntro.getByRole("heading", { level: 1 })).toBeInViewport();
    await laptop.close();
  } finally {
    await visitor.close();
    const [{ data: now }, { data: staffNow }, { data: photo }] = await Promise.all([
      admin.from("online_booking_settings").select("cover_path").eq("business_id", B).single(),
      admin.from("staff").select("portfolio_paths").eq("id", BRIDGET).single(),
      admin.from("service_category_photos").select("photo_path").eq("business_id", B).eq("category", "Blowouts & Styling").maybeSingle(),
    ]);
    const added = [now?.cover_path, photo?.photo_path].filter((p): p is string => Boolean(p) && p !== settings!.cover_path && p !== categoryBefore?.photo_path);
    if (added.length) await admin.storage.from("salon-logos").remove(added);
    const work = (staffNow?.portfolio_paths ?? []).filter((p) => !bridget!.portfolio_paths.includes(p));
    if (work.length) await admin.storage.from("staff-photos").remove(work);
    await Promise.all([
      admin.from("online_booking_settings").update({ welcome: settings!.welcome, cover_path: settings!.cover_path }).eq("business_id", B),
      admin.from("staff").update({ specialty: bridget!.specialty, bio: bridget!.bio, portfolio_paths: bridget!.portfolio_paths }).eq("id", BRIDGET),
      categoryBefore
        ? admin.from("service_category_photos").upsert(categoryBefore)
        : admin.from("service_category_photos").delete().eq("business_id", B).eq("category", "Blowouts & Styling"),
      admin.from("services").update({ description: blowout!.description }).eq("id", blowout!.id),
    ]);
  }
});
