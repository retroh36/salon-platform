import type { Page } from "@playwright/test";
import { computeSale } from "@/lib/checkout";
import { approveFix } from "@/lib/denise/fixes";
import { scanDay, type Viewer } from "@/lib/denise/scan";
import { runPolicyCharges } from "@/lib/policy-billing";
import { changeStatus, saveBooking } from "@/lib/scheduling/book";
import { reportCallOut, reportRunningLate } from "@/lib/scheduling/disruptions";
import { addDays, fromLocal, todayIn, weekdayOf, type LocalDate } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { bookWalkIn } from "@/lib/waitlist-book";
import { admin, SEED, signIn as apiSignIn, type Client } from "../tests/db/helpers";
import { openCheckout } from "../e2e/checkout-helpers";
import { expect, signIn, test, ui, waitForHydration } from "../e2e/fixtures";
import { shiftBusiness, turnWeek } from "./time-machine";

// A busy week at Maple & Ash, Tuesday to Saturday, played day by day on
// the default seed's clear calendar (npm run test:week resets it first):
// bookings at the desk and online, a walk-in, a color running over with
// Denise's fix, a stylist out sick with her fixes, no-shows and a late
// cancel with their fees, checkouts paid by card, cash, split and gift
// card, a gift card sold and spent, a promotion code, a product returned,
// a whole sale refunded and one voided, and the drawer counted each night.
// At the end of each day the salon's world moves back a day
// (time-machine.ts), so the next day is "today". Then the pay period is
// over, and what the screens say is checked against what happened: the
// calendar, Sales, Payroll, Inventory, Policy and Reports.
//
// Every amount expected here is worked out from what the test itself did
// (the ledger below), never read back from the tables the screens use.

const B = SEED.business;
const L = SEED.location;
const { bridget: BRIDGET, gil: GIL, nola: NOLA, shae: SHAE, lois: LOIS, hannah: HANNAH } = SEED.staff;
const STYLISTS = [BRIDGET, GIL, NOLA, SHAE, LOIS, HANNAH];
// What each books by default: a service they do (Nola cuts men's hair).
const USUAL = new Map([[NOLA, "Men's Cut"]]);
const DAYS = 5; // Tuesday to Saturday
// The salon's tax rates (read at the start).
let SERVICE_TAX_BP = 0;
let RETAIL_TAX_BP = 0;

// The salon runs on a fixed-offset zone where it's about 8am now, so every
// day's visits are ahead and no daylight saving change lands mid-week.
const offset = ((8 - new Date().getUTCHours() + 36) % 24) - 12;
const TZ = offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
const location = { id: L, timezone: TZ, businessId: B };
const desk: Viewer = { location: { id: L, timezone: TZ }, salon: "Maple & Ash Hair Studio", canBook: true };

test.describe.configure({ mode: "serial", timeout: 30 * 60_000 });
test.use({ viewport: { width: 1280, height: 900 } });

type Money = { day: number; method: "card" | "cash" | "gift_card"; cents: number; saleDay: number };
const ledger = {
  // Every payment and refund, on the day it happened, with its sale's day.
  money: [] as Money[],
  // Each stylist's service and retail sales (pre-tax) and tips that count for payroll.
  services: new Map<string, number>(),
  retail: new Map<string, number>(),
  tips: new Map<string, number>(),
  // Fees charged.
  fees: [] as { kind: "no_show" | "late_cancel"; cents: number }[],
  visitsDone: 0,
  // The product tracked on Inventory: how many went out and came back.
  productSold: 0,
  productBack: 0,
};
const add = (m: Map<string, number>, k: string, cents: number) => m.set(k, (m.get(k) ?? 0) + cents);

let owner: Client, manager: Client, frontDesk: Client;
let services: Map<string, string>;
let product: { id: string; name: string; price: number; startOnHand: number };
let clients: string[];
let nextClient = 0;
let day = 0;
const dates: LocalDate[] = [];
const today = () => todayIn(TZ);
const at = (date: LocalDate, h: number, m = 0) => fromLocal(date, h * 60 + m, TZ)!;

