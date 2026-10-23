import { formatLongDay } from "@/lib/schedule-format";
import { addDays, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "../tests/db/helpers";
import { onCheckout, openCheckout } from "./checkout-helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

const B = SEED.business;
const TZ = "America/Chicago";
// A Tuesday clear of the seeded month and the other tests' days.
const DAY = addDays(startOfWeek(todayIn(TZ)), 78);
const PREFIX = `Pg${Date.now().toString(36)}`;
const NAME = `${PREFIX} 4 blowouts`;

let clientId: string;

test.beforeAll(async () => {
  const { data } = await admin.from("clients").insert({ business_id: B, first_name: `${PREFIX}Ava`, last_name: "Test" }).select("id").single();
  clientId = data!.id;
});

test.afterAll(async () => {
  const { data: pkgs } = await admin.from("client_packages").select("sale_id").eq("client_id", clientId);
  await admin.from("sales").delete().in("id", (pkgs ?? []).flatMap((p) => (p.sale_id ? [p.sale_id] : [])));
  await admin.from("sales").delete().eq("client_id", clientId);
  await admin.from("client_packages").delete().eq("client_id", clientId);
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("package_templates").delete().eq("name", NAME);
});

test.use({ viewport: { width: 1920, height: 1500 } });

test.describe.serial("a package from start to finish", () => {
  test("an owner sets up a package", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.owner });
    await page.goto("/settings/packages");
    await waitForHydration(page, "form[aria-label='New package'] input");
    const form = ui(page).getByRole("form", { name: "New package" });
    await form.getByLabel("Name").fill(NAME);
    await form.getByLabel("Price ($)").fill("160");
    await form.getByLabel("Service 1", { exact: true }).selectOption({ label: "Blowout" });
    await form.getByLabel("How many of service 1").fill("4");
    await form.getByLabel("Lasts (months)").fill("12");
    await form.getByRole("button", { name: "Add package" }).click();
    await expect(form.getByRole("status")).toHaveText("Saved.");
    await page.reload();
    await expect(ui(page).getByRole("heading", { name: NAME })).toBeVisible();
    await page.close();
  });

  test("the front desk sells it, booking points it out, and checkout uses it", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.frontDesk, viewport: { width: 1920, height: 1500 } });
    let co = await openCheckout(page, { from: "/sales" });
    await co.ticket.getByLabel("Find a client").fill(`${PREFIX}ava`);
    await co.ticket.getByRole("list", { name: "Matching clients" }).getByRole("button").first().click();
    await expect(co.ticket.getByTestId("checkout-client")).toHaveText(new RegExp(`^${PREFIX}Ava`));
    await co.ticket.getByRole("button", { name: "Package", exact: true }).click();
    await co.dialog.getByRole("button", { name: new RegExp(`^${NAME}`) }).click();
    await expect(co.total).toHaveText("$160");
    await co.card();
    await co.complete();

    // A blowout with Bridget: the booking form mentions the package.
    await page.goto(`/calendar?date=${DAY}`);
    await expect(ui(page).getByTestId("calendar-date")).toContainText(formatLongDay(DAY));
    await waitForHydration(page, "section[data-staff-id]");
    await ui(page).getByRole("button", { name: "New booking" }).click();
    const booking = page.getByRole("tabpanel", { name: "Booking details" }).getByRole("form", { name: "New booking" });
    await booking.getByLabel("Find a client").fill(`${PREFIX}ava`);
    await booking.getByRole("list", { name: "Matching clients" }).getByRole("button").first().click();
    const line = booking.getByRole("group", { name: "Service 1" });
    await line.getByLabel("Stylist").selectOption({ label: "Bridget Callahan" });
    await line.getByLabel("Starts").fill("10:00");
    await line.getByLabel("Service").selectOption({ label: "Blowout" });
    await expect(booking.getByTestId("package-note")).toHaveText(`${PREFIX}Ava has 4 Blowouts left on a package. It's used at checkout.`);
    await booking.getByRole("button", { name: "Create booking" }).click();

    // Checked in and out: the package pays for it.
    const details = page.getByRole("tabpanel", { name: "Booking details" });
    await details.getByRole("button", { name: "Check in client" }).click();
    await details.getByRole("button", { name: "Check out client" }).click();
    co = await onCheckout(page);
    await expect(co.lines.first()).toContainText("paid with package");
    await expect(co.remaining).toHaveText("Paid in full");
    await co.payment.getByRole("button", { name: "Complete sale · $0" }).click();
    await expect(page.getByTestId("checkout-success")).toBeVisible();

    const { data: items } = await admin.from("client_package_items").select("used, total, client_package:client_packages!inner(client_id)").eq("client_package.client_id", clientId);
    expect(items!.map((i) => [i.used, i.total])).toEqual([[1, 4]]);
    await page.close();
  });

  test("the client's profile shows what's left; an owner cancels it with a pro-rated refund", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.owner });
    await page.goto(`/clients/${clientId}`);
    const pkg = ui(page).getByTestId("client-package");
    await expect(pkg).toContainText(NAME);
    await expect(pkg).toContainText("1 of 4 used · 3 Blowouts left");
    await expect(ui(page).getByTestId("client-insight")).toContainText("Package: 3 Blowouts left");

    await waitForHydration(page, "[data-testid=client-package] button");
    await pkg.getByRole("button", { name: "Cancel package" }).click();
    const cancel = pkg.getByRole("form", { name: `Cancel ${NAME}` });
    // $160 for 4: $40 a use, 3 left.
    await expect(cancel.getByTestId("pro-rated-refund")).toHaveText("The unused part is worth $120 (what the uses left cost, pro-rated).");
    await cancel.getByLabel("Reason").fill("Moving away");
    await cancel.getByRole("button", { name: "Cancel package" }).click();
    await expect(cancel.getByRole("status")).toHaveText("Canceled and refunded $120.00.");
    await page.reload();
    await expect(ui(page).getByTestId("client-package")).toContainText("Refunded");
    await page.close();
  });
});
