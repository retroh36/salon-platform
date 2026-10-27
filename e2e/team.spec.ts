import type { Browser, Page } from "@playwright/test";
import { admin, SEED } from "../tests/db/helpers";
import { AUTH, expect, test, ui, waitForHydration } from "./fixtures";

// Managing the team: an owner adds a stylist with their services and hours
// and invites them; the invite email's link lets them choose a password and
// sign in; managers can't open owners; someone leaving is deactivated (and
// can't get in); "Forgot password?" and an owner's reset send a link to
// choose a new one. Emails are read from local Supabase's Mailpit.

const B = SEED.business;
const TAG = `tm${Date.now().toString(36)}`;
const EMAIL = `${TAG}@example.test`;
const MAILPIT = "http://127.0.0.1:54324/api/v1";

test.afterAll(async () => {
  const { data } = await admin.from("staff").select("id, user_id").eq("business_id", B).ilike("email", `${TAG}%`);
  for (const s of data ?? []) {
    await admin.from("staff").delete().eq("id", s.id);
    if (s.user_id) await admin.auth.admin.deleteUser(s.user_id);
  }
});

// The newest email to an address with this subject, and its link to our
// /auth/confirm (pointed at the test server).
async function emailLink(to: string, subject: string, after: number): Promise<string> {
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        const search = await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`)).json();
        const message = (search.messages as { ID: string; Created: string }[]).find((m) => Date.parse(m.Created) >= after - 1000);
        if (!message) return null;
        const html = (await (await fetch(`${MAILPIT}/message/${message.ID}`)).json()).HTML as string;
        const href = html.match(/href="([^"]*\/auth\/confirm\?[^"]+)"/)?.[1];
        link = href ? href.replace(/&amp;/g, "&").replace(/^https?:\/\/[^/]+/, "") : null;
        return link;
      },
      { timeout: 15_000 },
    )
    .not.toBeNull();
  return link!;
}

async function signedOut(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

// Rae is a stylist, so a new password lands on My day.
async function choosePassword(page: Page, link: string, password: string, heading: string) {
  await page.goto(link);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await waitForHydration(page, "input[name=password]");
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("The same again").fill(password);
  await page.getByRole("button", { name: "Save password and sign in" }).click();
  await expect(page).toHaveURL("/my-day");
}

test.describe.configure({ mode: "serial" });

test("an owner adds a stylist with services and hours, and the invite lets them sign in", async ({ browser }) => {
  const page = await browser.newPage({ storageState: AUTH.owner });
  await page.goto("/team");
  await ui(page).getByRole("link", { name: "Add team member" }).click();
  await expect(page).toHaveURL("/team/new");
  await waitForHydration(page, "input[name=first_name]");
  const form = ui(page).getByRole("form", { name: "Add team member" });
  await form.getByLabel("First name").fill(`${TAG}Rae`);
  await form.getByLabel("Last name").fill("Lin");
  await form.locator("input[name=email]").fill(EMAIL);
  await form.getByLabel("Role").selectOption("stylist");
  await form.getByLabel("Level").selectOption("senior");
  await form.getByLabel("Blowout", { exact: true }).check();
  await form.getByLabel("Women's Cut & Style").check();
  // Starts from the salon's opening hours; Monday off.
  await form.getByRole("group", { name: "Monday" }).getByLabel("Monday start").fill("");
  await form.getByRole("group", { name: "Monday" }).getByLabel("Monday end").fill("");
  const sent = Date.now();
  await form.getByRole("button", { name: "Add to the team" }).click();

  await expect(page).toHaveURL(/\/team\/[0-9a-f-]{36}\?done=invited$/);
  await expect(ui(page).getByText("Added to the team and invited")).toBeVisible();
  await expect(ui(page).getByRole("region", { name: "Login" })).toContainText("Invited");
  const { data: rae } = await admin.from("staff").select("id, role, level, user_id, staff_services(service:services(name)), staff_working_hours(weekday)").eq("email", EMAIL).single();
  expect(rae).toMatchObject({ role: "stylist", level: "senior" });
  expect(rae!.user_id).not.toBeNull();
  expect(rae!.staff_services.map((s) => s.service!.name).sort()).toEqual(["Blowout", "Women's Cut & Style"]);
  expect(rae!.staff_working_hours.some((h) => h.weekday === 1)).toBe(false);

  // Rae opens the invite and chooses a password.
  const link = await emailLink(EMAIL, "You're invited to Maestra", sent);
  const raePage = await signedOut(browser);
  await choosePassword(raePage, link, "a-new-password-1", "Welcome to Maestra");
  // A used link doesn't work again.
  const again = await signedOut(browser);
  await again.goto(link);
  await expect(again).toHaveURL("/login?link=expired");
  await expect(ui(again).getByText("That link has expired or was already used.")).toBeVisible();

  await page.reload();
  await expect(ui(page).getByRole("region", { name: "Login" })).toContainText("Signs in");
  await page.close();
});

test("someone leaving is deactivated: their history stays, they can't get in, and they can come back", async ({ browser }) => {
  const { data: rae } = await admin.from("staff").select("id").eq("email", EMAIL).single();
  const page = await browser.newPage({ storageState: AUTH.owner });
  await page.goto(`/team/${rae!.id}`);
  await waitForHydration(page, "section[aria-label=Leaving] button");
  const leaving = ui(page).getByRole("region", { name: "Leaving" });
  await leaving.getByRole("button", { name: `Deactivate ${TAG}Rae` }).click();
  await leaving.getByRole("group", { name: "Deactivate" }).getByRole("button", { name: "Deactivate" }).click();
  await expect(leaving).toContainText("Deactivated. Their history stays");
  expect((await admin.from("staff").select("is_active").eq("id", rae!.id).single()).data!.is_active).toBe(false);

  // Signing in now finds no salon.
  const raePage = await signedOut(browser);
  await raePage.goto("/login");
  await waitForHydration(raePage, "input[name=email]");
  await ui(raePage).getByLabel("Email").fill(EMAIL);
  await ui(raePage).getByLabel("Password").fill("a-new-password-1");
  await raePage.getByRole("button", { name: "Sign in" }).click();
  await expect(raePage.getByText(/not linked to a salon/i)).toBeVisible();

  await page.reload();
  await ui(page).getByRole("region", { name: "Leaving" }).getByRole("button", { name: `Reactivate ${TAG}Rae` }).click();
  await expect(ui(page).getByRole("region", { name: "Leaving" })).toContainText("Reactivated.");
  await page.close();
});

test("Forgot password? and an owner's reset send a link to choose a new password", async ({ browser }) => {
  const page = await signedOut(browser);
  await page.goto("/login");
  await ui(page).getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  await waitForHydration(page, "input[name=email]");
  let sent = Date.now();
  await ui(page).getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(ui(page).getByText(`If ${EMAIL} has a Maestra login, we've sent it a link`)).toBeVisible();
  await choosePassword(page, await emailLink(EMAIL, "Choose your Maestra password", sent), "another-password-2", "Choose a new password");

  // The same answer for an email with no login.
  const nobody = await signedOut(browser);
  await nobody.goto("/login/forgot");
  await waitForHydration(nobody, "input[name=email]");
  await ui(nobody).getByLabel("Email").fill(`${TAG}-nobody@example.test`);
  await nobody.getByRole("button", { name: "Send the link" }).click();
  await expect(ui(nobody).getByText("has a Maestra login, we've sent it a link")).toBeVisible();

  // An owner sends one from the member's page.
  const { data: rae } = await admin.from("staff").select("id").eq("email", EMAIL).single();
  const owner = await browser.newPage({ storageState: AUTH.owner });
  await owner.goto(`/team/${rae!.id}`);
  await waitForHydration(owner, "section[aria-label=Login] button");
  sent = Date.now();
  await ui(owner).getByRole("region", { name: "Login" }).getByRole("button", { name: "Send a password reset" }).click();
  await expect(ui(owner).getByRole("region", { name: "Login" }).getByRole("status")).toHaveText(`Sent ${TAG}Rae a link to choose a new password.`);
  expect(await emailLink(EMAIL, "Choose your Maestra password", sent)).toContain("type=recovery");
  await owner.close();
});