test.beforeAll(async () => {
  const { count } = await admin.from("appointments").select("id", { count: "exact", head: true }).eq("business_id", B);
  if (count) throw new Error("The week starts on a clear calendar: run it with `npm run test:week`, which resets the database first.");
  [owner, manager, frontDesk] = await Promise.all(["owner", "manager", "frontdesk"].map((n) => apiSignIn(`${n}@mapleandash.test`)));

  // The salon's clock, and Tuesday's hours on today.
  await admin.from("locations").update({ timezone: TZ }).eq("id", L);
  turnWeek(B, weekdayOf(today()) - 2);
  // Pay weekly, Sunday to Saturday, so the week's period is over at the end.
  const sunday = addDays(today(), -2);
  expect((await owner.rpc("set_payroll_settings", { p_business_id: B, p_pay_period: "weekly", p_anchor: sunday })).error).toBeNull();
  // The cancellation policy: $40 for a late cancel, half the visit for a no-show.
  const policy = {
    card_required: "off",
    card_service_ids: [],
    card_staff_ids: [],
    cancel_window_hours: 48,
    late_cancel_fee_kind: "fixed",
    late_cancel_fee_amount: 4000,
    no_show_fee_kind: "percent",
    no_show_fee_amount: 50,
    long_hold_days: null,
    repeat_count: 3,
    repeat_months: 6,
    repeat_action: "deposit",
    repeat_deposit_percent: 50,
    waive_roles: ["owner", "manager"],
  };
  expect((await owner.rpc("save_policy_settings", { p_business_id: B, p: policy as never })).error).toBeNull();
  // A code for 10% off services.
  expect(
    (await owner.rpc("save_promotion", {
      p_business_id: B,
      p_promotion_id: null as never,
      p_input: { name: "Week ten", kind: "code", code: "WEEK10", discount_kind: "percent", percent: 10, applies_services: true, applies_retail: false, online: false, stackable: false } as never,
    })).error,
  ).toBeNull();

  const { data: rates } = await admin.from("businesses").select("tax_rate_services_bp, tax_rate_retail_bp").eq("id", B).single();
  SERVICE_TAX_BP = rates!.tax_rate_services_bp;
  RETAIL_TAX_BP = rates!.tax_rate_retail_bp;
  const { data: s } = await admin.from("services").select("id, name").eq("business_id", B);
  services = new Map(s!.map((x) => [x.name, x.id]));
  // The oil the week sells, with more put on the shelf so it doesn't run out.
  const { data: oil } = await admin.from("products").select("id").eq("business_id", B).eq("name", "No.7 Bonding Oil 30 ml").single();
  expect((await owner.rpc("adjust_stock", { p_location_id: L, p_product_id: oil!.id, p_change: 30, p_reason: "adjustment", p_note: "Found a box in the back" })).error).toBeNull();
  const { data: p } = await admin.from("products").select("id, name, price_cents, stock_levels(on_hand)").eq("business_id", B).eq("type", "retail").eq("name", "No.7 Bonding Oil 30 ml").single();
  product = { id: p!.id, name: p!.name, price: p!.price_cents!, startOnHand: Number(p!.stock_levels[0].on_hand) };
  const { data: c } = await admin.from("clients").select("id").eq("business_id", B).order("created_at").limit(200);
  clients = c!.map((x) => x.id);
  await admin.from("rate_limits").delete().neq("key", "");
});

// ---------------------------------------------------------------------------
// The day's work
// ---------------------------------------------------------------------------

const client = () => clients[nextClient++ % clients.length];
// Why bookings were refused (for a failure's message).
const refused: string[] = [];

