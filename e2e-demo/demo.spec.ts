import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { DEMO_BANNER, DEMO_CLIENT, DEMO_LOGINS, DEMO_OFF } from "@/lib/demo";

// The public demo (DEMO_MODE=true): its bar on every page, one-tap sign-in
// for each role, codes on screen, the outbox, feedback, and nothing that
// would send an email. With DEMO_URL these run against the deployed demo,
// and only read (apart from a client's sign-in code).

const remote = !!process.env.DEMO_URL;
const bar = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Demo" });

test("the sign-in page has the demo's bar and a button for each role, and no password", async ({ page }) => {
  await page.goto("/login");
  await expect(bar(page)).toContainText(DEMO_BANNER);
  const form = page.getByRole("form", { name: "Demo sign-in" });
  for (const l of DEMO_LOGINS) await expect(form.getByRole("button", { name: new RegExp(`${l.role}.*${l.name}`) })).toBeVisible();
  await expect(form.getByRole("button", { name: new RegExp(`Client.*${DEMO_CLIENT.name}`) })).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);
});

for (const l of DEMO_LOGINS) {
  test(`one tap signs in as ${l.role} (${l.name}, ${l.salon})`, async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: new RegExp(`${l.role}.*${l.name}`) }).click();
    // The calendar opens on the next day with visits.
    await expect(page).toHaveURL(new RegExp(`${l.goTo}(\\?date=[\\d-]+)?$`), { timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByText(l.name.split(" ")[0], { exact: false }).first()).toBeVisible();
    await expect(bar(page)).toBeVisible();
  });
}

// The demo's reset opens both salons every day (seed-demo-open-daily.sql),
// with visits today, so a tester never lands on a closed salon.
for (const key of ["front-desk", "large-owner"]) {
  const l = DEMO_LOGINS.find((d) => d.key === key)!;
  test(`${l.salon.split(",")[0]} is open today, with visits`, async ({ page }) => {
    test.skip(!remote, "The local database keeps the salons' real hours (closed Sundays and Mondays at Maple & Ash).");
    await page.goto("/login");
    await page.getByRole("button", { name: new RegExp(`${l.role}.*${l.name}`) }).click();
    // The first sign-in after a release opens a cold calendar.
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible({ timeout: 15_000 });
    await page.goto("/calendar");
    await expect(page.locator("[data-block]").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/The salon is closed/)).toHaveCount(0);
  });
}

test("one tap signs in as a client, to her account on the booking site", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /Client/ }).click();
  await expect(page).toHaveURL(new RegExp(`/book/${DEMO_CLIENT.slug}/account$`));
  await expect(page.getByText(DEMO_CLIENT.name.split(" ")[0]).first()).toBeVisible();
  await expect(bar(page)).toBeVisible();
});

test("a client's sign-in code shows on screen, since nothing is sent", async ({ page }) => {
  await page.goto(`/book/${DEMO_CLIENT.slug}/account`);
  await page.getByRole("radio", { name: "Text" }).click();
  await page.getByLabel("Mobile number").fill("(312) 555-0142");
  await page.getByRole("button", { name: "Send my code" }).click();
  await expect(page.getByTestId("demo-code")).toContainText(/your code is \d{6}/);
});

test("the outbox is open in the demo", async ({ page }) => {
  await page.goto("/dev/outbox");
  await expect(page.getByRole("heading", { name: "Demo outbox" })).toBeVisible();
});

test("a forgotten password sends nothing", async ({ page }) => {
  await page.goto("/login/forgot");
  await page.getByLabel("Email").fill("owner@mapleandash.test");
  await page.getByRole("button", { name: /Send/ }).click();
  await expect(page.getByText(DEMO_OFF.passwords)).toBeVisible();
});

test("the status page says what's set, yes or no", async ({ request }) => {
  const status = await (await request.get("/api/demo/status")).json();
  expect(status).toMatchObject({ demoMode: true, supabase: true, phorest: false, stripe: false });
  if (remote) expect(status).toMatchObject({ denise: true, cronSecret: true, siteUrl: true });
});

test("the calendar still fits the screen under the bar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByRole("button", { name: /Front desk/ }).click();
  // On a day with visits, even when today the salon is closed.
  await expect(page).toHaveURL(/\/calendar(\?date=[\d-]+)?$/);
  await expect(page.locator("[data-block]").first()).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
});

test("feedback is saved with the page, role and time", async ({ page }) => {
  test.skip(remote, "Leaves the deployed demo's feedback alone.");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const note = `Demo test note ${Date.now()}`;
  await page.goto("/login");
  await page.getByRole("button", { name: /^Owner.*Olivia/ }).click();
  await expect(page).toHaveURL(/\/calendar(\?date=[\d-]+)?$/);
  await bar(page).getByRole("button", { name: "Feedback" }).click();
  const sheet = page.getByRole("dialog", { name: "Send feedback" });
  await sheet.getByLabel("Your note").fill(note);
  await sheet.getByLabel("Your name (optional)").fill("Pat");
  await sheet.getByRole("button", { name: "Send feedback" }).click();
  await expect(sheet).toContainText("Thanks");
  const { data } = await admin.from("demo_feedback").select("note, name, page, role, salon, created_at").eq("note", note).single();
  expect(data).toMatchObject({ name: "Pat", page: "/calendar", role: "Owner", salon: "Maple & Ash Hair Studio" });
  await admin.from("demo_feedback").delete().eq("note", note);
});
