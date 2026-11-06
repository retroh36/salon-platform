import { expect, test, waitForHydration } from "./fixtures";
import { admin, SEED } from "../tests/db/helpers";

// A client's gift cards in their own account, on a phone: adding one by
// its code (not one in someone else's account), and reloading it with a
// card (test cards: a declined one first, then one that works), recorded
// as a sale paid by card online.

const SLUG = "maple-and-ash";
const B = SEED.business;
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: { cookies: [], origins: [] } });

const PREFIX = `Ag${Date.now().toString(36).replace(/\d/g, (d) => "abcdefghij"[Number(d)])}`;
const CODE = `${PREFIX}CARD7Q`.toUpperCase();
const TAKEN = `${PREFIX}OTHR7Q`.toUpperCase();
let client: { id: string; first_name: string; email: string };
let other: string;
const cards: string[] = [];

test.beforeAll(async () => {
  const email = `${PREFIX.toLowerCase()}@example.test`;
  const { data } = await admin
    .from("clients")
    .insert([
      { business_id: B, first_name: `${PREFIX}Ida`, last_name: "Test", email },
      { business_id: B, first_name: `${PREFIX}Other`, last_name: "Test" },
    ])
    .select("id, first_name, email");
  client = data![0] as typeof client;
  other = data![1].id;
  const { data: made } = await admin
    .from("gift_cards")
    .insert([
      { business_id: B, code: CODE, kind: "purchased", initial_cents: 2500, balance_cents: 2500, physical: true },
      { business_id: B, code: TAKEN, kind: "purchased", initial_cents: 2500, balance_cents: 2500, physical: true, client_id: other },
    ])
    .select("id");
  cards.push(...made!.map((c) => c.id));
  await admin.from("rate_limits").delete().neq("key", "");
});

test.afterAll(async () => {
  const { data: items } = await admin.from("sale_items").select("sale_id").in("gift_card_id", cards);
  await admin.from("sales").delete().in("id", (items ?? []).map((i) => i.sale_id));
  await admin.from("gift_card_events").delete().in("card_id", cards);
  await admin.from("gift_cards").delete().in("id", cards);
  await admin.from("client_accounts").delete().eq("client_id", client.id);
  await admin.from("clients").delete().in("id", [client.id, other]);
});

test("adds a gift card by its code and reloads it with a card", async ({ page }) => {
  await page.goto(`/book/${SLUG}/account`);
  await waitForHydration(page, "form[aria-label='Sign in'] button[type=submit]");
  await page.getByLabel("Email").fill(client.email);
  await page.getByRole("button", { name: "Send my code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  const { data: sent } = await admin.from("outbox_messages").select("body").eq("to_address", client.email).order("created_at", { ascending: false }).limit(1).single();
  await page.getByLabel("6-digit code").fill(/code is (\d{6})/.exec(sent!.body)![1]);
  await page.getByRole("button", { name: "Sign in" }).click();

  const account = page.getByTestId("client-account");
  await expect(account.getByText("No gift cards or packages yet.")).toBeVisible();
  // Someone else's card isn't added.
  await account.getByRole("button", { name: "Add a gift card" }).click();
  const form = account.getByRole("form", { name: "Add a gift card" });
  await form.getByLabel("Gift card code").fill(TAKEN);
  await form.getByRole("button", { name: "Add card" }).click();
  await expect(form).toContainText("That gift card is already in another account.");
  // Theirs is, typed with spaces and in lower case.
  await form.getByLabel("Gift card code").fill(CODE.toLowerCase().replace(/(.{4})/g, "$1 "));
  await form.getByRole("button", { name: "Add card" }).click();
  await expect(account).toContainText("Added. It has $25 on it.");
  const balances = account.getByTestId("balances");
  await expect(balances).toContainText(`Gift card ending ${CODE.slice(-4)}`);
  await expect(balances).toContainText("$25");

  await balances.getByRole("link", { name: `Reload the gift card ending ${CODE.slice(-4)}` }).click();
  await waitForHydration(page, "form[aria-label='Reload'] button[type=submit]");
  await expect(page.getByRole("heading", { name: "Reload your gift card" })).toBeVisible();
  await page.getByRole("button", { name: "$100" }).click();
  await page.getByTestId("test-card").selectOption({ label: "Visa …0002 (declined)" });
  await page.getByRole("button", { name: "Reload $100" }).click();
  await expect(page.getByRole("form", { name: "Reload" }).getByRole("alert")).toContainText("You haven't been charged; try another card.");
  await page.getByTestId("test-card").selectOption({ label: "Visa …4242 (always works)" });
  await page.getByRole("button", { name: "Reload $100" }).click();
  await expect(page.getByTestId("reloaded")).toContainText(`$100 added. Your gift card ending ${CODE.slice(-4)} now has $125.`);

  // A sale paid by card online, and the card's history.
  const { data: item } = await admin.from("sale_items").select("kind, total_cents, sale:sales(client_id, payments(method, processor, amount_cents))").eq("gift_card_id", cards[0]).single();
  expect(item).toMatchObject({ kind: "gift_card_reload", total_cents: 10000, sale: { client_id: client.id, payments: [{ method: "card", amount_cents: 10000 }] } });
  expect(item!.sale.payments[0].processor).toBeTruthy();
  const { data: events } = await admin.from("gift_card_events").select("kind").eq("card_id", cards[0]).order("created_at");
  expect(events!.map((e) => e.kind)).toEqual(["added", "reloaded"]);

  await page.getByRole("link", { name: "Back to your account" }).click();
  await expect(page.getByTestId("balances")).toContainText("$125");
});