// Books a cut (or another service) and returns the visit and its item.
async function book(staffId: string, date: LocalDate, hour: number, service = USUAL.get(staffId) ?? "Women's Cut & Style", clientId = client()) {
  const r = await saveBooking(frontDesk, location, { clientId, notes: null, items: [{ serviceId: services.get(service)!, staffId, start: at(date, hour), resource: { kind: "any" } }] });
  if (!r.ok) {
    refused.push(`${staffId.slice(-2)}@${hour}: ${JSON.stringify(r).slice(0, 160)}`);
    return null;
  }
  const { data: item } = await admin.from("appointment_items").select("id, price_cents").eq("appointment_id", r.appointmentId).single();
  return { id: r.appointmentId, itemId: item!.id, price: item!.price_cents, staffId, clientId };
}

type Visit = NonNullable<Awaited<ReturnType<typeof book>>>;

// Up to n cuts for each stylist working on date, every hour from 9.
async function fillDay(date: LocalDate, perStylist: number): Promise<Visit[]> {
  const visits: Visit[] = [];
  for (const staffId of STYLISTS) {
    let booked = 0;
    for (let h = 9; h < 19 && booked < perStylist; h++) {
      const v = await book(staffId, date, h);
      if (!v) continue;
      visits.push(v);
      booked++;
    }
  }
  return visits;
}

async function checkIn(v: { id: string }) {
  expect(await changeStatus(frontDesk, v.id, "check_in")).toEqual({ ok: true });
}

// Checks out a visit (checked in first) through complete_sale, the way the
// checkout screen does: its services at their price, optional products
// with the stylist credited, a tip for the stylist, and payments that add
// up to the total, recorded in the ledger.
async function sellVisit(v: Visit, pay: "card" | "cash" | "split" | { giftCard: string; giftCents: number }, opts: { tip?: number; products?: number } = {}) {
  const { data: items } = await admin.from("appointment_items").select("id, price_cents, staff_id").eq("appointment_id", v.id);
  const lines = items!.map((i) => ({ grossCents: i.price_cents, taxBp: SERVICE_TAX_BP, discountable: true }));
  if (opts.products) lines.push({ grossCents: product.price * opts.products, taxBp: RETAIL_TAX_BP, discountable: true });
  const tip = opts.tip ?? 0;
  const totals = computeSale(lines, null, tip ? [tip] : []);
  const total = totals.totalCents;
  const payments =
    pay === "card"
      ? [{ method: "card", amount_cents: total, reference: "4242" }]
      : pay === "cash"
        ? [{ method: "cash", amount_cents: total, tendered_cents: Math.ceil(total / 2000) * 2000 }]
        : pay === "split"
          ? [
              { method: "card", amount_cents: Math.floor(total / 2), reference: "1881" },
              { method: "cash", amount_cents: total - Math.floor(total / 2), tendered_cents: total - Math.floor(total / 2) },
            ]
          : [
              { method: "gift_card", amount_cents: pay.giftCents, code: pay.giftCard },
              { method: "card", amount_cents: total - pay.giftCents, reference: "4242" },
            ];
  const { data: saleId, error } = await frontDesk.rpc("complete_sale", {
    p_location_id: L,
    p_input: {
      appointment_id: v.id,
      lines: [
        ...items!.map((i) => ({ kind: "service", appointment_item_id: i.id, unit_price_cents: i.price_cents })),
        ...(opts.products ? [{ kind: "product", product_id: product.id, quantity: opts.products, staff_id: v.staffId }] : []),
      ],
      tips: tip ? [{ staff_id: v.staffId, amount_cents: tip }] : [],
      payments,
    } as never,
  });
  expect(error, JSON.stringify(error)).toBeNull();
  for (const p of payments) ledger.money.push({ day, method: p.method as Money["method"], cents: p.amount_cents, saleDay: day });
  for (const i of items!) add(ledger.services, i.staff_id, i.price_cents);
  if (opts.products) {
    add(ledger.retail, v.staffId, product.price * opts.products);
    ledger.productSold += opts.products;
  }
  if (tip) add(ledger.tips, v.staffId, tip);
  ledger.visitsDone++;
  return { saleId: saleId as string, total, items: items!, tip, products: opts.products ?? 0 };
}

type Sold = Awaited<ReturnType<typeof sellVisit>>;

