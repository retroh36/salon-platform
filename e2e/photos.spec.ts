import { formatLongDay } from "@/lib/schedule-format";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, clientTab, expect, test, ui, visitTab, waitForHydration } from "./fixtures";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
// A Wednesday clear of the seeded month and the other tests' days.
const DAY = addDays(startOfWeek(todayIn(TZ)), 79);
const PREFIX = `Ph${Date.now().toString(36)}`;
// A real (tiny) PNG the browser can draw.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

let clientId: string;

test.beforeAll(async () => {
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Pia`, last_name: "Test" }).select("id").single();
  clientId = c!.id;
  const start = fromLocal(DAY, 10 * 60, TZ)!;
  const end = new Date(start.getTime() + 45 * 60_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single();
  const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single();
  await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: s!.id, staff_id: SEED.staff.gil, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 45, price_cents: 0 });
});

test.afterAll(async () => {
  const { data: files } = await admin.storage.from("visit-photos").list(`${B}/${clientId}`);
  if (files?.length) await admin.storage.from("visit-photos").remove(files.map((f) => `${B}/${clientId}/${f.name}`));
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
});

test.use({ storageState: AUTH.frontDesk });

test("adds before and after photos to a visit, records consent, and shows them on the client's profile", async ({ page }) => {
  await page.goto(`/calendar?date=${DAY}`);
  await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
  await waitForHydration(page, "section[data-staff-id]");
  await ui(page).getByRole("button", { name: new RegExp(`${PREFIX}Pia Test`) }).click();
  const panel = page.getByRole("tabpanel", { name: "Booking details" });
  await visitTab(panel, "Photos");
  const add = panel.getByRole("region", { name: "Add photos" });
  await expect(add.getByRole("button", { name: "Take photo" })).toBeVisible();
  // The camera on phones and iPads; a file anywhere.
  await expect(add.getByLabel("Take a before photo")).toHaveAttribute("capture", "environment");

  await add.getByLabel("Upload before photos").setInputFiles({ name: "before.png", mimeType: "image/png", buffer: PNG });
  await expect(add.getByRole("status")).toHaveText("Before photo saved.");
  await add.getByRole("radio", { name: "After" }).click();
  await add.getByLabel("Upload after photos").setInputFiles({ name: "after.png", mimeType: "image/png", buffer: PNG });
  await expect(add.getByRole("status")).toHaveText("After photo saved.");
  const photos = panel.getByTestId("visit-photo");
  await expect(photos).toHaveCount(2);
  await expect(photos.first()).toHaveAttribute("data-kind", "before");
  await expect(photos.first()).toContainText("with Gil");
  // Shown from a signed link, never a public one.
  const src = await photos.first().locator("img").getAttribute("src");
  expect(src).toContain("/storage/v1/object/sign/visit-photos/");
  await expect.poll(() => photos.first().locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);

  // Marketing needs the client's consent first.
  const ok = photos.last().getByLabel("OK for marketing");
  await expect(ok).toBeDisabled();
  const consent = panel.getByTestId("photo-consent");
  await consent.getByRole("button", { name: "They've agreed" }).click();
  await consent.getByRole("button", { name: "Record consent" }).click();
  await expect(consent).toContainText(/given .* \(recorded by Sam\)/);
  await expect(ok).toBeEnabled();
  await ok.check();
  await expect.poll(async () => (await admin.from("visit_photos").select("marketing_ok").eq("client_id", clientId).eq("kind", "after").single()).data!.marketing_ok).toBe(true);

  // On the profile: the visit's photos together, with the date and stylist.
  await page.goto(`/clients/${clientId}`);
  const gallery = await clientTab(page, "Photos");
  await expect(gallery.getByRole("list", { name: "Photos by visit" }).getByRole("heading", { level: 3 })).toContainText("with Gil");
  await expect(gallery.getByTestId("visit-photo")).toHaveCount(2);
  await expect(gallery.getByTestId("visit-photo").last().getByLabel("OK for marketing")).toBeChecked();
  // Withdrawing consent takes them out of marketing.
  await gallery.getByTestId("photo-consent").getByRole("button", { name: "Withdraw" }).click();
  await expect(gallery.getByTestId("visit-photo").last().getByLabel("OK for marketing")).not.toBeChecked();
  // The front desk added them, so the front desk can remove one.
  await gallery.getByRole("button", { name: "Remove this before photo" }).click();
  await expect(gallery.getByTestId("visit-photo")).toHaveCount(1);
});
