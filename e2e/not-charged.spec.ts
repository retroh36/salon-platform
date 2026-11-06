import { notCharged, type Incident } from "@/lib/policy-report";
import { addDays, fromLocal, todayIn } from "@/lib/scheduling/time";
import { SEED, signIn as dbSignIn } from "../tests/db/helpers";
import { cents } from "../app/policy/money";
import { expect, signIn, test, ui } from "./fixtures";

// "Not charged, and why" from the Policy page: the demo's no-shows and late
// cancellations over a period, totals and reasons as the database gives
// them. Reads only, so nothing to put back.

const TZ = "America/Chicago";

async function expected(from: string, to: string) {
  const owner = await dbSignIn("owner@mapleandash.test");
  const { data, error } = await owner.rpc("policy_not_charged", {
    p_business_id: SEED.business,
    p_from: fromLocal(from, 0, TZ)!.toISOString(),
    p_to: fromLocal(addDays(to, 1), 0, TZ)!.toISOString(),
  });
  if (error) throw error;
  return notCharged(data.map((i): Incident => ({ kind: i.kind as Incident["kind"], visitCents: i.visit_cents, feeCents: i.fee_cents, collectedCents: i.collected_cents, status: i.status, waiveReason: i.waive_reason })));
}

test("an owner sees what wasn't charged over any dates, and why", async ({ page }) => {
  await signIn(page, "owner@mapleandash.test");
  await page.goto("/policy");
  await ui(page).getByTestId("policy-not-charged-link").click();
  await expect(page).toHaveURL(/\/policy\/not-charged\?from=/);
  const main = ui(page);
  await expect(main.getByRole("heading", { name: "Not charged, and why" })).toBeVisible();

  const today = todayIn(TZ);
  const from = addDays(today, -100);
  await main.getByLabel("From", { exact: true }).fill(from);
  await main.getByLabel("To", { exact: true }).fill(today);
  await main.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(new RegExp(`from=${from}&to=${today}`));

  const r = await expected(from, today);
  expect(r.incidents).toBeGreaterThan(0);
  await expect(main.getByTestId("miss-booked")).toHaveText(cents(r.visitCents));
  await expect(main.getByTestId("miss-collected")).toHaveText(cents(r.collectedCents));
  await expect(main.getByTestId("miss-not-charged")).toHaveText(cents(r.notChargedCents));
  const reasons = main.getByTestId("miss-reasons");
  for (const row of r.rows) {
    const tr = reasons.locator(`tr[data-reason="${row.reason}"]`);
    await expect(tr.locator("td").nth(1)).toHaveText(String(row.count));
    await expect(tr.locator("td").nth(2)).toHaveText(cents(row.visitCents));
  }
  // Staff's reasons for waiving, under Waived.
  const waived = r.rows.find((x) => x.reason === "waived");
  if (waived) await expect(reasons.locator("tr[data-waive-reason]")).toHaveCount(waived.reasons.length);
});

test("a bookkeeper reads the policy and its misses without client names", async ({ page }) => {
  await signIn(page, "books@mapleandash.test", "/reports");
  await page.goto("/policy");
  const main = ui(page);
  await expect(main.getByRole("heading", { name: "Cancellation policy" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Repeat offenders" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Try the card again" })).toHaveCount(0);
  const rows = main.getByTestId("policy-row");
  if (await rows.count()) await expect(rows.first().locator("td").first()).toHaveText("A client");
  await main.getByTestId("policy-not-charged-link").click();
  await expect(main.getByRole("heading", { name: "Not charged, and why" })).toBeVisible();
});