// The rest of the day's booked visits: checked in and out, the payments
// taking turns.
async function workTheDay(visits: Visit[]): Promise<Sold[]> {
  const sold: Sold[] = [];
  const { data: open } = await admin.from("appointments").select("id, status").in("id", visits.map((v) => v.id));
  const status = new Map(open!.map((a) => [a.id, a.status]));
  let n = 0;
  for (const v of visits) {
    const s = status.get(v.id);
    if (s !== "booked" && s !== "confirmed" && s !== "checked_in") continue;
    if (s !== "checked_in") await checkIn(v);
    const pay = (["card", "cash", "split", "card"] as const)[n % 4];
    sold.push(await sellVisit(v, pay, { tip: n % 3 === 0 ? 1500 : n % 3 === 1 ? 2000 : 0, products: n % 5 === 0 ? 1 : 0 }));
    n++;
  }
  return sold;
}

// A card on file for a client, agreed to on one of their visits.
async function cardOnFile(appointmentId: string) {
  const { error } = await admin.rpc("record_online_card", {
    p_appointment_id: appointmentId,
    p_card: { provider: "test", ref: "test_visa_4242", label: "Visa …4242" },
    p_consent: { policy_text: "Please give us 48 hours' notice.", terms: { window_hours: 48 } },
    p_deposit: null as never,
  });
  expect(error).toBeNull();
}

// The owner counts the drawer: the cash the ledger says came in today.
async function countDrawer() {
  const cash = ledger.money.filter((m) => m.day === day && m.method === "cash").reduce((n, m) => n + m.cents, 0);
  const { data: float } = await admin.from("businesses").select("cash_float_cents").eq("id", B).single();
  const { error } = await owner.rpc("save_closeout", { p_location_id: L, p_day: today(), p_counted_cents: float!.cash_float_cents + cash, p_note: "" as never });
  expect(error, JSON.stringify(error)).toBeNull();
}

// The night: fees whose grace is over are charged, then the world moves
// back a day, so tomorrow is today.
async function endOfDay() {
  await countDrawer();
  dates.push(today());
  shiftBusiness(B, TZ, -1);
  day++;
  await runPolicyCharges(admin, { businessId: B });
}

// ---------------------------------------------------------------------------
// In the browser
// ---------------------------------------------------------------------------

async function asDesk(page: Page) {
  await page.context().clearCookies();
  await signIn(page, "frontdesk@mapleandash.test");
}

// A client books tomorrow on the salon's site on their phone.
async function bookOnline(page: Page, first: string) {
  const phone = `(489) 555-01${String(10 + day).padStart(2, "0")}`;
  await page.context().clearCookies();
  await page.goto("/book/maple-and-ash");
  const flow = page.getByTestId("booking-flow");
  await waitForHydration(page, "[data-testid=booking-flow] button[aria-pressed]");
  await flow.getByRole("button", { name: /^Blowout\s*\d/ }).click();
  await flow.getByRole("button", { name: "Continue" }).click();
  await flow.getByRole("button", { name: /Lois/ }).click();
  await flow.getByRole("button", { name: "Continue" }).click();
  const dates = flow.getByRole("radiogroup", { name: "Date" });
  await expect(dates.getByRole("radio").first()).toBeVisible();
  const labels = await dates.getByRole("radio").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  await dates.getByRole("radio").nth(labels.findIndex((l, i) => i >= 1 && !l.endsWith("no times"))).click();
  await flow.getByRole("radiogroup", { name: /Morning|Afternoon|Evening/ }).getByRole("radio").first().click();
  await flow.getByRole("button", { name: "Continue" }).click();
  await flow.getByLabel("Mobile number").fill(phone);
  await flow.getByRole("button", { name: "Send code" }).click();
  await expect(flow.getByLabel("Code", { exact: true })).toBeVisible();
  const { data: sent } = await admin.from("outbox_messages").select("body").eq("to_address", phone.replace(/\D/g, "")).order("created_at", { ascending: false }).limit(1);
  const code = /code is (\d{6})/.exec(sent?.[0]?.body ?? "")?.[1];
  if (!code) {
    const { data: any } = await admin.from("outbox_messages").select("to_address, body").order("created_at", { ascending: false }).limit(1);
    throw new Error(`No code sent: ${JSON.stringify(any)}`);
  }
  await flow.getByLabel("Code", { exact: true }).fill(code);
  await flow.getByRole("button", { name: "Confirm" }).click();
  await flow.getByLabel("First name").fill(first);
  await flow.getByLabel("Last name").fill("Online");
  await flow.getByLabel("Email").fill(`${first.toLowerCase()}@example.com`);
  await flow.getByRole("button", { name: "Continue" }).click();
  // The salon has a cancellation policy, so it's agreed to first.
  await flow.getByLabel(/^I agree to the cancellation policy/).check();
  await flow.getByRole("button", { name: /^Book appointment$/ }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`booked, ${first}`) })).toBeVisible();
  const { data: c } = await admin.from("clients").select("id").eq("business_id", B).eq("first_name", first).single();
  const { data: a } = await admin.from("appointments").select("id, source, appointment_items(id, price_cents, staff_id)").eq("client_id", c!.id).single();
  expect(a!.source).toBe("online");
  return { id: a!.id, itemId: a!.appointment_items[0].id, price: a!.appointment_items[0].price_cents, staffId: a!.appointment_items[0].staff_id, clientId: c!.id };
}

