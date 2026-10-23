import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;

test.use({ storageState: AUTH.owner });

test("owners set up online booking: link, embed, rules, look and services", async ({ page, browser }) => {
  const { data: before } = await admin.from("online_booking_settings").select("*").eq("business_id", B).single();
  const { data: services } = await admin.from("services").select("id, name, online_booking, deposit_kind, deposit_amount").eq("business_id", B).in("name", ["Blowout", "Men's Cut"]);
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  const site = await visitor.newPage();
  try {
    await page.goto("/settings/booking");
    await waitForHydration(page, "form[aria-label='Online booking rules'] button");
    await expect(ui(page).getByRole("link", { name: "Online booking" })).toHaveAttribute("aria-current", "page");
    await expect(ui(page).getByLabel("Booking link", { exact: true })).toHaveValue(/\/book\/maple-and-ash$/);
    await expect(ui(page).getByLabel("Embed on your website", { exact: true })).toHaveValue(/<iframe src="http[^"]+\/book\/maple-and-ash" title="Book with Maple &amp; Ash Hair Studio"/);
    await expect(ui(page).getByTestId("booking-status")).toHaveText("Online booking is on.");

    // A color too light for white text is refused.
    const rules = ui(page).getByRole("form", { name: "Online booking rules" });
    await rules.getByRole("button", { name: "Use #1d4e5f" }).click();
    await expect(rules.getByTestId("accent-check")).toContainText("Readable");
    await rules.getByLabel("Least notice (hours)").fill("4");
    await rules.getByLabel("Take bookings online").uncheck();
    await rules.getByRole("button", { name: "Save rules and look" }).click();
    await expect(rules.getByRole("status")).toHaveText("Saved. Online booking is off.");
    expect((await admin.from("online_booking_settings").select("enabled, notice_minutes, accent_color").eq("business_id", B).single()).data).toEqual({
      enabled: false,
      notice_minutes: 240,
      accent_color: "#1d4e5f",
    });

    // Off: the site says to call.
    await site.goto("/book/maple-and-ash");
    await expect(site.getByRole("heading", { name: "Online booking is closed" })).toBeVisible();
    await expect(site.getByText("(555) 010-0100")).toBeVisible();

    await rules.getByLabel("Take bookings online").check();
    await rules.getByRole("button", { name: "Save rules and look" }).click();
    await expect(rules.getByRole("status")).toHaveText("Saved. Online booking is on.");

    // Services: blowouts off the site, a deposit on men's cuts.
    const list = ui(page).getByRole("form", { name: "Services online" });
    await list.getByLabel("Blowout: online", { exact: true }).selectOption("off");
    await list.getByLabel("Men's Cut: deposit", { exact: true }).selectOption("fixed");
    await list.getByLabel("Men's Cut: deposit amount", { exact: true }).fill("10");
    await list.getByRole("button", { name: "Save services" }).click();
    await expect(list.getByRole("status")).toHaveText("Saved the services.");

    // The site in the salon's color, without blowouts, showing the deposit.
    await site.goto("/book/maple-and-ash");
    await waitForHydration(site, "[data-testid=booking-flow] button[aria-pressed]");
    await expect(site.getByRole("button", { name: /^Blowout\s*\d/ })).toHaveCount(0);
    await expect(site.getByRole("button", { name: /^Men's Cut\s*\d/ })).toContainText("$10 deposit");
    await site.getByRole("button", { name: /^Men's Cut\s*\d/ }).click();
    expect(await site.getByRole("button", { name: "Continue" }).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(29, 78, 95)");
  } finally {
    await admin.from("online_booking_settings").update(before!).eq("business_id", B);
    for (const s of services!) await admin.from("services").update({ online_booking: s.online_booking, deposit_kind: s.deposit_kind, deposit_amount: s.deposit_amount }).eq("id", s.id);
    await visitor.close();
  }
});

test.describe("the front desk", () => {
  test.use({ storageState: AUTH.frontDesk });
  test("can't open online booking settings", async ({ page }) => {
    await page.goto("/settings/booking");
    await expect(page).toHaveURL("/dashboard");
  });
});

test("a stylist's photo, added on the schedule page, shows on the booking site", async ({ page, browser }) => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  try {
    await page.goto("/schedule");
    await ui(page).getByRole("navigation", { name: "Team", exact: true }).getByRole("link", { name: "Shae" }).click();
    await expect(ui(page).getByRole("heading", { level: 2, name: /^Shae / })).toBeVisible();
    await waitForHydration(page, "form[aria-label=Photo] button");
    const form = ui(page).getByRole("form", { name: "Photo" });
    await form.getByLabel("Photo for online booking").setInputFiles({ name: "shae.png", mimeType: "image/png", buffer: png });
    await form.getByRole("button", { name: "Upload" }).click();
    await expect(form.getByRole("status")).toHaveText("Saved the photo.");

    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
    const site = await visitor.newPage();
    await site.goto("/book/maple-and-ash");
    await waitForHydration(site, "[data-testid=booking-flow] button[aria-pressed]");
    await site.getByRole("button", { name: /^Blowout\s*\d/ }).click();
    await site.getByRole("button", { name: "Continue" }).click();
    await expect(site.getByRole("button", { name: /Shae M\./ }).locator("img")).toHaveAttribute("src", /\/storage\/v1\/object\/public\/staff-photos\//);
    await visitor.close();
  } finally {
    const { data } = await admin.from("staff").select("photo_path").eq("id", SEED.staff.shae).single();
    if (data?.photo_path) await admin.storage.from("staff-photos").remove([data.photo_path]);
    await admin.from("staff").update({ photo_path: null }).eq("id", SEED.staff.shae);
  }
});