test.describe("roles", () => {
  test("a manager adds people but can't open an owner or make one", async ({ browser }) => {
    // Five whole pages, one after another.
    test.slow();
    const page = await browser.newPage({ storageState: AUTH.manager });
    await page.goto("/team");
    await expect(ui(page).getByRole("link", { name: "Add team member" })).toBeVisible();
    await page.goto(`/team/${SEED.staff.owner}`);
    await expect(page).toHaveURL("/team");
    await page.goto("/team/new");
    await waitForHydration(page, "select[name=role]");
    await expect(ui(page).getByLabel("Role").locator("option")).toHaveText(["Manager", "Front desk", "Stylist", "Assistant"]);
    // Their own role is fixed, and there's no reset for them to send.
    await page.goto(`/team/${SEED.staff.manager}`);
    await expect(ui(page).getByLabel("Role")).toBeDisabled();
    await expect(ui(page).getByRole("region", { name: "Leaving" })).toContainText("You can't deactivate yourself.");
    await page.goto(`/team/${SEED.staff.bridget}`);
    await expect(ui(page).getByRole("button", { name: "Send a password reset" })).toHaveCount(0);
    await page.close();
  });

  test("the front desk sees the directory only", async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH.frontDesk });
    await page.goto("/team");
    await expect(ui(page).getByRole("link", { name: "Add team member" })).toHaveCount(0);
    await page.goto("/team/new");
    await expect(page).toHaveURL("/team");
    await page.close();
  });
});