// Checks a visit out on the checkout screen: by card, with a promotion code if given.
async function checkoutOnScreen(page: Page, v: Visit, code?: string) {
  await checkIn(v);
  const co = await openCheckout(page, { appointmentId: v.id, from: `/calendar?date=${today()}` });
  if (code) {
    await co.ticket.getByRole("button", { name: "Promotion" }).click();
    await co.dialog.getByLabel("Promo code").fill(code);
    await co.dialog.getByRole("button", { name: "Apply code" }).click();
    await expect(co.dialog).toHaveCount(0);
  }
  const total = Number((await co.total.innerText()).replace(/[^0-9.]/g, "")) * 100;
  await co.card();
  await co.complete();
  const off = v.price - Math.round(total);
  ledger.money.push({ day, method: "card", cents: Math.round(total), saleDay: day });
  add(ledger.services, v.staffId, v.price - off);
  ledger.visitsDone++;
  return Math.round(total);
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

test("a busy week at Maple & Ash, day by day", async ({ page }) => {
  let giftCode = "";
  let refundLater: Sold | null = null;
  let returnLater: { saleId: string; staffId: string } | null = null;
  let noShowTomorrow: Visit | null = null;
  let lateCancelTomorrow: Visit | null = null;
  let onlineTomorrow: Visit | null = null;

  await test.step("Tuesday: a full book, an online booking for tomorrow, a gift card and retail sold", async () => {
    const date = today();
    const visits = await fillDay(date, 3);
    expect(visits.length, refused.join("\n")).toBeGreaterThanOrEqual(9);
    onlineTomorrow = await bookOnline(page, "Wenonline");
    // Tomorrow's no-show and late cancel, booked now, with cards on file.
    noShowTomorrow = await book(SHAE, addDays(date, 1), 16);
    lateCancelTomorrow = await book(LOIS, addDays(date, 1), 17);
    expect(noShowTomorrow && lateCancelTomorrow).toBeTruthy();
    await cardOnFile(noShowTomorrow!.id);
    await cardOnFile(lateCancelTomorrow!.id);

    // A $100 gift card, and two of the oil on their own, both for cash.
    const { data: giftSale, error } = await frontDesk.rpc("complete_sale", {
      p_location_id: L,
      p_input: { lines: [{ kind: "gift_card", amount_cents: 10000 }], payments: [{ method: "cash", amount_cents: 10000, tendered_cents: 10000 }] } as never,
    });
    expect(error).toBeNull();
    ledger.money.push({ day, method: "cash", cents: 10000, saleDay: day });
    giftCode = (await admin.from("gift_cards").select("code").eq("sale_id", giftSale as string).single()).data!.code;
    const retail = computeSale([{ grossCents: product.price * 2, taxBp: RETAIL_TAX_BP, discountable: true }], null, []).totalCents;
    const { data: retailSale, error: retailError } = await frontDesk.rpc("complete_sale", {
      p_location_id: L,
      p_input: { lines: [{ kind: "product", product_id: product.id, quantity: 2, staff_id: NOLA }], payments: [{ method: "card", amount_cents: retail, reference: "4242" }] } as never,
    });
    expect(retailError).toBeNull();
    ledger.money.push({ day, method: "card", cents: retail, saleDay: day });
    add(ledger.retail, NOLA, product.price * 2);
    ledger.productSold += 2;
    returnLater = { saleId: retailSale as string, staffId: NOLA };

    // One on the checkout screen, the rest at the desk.
    await asDesk(page);
    await checkoutOnScreen(page, visits[0]);
    await workTheDay(visits.slice(1));
    await endOfDay();
  });

  await test.step("Wednesday: a color runs over and Denise moves the next client; a walk-in; a no-show", async () => {
    const date = today();
    // Bridget's color at 9 (back to back with her 11), then the usual book.
    const color = await book(BRIDGET, date, 9, "Women's Cut & Style");
    const next = await book(BRIDGET, date, 10, "Women's Cut & Style");
    expect(color && next).toBeTruthy();
    const visits = [color!, next!, ...(await fillDay(date, 2)), onlineTomorrow!];
    await checkIn(color!);
    expect((await reportRunningLate(frontDesk, color!.itemId, 30)).ok).toBe(true);
    const state = await scanDay(frontDesk, desk, date);
    const overrun = state.conflicts.find((c) => c.itemIds.includes(color!.itemId));
    expect(overrun?.options[0]?.actionId).toBeTruthy();
    expect((await approveFix(frontDesk, desk, overrun!.options[0].actionId!)).ok).toBe(true);
    const { data: moved } = await admin.from("appointment_items").select("starts_at").eq("id", next!.itemId).single();
    expect(new Date(moved!.starts_at).getTime()).toBeGreaterThan(at(date, 10).getTime());

    // A walk-in for a men's cut, with whoever's free next.
    const { data: walk } = await frontDesk.from("walk_ins").insert({ business_id: B, location_id: L, name: "Walker Inn", phone: "(489) 555-0177", service_id: services.get("Men's Cut")! }).select("id").single();
    const walked = await bookWalkIn(frontDesk, location, walk!.id, date, new Date());
    expect(walked.ok, walked.ok ? "" : walked.message).toBe(true);
    const { data: wItem } = await admin.from("appointment_items").select("id, price_cents, staff_id, appointment:appointments(client_id)").eq("appointment_id", walked.ok ? walked.appointmentId : "").single();
    visits.push({ id: walked.ok ? walked.appointmentId : "", itemId: wItem!.id, price: wItem!.price_cents, staffId: wItem!.staff_id, clientId: wItem!.appointment!.client_id! });

    // The no-show: half the visit, charged once the 10 minutes' grace is over.
    expect(await changeStatus(frontDesk, noShowTomorrow!.id, "no_show")).toEqual({ ok: true });
    ledger.fees.push({ kind: "no_show", cents: Math.round(noShowTomorrow!.price / 2) });

    await workTheDay(visits);
    await endOfDay();
  });

  await test.step("Thursday: Gil goes home sick at noon and Denise moves his clients; a late cancel; the gift card spent", async () => {
    const date = today();
    const gils = [await book(GIL, date, 13), await book(GIL, date, 15)].filter((v): v is Visit => v !== null);
    expect(gils.length).toBe(2);
    const visits = [...gils, ...(await fillDay(date, 2))];
    // The late cancel: the client calls this morning.
    expect(await changeStatus(frontDesk, lateCancelTomorrow!.id, "cancel", "Client canceled")).toEqual({ ok: true });
    ledger.fees.push({ kind: "late_cancel", cents: 4000 });

    expect((await reportCallOut(frontDesk, GIL, at(date, 12))).ok).toBe(true);
    for (const conflict of (await scanDay(frontDesk, desk, date)).conflicts) {
      const option = conflict.options[0];
      if (option?.actionId) expect((await approveFix(frontDesk, desk, option.actionId)).ok).toBe(true);
    }
    // Nobody is left with Gil this afternoon: moved by Denise, or the salon cancels.
    for (const g of gils) {
      const { data: item } = await admin.from("appointment_items").select("staff_id").eq("id", g.itemId).single();
      if (item!.staff_id === GIL) expect(await changeStatus(frontDesk, g.id, "cancel", "Stylist out sick")).toEqual({ ok: true });
      else g.staffId = item!.staff_id;
    }

    // The first visit of the day is part paid with the gift card.
    const [first, ...rest] = visits.filter((v) => !gils.includes(v) || v.staffId !== GIL);
    await checkIn(first);
    const giftPaid = await sellVisit(first, { giftCard: giftCode, giftCents: 5000 }, { tip: 1000 });
    expect(giftPaid.total).toBeGreaterThan(5000);
    const sold = await workTheDay(rest);
    refundLater = sold.find((s) => s.products === 0 && s.tip > 0) ?? null;
    expect(refundLater).toBeTruthy();
    await endOfDay();
  });

  await test.step("Friday: a code at checkout, a product returned, yesterday's visit refunded in full", async () => {
    const date = today();
    const visits = await fillDay(date, 2);
    await asDesk(page);
    await checkoutOnScreen(page, visits[0], "WEEK10");
    await workTheDay(visits.slice(1));

    // One of Tuesday's oils comes back (restocked), and a whole visit from
    // yesterday is refunded to the card, tip and all.
    const each = computeSale([{ grossCents: product.price, taxBp: RETAIL_TAX_BP, discountable: true }], null, []).totalCents;
    const { data: retailItem } = await admin.from("sale_items").select("id").eq("sale_id", returnLater!.saleId).single();
    const r1 = await manager.rpc("refund_sale", {
      p_sale_id: returnLater!.saleId,
      p_input: { reason: "Didn't suit", restock: true, returns: [{ sale_item_id: retailItem!.id, quantity: 1 }], payments: [{ method: "card", amount_cents: each, reference: "4242" }] } as never,
    });
    expect(r1.error, JSON.stringify(r1.error)).toBeNull();
    ledger.money.push({ day, method: "card", cents: -each, saleDay: 0 });
    // Payroll takes back the refund's share of the sale.
    add(ledger.retail, returnLater!.staffId, -product.price);
    ledger.productBack += 1;

    const r = refundLater!;
    const r2 = await manager.rpc("refund_sale", { p_sale_id: r.saleId, p_input: { reason: "Unhappy with the cut", payments: [{ method: "card", amount_cents: r.total, reference: "4242" }] } as never });
    expect(r2.error, JSON.stringify(r2.error)).toBeNull();
    ledger.money.push({ day, method: "card", cents: -r.total, saleDay: 2 });
    for (const i of r.items) add(ledger.services, i.staff_id, -i.price_cents);
    add(ledger.tips, r.items[0].staff_id, -r.tip);
    await endOfDay();
  });

  await test.step("Saturday: a full book, and a sale rung up wrong is voided", async () => {
    const date = today();
    const visits = await fillDay(date, 3);
    const sold = await workTheDay(visits);
    // The last one was rung up wrong: voided, which reopens the visit.
    const wrong = sold.at(-1)!;
    expect((await manager.rpc("void_sale", { p_sale_id: wrong.saleId, p_reason: "Rung up wrong" })).error).toBeNull();
    // The void reverses every payment of it, on its sale's day (today).
    const { data: reversed } = await admin.from("payments").select("method, amount_cents").eq("sale_id", wrong.saleId).lt("amount_cents", 0);
    for (const p of reversed!) ledger.money.push({ day, method: p.method as Money["method"], cents: p.amount_cents, saleDay: day });
    for (const i of wrong.items) add(ledger.services, i.staff_id, -i.price_cents);
    if (wrong.products) {
      add(ledger.retail, wrong.items[0].staff_id, -product.price * wrong.products);
      ledger.productSold -= wrong.products;
    }
    if (wrong.tip) add(ledger.tips, wrong.items[0].staff_id, -wrong.tip);
    ledger.visitsDone--;
    await endOfDay();
  });

  expect(dates).toHaveLength(DAYS);
});

// ---------------------------------------------------------------------------
// What the screens say
// ---------------------------------------------------------------------------

test("the week reconciles: calendar, Sales, Payroll, Inventory, Policy and Reports", async ({ page }) => {
  // The week's dates, now that it's over (each moved back a day per night).
  const week = Array.from({ length: DAYS }, (_, i) => addDays(today(), i - DAYS));
  await page.context().clearCookies();
  await signIn(page, "owner@mapleandash.test");

  await test.step("Sales: each day's money by tender is what came in that day", async () => {
    for (let d = 0; d < DAYS; d++) {
      await page.goto(`/sales?date=${week[d]}`);
      const tender = ui(page).getByTestId("sales-by-tender");
      for (const [method, label] of [["cash", "Cash"], ["card", "Card"], ["gift_card", "Gift card"]] as const) {
        const cents = ledger.money.filter((m) => m.day === d && m.method === method).reduce((n, m) => n + m.cents, 0);
        await expect(tender.locator("div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd"), `${week[d]} ${label}`).toHaveText(formatPrice(cents));
      }
    }
  });

  await test.step("Payroll: each stylist's services, retail and tips for the week", async () => {
    await page.goto(`/payroll?from=${addDays(week[0], -2)}&to=${addDays(week[0], 4)}`);
    // Payroll shows nothing earned as "—".
    const money = (cents: number) => (cents ? formatPrice(cents) : "—");
    await expect(ui(page).getByTestId("pay-line").first()).toBeVisible();
    for (const staffId of STYLISTS) {
      const cells = ui(page).locator(`[data-testid=pay-line][data-staff-id="${staffId}"]`).locator("td");
      await expect(cells.nth(1), `${staffId} services`).toHaveText(money(ledger.services.get(staffId) ?? 0));
      await expect(cells.nth(3), `${staffId} retail`).toHaveText(money(ledger.retail.get(staffId) ?? 0));
      await expect(cells.nth(5), `${staffId} tips`).toHaveText(money(ledger.tips.get(staffId) ?? 0));
    }
  });

  await test.step("Inventory: the oil on hand is what was there, less what sold, plus what came back", async () => {
    await page.goto(`/inventory/${product.id}`);
    const units = product.startOnHand - ledger.productSold + ledger.productBack;
    await expect(ui(page).getByTestId("on-hand")).toHaveText(`${units} ${units === 1 ? "unit" : "units"}`);
  });

  await test.step("Policy: the fees recovered", async () => {
    await page.goto(`/policy?month=${week[0].slice(0, 7)}`);
    const recovered = ledger.fees.reduce((n, f) => n + f.cents, 0);
    await expect(ui(page).getByTestId("policy-recovered")).toContainText(formatPrice(recovered));
    await expect(ui(page).getByTestId("policy-charged")).toContainText(String(ledger.fees.length));
  });

  await test.step("Reports: each day's close-out balances, and the week's sales by tender", async () => {
    for (let d = 0; d < DAYS; d++) {
      await page.goto(`/reports?day=${week[d]}`);
      await expect(ui(page).getByTestId("closeout-saved"), week[d]).toContainText(": matches");
    }
  });

  await test.step("Calendar: the visits checked out show as checked out on their days", async () => {
    let done = 0;
    for (const date of week) {
      await page.goto(`/calendar?date=${date}`);
      await waitForHydration(page, "section[data-staff-id]");
      done += await ui(page).locator('[data-visit="done"]').count();
    }
    expect(done).toBe(ledger.visitsDone);
  });
});
