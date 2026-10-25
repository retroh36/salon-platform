import { describe, expect, it } from "vitest";
import { openingIdeas, whenText, type Gap, type Regular } from "@/lib/promotion-ideas";
import {
  applyPromotions,
  NEW_PROMOTION,
  parsePromotionInput,
  promotionApplies,
  promotionInput,
  promotionProblem,
  promotionReport,
  promotionSummary,
  ruleOf,
  specialFor,
  specialMessage,
  stackingProblem,
  type PromoContext,
  type PromoLine,
  type PromoRule,
} from "@/lib/promotions";
import { EMPTY_TICKET, promotionProblems, totalsOf, type PromoRates, type Ticket, type TicketLine } from "@/lib/ticket";

const rule = (over: Partial<PromoRule> = {}): PromoRule => ({
  id: "p1",
  name: "Spring",
  kind: "code",
  code: "SPRING",
  discount: { kind: "percent", pct: 10 },
  services: true,
  retail: false,
  serviceIds: null,
  categories: null,
  staffIds: null,
  levels: null,
  exclusions: [],
  productIds: null,
  startsOn: null,
  endsOn: null,
  maxUses: null,
  maxPerClient: null,
  newClientsOnly: false,
  firstVisitOnly: false,
  minSpendCents: null,
  stackable: false,
  online: true,
  hoursAhead: null,
  ...over,
});

const cut: PromoLine = { kind: "service", serviceId: "cut", category: "Cuts", staffId: "gil", level: "master", cents: 10_000 };
const color: PromoLine = { kind: "service", serviceId: "color", category: "Color", staffId: "gil", level: "master", cents: 15_000 };
const seniorColor: PromoLine = { ...color, staffId: "lois", level: "senior" };
const shampoo: PromoLine = { kind: "product", productId: "shampoo", cents: 3_000 };

const ctx = (over: Partial<PromoContext> = {}): PromoContext => ({
  today: "2026-10-24",
  where: "checkout",
  uses: 0,
  clientUses: 0,
  client: { createdOn: "2026-10-01", visitedBefore: false },
  subtotalCents: 10_000,
  visit: null,
  ...over,
});

describe("what a promotion covers", () => {
  it("by service, category, stylist and level; retail only when it says", () => {
    expect(promotionApplies(rule(), cut)).toBe(true);
    expect(promotionApplies(rule(), shampoo)).toBe(false);
    expect(promotionApplies(rule({ retail: true }), shampoo)).toBe(true);
    expect(promotionApplies(rule({ retail: true, productIds: ["other"] }), shampoo)).toBe(false);
    expect(promotionApplies(rule({ categories: ["Color"] }), cut)).toBe(false);
    expect(promotionApplies(rule({ staffIds: ["lois"] }), cut)).toBe(false);
    expect(promotionApplies(rule({ levels: ["senior"] }), seniorColor)).toBe(true);
    expect(promotionApplies(rule({ serviceIds: ["color"] }), cut)).toBe(false);
  });

  it("never Master color: the pair, not each on its own", () => {
    const special = rule({ exclusions: [{ level: "master", category: "Color" }] });
    expect(promotionApplies(special, color)).toBe(false);
    expect(promotionApplies(special, cut)).toBe(true);
    expect(promotionApplies(special, seniorColor)).toBe(true);
    // A level alone rules out all their work.
    expect(promotionApplies(rule({ exclusions: [{ level: "master", category: null }] }), cut)).toBe(false);
  });
});

describe("what it takes off", () => {
  it("a percent of each line it covers", () => {
    expect(applyPromotions([rule({ discount: { kind: "percent", pct: 15 } })], [cut, shampoo])).toEqual({ perLine: [1500, 0], perPromotion: { p1: 1500 } });
  });

  it("an amount once, spread over lines in order until it's used up", () => {
    const off = rule({ discount: { kind: "amount", cents: 12_000 }, retail: true });
    expect(applyPromotions([off], [shampoo, cut]).perLine).toEqual([3000, 9000]);
    expect(applyPromotions([off], [{ ...shampoo, cents: 1000 }]).perLine).toEqual([1000]);
  });

  it("several in order, each on what's left", () => {
    const a = rule({ id: "a", discount: { kind: "percent", pct: 10 }, stackable: true });
    const b = rule({ id: "b", discount: { kind: "amount", cents: 500 }, stackable: true });
    expect(applyPromotions([a, b], [cut])).toEqual({ perLine: [1500], perPromotion: { a: 1000, b: 500 } });
  });
});

describe("when it can be used", () => {
  it("dates, limits and online", () => {
    expect(promotionProblem(rule({ startsOn: "2026-11-01" }), ctx())).toBe("Spring hasn't started yet.");
    expect(promotionProblem(rule({ endsOn: "2026-10-23" }), ctx())).toBe("Spring has ended.");
    expect(promotionProblem(rule({ maxUses: 5 }), ctx({ uses: 5 }))).toBe("Spring has been used as many times as it can be.");
    expect(promotionProblem(rule({ maxUses: 5 }), ctx({ uses: 4 }))).toBeNull();
    expect(promotionProblem(rule({ maxPerClient: 1 }), ctx({ clientUses: 1 }))).toBe("This client has already used Spring.");
    expect(promotionProblem(rule({ maxPerClient: 2 }), ctx({ clientUses: 2 }))).toBe("This client has already used Spring 2 times.");
    expect(promotionProblem(rule({ maxPerClient: 1 }), ctx({ client: null }))).toBe("Spring needs a client on the sale.");
    expect(promotionProblem(rule({ online: false }), ctx({ where: "online" }))).toBe("Spring can't be used online.");
  });

  it("new clients, first visits and minimum spend", () => {
    const fresh = rule({ newClientsOnly: true, startsOn: "2026-10-10" });
    expect(promotionProblem(fresh, ctx())).toBe("Spring is for new clients only.");
    expect(promotionProblem(fresh, ctx({ client: { createdOn: "2026-10-12", visitedBefore: false } }))).toBeNull();
    expect(promotionProblem(rule({ firstVisitOnly: true }), ctx({ client: { createdOn: "2026-01-01", visitedBefore: true } }))).toBe("Spring is for a client's first visit only.");
    expect(promotionProblem(rule({ minSpendCents: 6000 }), ctx({ subtotalCents: 5999 }))).toBe("Spring needs a spend of $60 or more.");
    expect(promotionProblem(rule({ minSpendCents: 6000 }), ctx({ subtotalCents: 6000 }))).toBeNull();
  });

  it("last-minute specials: booked within their hours of starting", () => {
    const special = rule({ kind: "last_minute", code: null, hoursAhead: 48 });
    const start = Date.parse("2026-10-25T15:00:00Z");
    expect(promotionProblem(special, ctx())).toBe("Spring is for visits booked at the last minute.");
    expect(promotionProblem(special, ctx({ visit: { startsAt: start, bookedAt: start - 47 * 3_600_000 } }))).toBeNull();
    expect(promotionProblem(special, ctx({ visit: { startsAt: start, bookedAt: start - 49 * 3_600_000 } }))).toBe("Spring is for visits booked within 48 hours of starting.");
  });

  it("stacking: only promotions that allow it, and none that don't with a staff discount", () => {
    const alone = rule({ id: "a", name: "Alone" });
    const s1 = rule({ id: "b", name: "One", stackable: true });
    const s2 = rule({ id: "c", name: "Two", stackable: true });
    expect(stackingProblem([alone], false)).toBeNull();
    expect(stackingProblem([alone, s1], false)).toBe("Alone can't be used with another promotion.");
    expect(stackingProblem([alone], true)).toBe("Alone can't be used with another discount.");
    expect(stackingProblem([s1, s2], true)).toBeNull();
    expect(stackingProblem([s1, s1], false)).toBe("That promotion is already on the sale.");
  });
});

describe("on the checkout ticket", () => {
  const promo = (rules: PromoRule[], over: Partial<PromoRates> = {}): PromoRates => ({
    rules,
    categoryOf: { cut: "Cuts", color: "Color" },
    levelOf: { gil: "master", lois: "senior" },
    context: { today: "2026-10-24", where: "checkout", client: { createdOn: "2026-10-01", visitedBefore: false }, visit: null },
    uses: {},
    ...over,
  });
  const service = (key: string, staffId: string, serviceId: string, cents: number): TicketLine => ({
    key,
    kind: "service",
    appointmentItemId: null,
    serviceId,
    name: serviceId,
    staffId,
    unitPriceCents: cents,
    basePriceCents: cents,
    priceReason: "",
    quantity: 1,
    discount: null,
    packageItemId: null,
  });
  const ticket = (lines: TicketLine[], promotions: string[], over: Partial<Ticket> = {}): Ticket => ({ ...EMPTY_TICKET, lines, promotions, ...over });

  it("comes off after member prices and before tax and staff discounts, never counted as a staff discount", () => {
    const pct = rule({ discount: { kind: "percent", pct: 10 }, retail: true });
    const t = ticket([service("a", "gil", "cut", 10_000), { key: "b", kind: "product", productId: "x", name: "Shampoo", staffId: null, unitPriceCents: 2_000, quantity: 1, discount: null }], ["p1"]);
    const totals = totalsOf(t, { taxServicesBp: 0, taxRetailBp: 1000, member: { name: "Club", servicePct: 20, retailPct: 0 }, promo: promo([pct]) });
    // Cut: $100, member 20% → $80, then 10% → $72. Shampoo: $20, 10% → $18, plus $1.80 tax.
    expect(totals.memberDiscountCents).toBe(2000);
    expect(totals.promoDiscountCents).toBe(800 + 200);
    expect(totals.totalCents).toBe(7200 + 1800 + 180);
  });

  it("a sale that crosses a stylist exclusion only discounts what it covers", () => {
    const special = rule({ kind: "automatic", code: null, discount: { kind: "percent", pct: 15 }, exclusions: [{ level: "master", category: "Color" }] });
    const t = ticket([service("a", "gil", "color", 15_000), service("b", "lois", "color", 12_000)], ["p1"]);
    expect(totalsOf(t, { taxServicesBp: 0, taxRetailBp: 0, promo: promo([special]) }).promoDiscountCents).toBe(1800);
  });

  it("says what stops it, as complete_sale would", () => {
    const alone = rule({ id: "a", name: "Alone" });
    const lines = [{ ...service("a", "gil", "cut", 10_000), discount: { kind: "percent" as const, value: 5, reason: "Loyal" } }];
    expect(promotionProblems(ticket(lines, ["a"]), { taxServicesBp: 0, taxRetailBp: 0, promo: promo([alone]) })).toEqual(["Alone can't be used with another discount."]);
    const retailOnly = rule({ id: "r", name: "Retail", services: false, retail: true });
    expect(promotionProblems(ticket([service("a", "gil", "cut", 10_000)], ["r"]), { taxServicesBp: 0, taxRetailBp: 0, promo: promo([retailOnly]) })).toEqual(["Retail doesn't cover anything on this sale."]);
    const limited = rule({ id: "l", name: "Limited", maxUses: 1 });
    expect(promotionProblems(ticket([service("a", "gil", "cut", 10_000)], ["l"]), { taxServicesBp: 0, taxRetailBp: 0, promo: promo([limited], { uses: { l: { uses: 1, clientUses: 0 } } }) })).toEqual([
      "Limited has been used as many times as it can be.",
    ]);
    expect(promotionProblems(ticket([service("a", "gil", "cut", 10_000)], ["gone"]), { taxServicesBp: 0, taxRetailBp: 0, promo: promo([]) })).toEqual(["A promotion on the sale has ended. Take it off."]);
  });
});

describe("specials on the booking site", () => {
  const now = Date.parse("2026-10-24T15:00:00Z");
  const special = rule({ id: "s", kind: "last_minute", code: null, hoursAhead: 48, discount: { kind: "percent", pct: 15 }, exclusions: [{ level: "master", category: "Color" }] });
  it("badges open time within its hours that it covers", () => {
    expect(specialFor([special], { startsAt: now + 24 * 3_600_000, now, today: "2026-10-24" }, [cut])?.id).toBe("s");
    expect(specialFor([special], { startsAt: now + 49 * 3_600_000, now, today: "2026-10-24" }, [cut])).toBeNull();
    expect(specialFor([special], { startsAt: now + 3_600_000, now, today: "2026-10-24" }, [color])).toBeNull();
    expect(specialFor([special, { ...special, id: "t", discount: { kind: "percent", pct: 20 } }], { startsAt: now + 3_600_000, now, today: "2026-10-24" }, [cut])?.id).toBe("t");
  });
  it("is described in plain words", () => {
    expect(promotionSummary(special)).toBe("15% off services · open time in the next 48 hours · never Master color · not with other discounts");
  });
});

describe("the form", () => {
  it("parses and round-trips", () => {
    const input = { ...NEW_PROMOTION, name: "Welcome", code: "welcome 15", value: "15", maxPerClient: "1", minSpend: "60" };
    const parsed = parsePromotionInput(input);
    expect(parsed.ok && parsed.row).toMatchObject({ code: "WELCOME15", percent: 15, max_uses_per_client: 1, min_spend_cents: 6000, applies_retail: false });
    if (!parsed.ok) throw new Error("parse");
    expect(promotionInput({ id: "x", ...parsed.row } as never)).toMatchObject({ code: "WELCOME15", value: "15", maxPerClient: "1", minSpend: "60" });
    expect(ruleOf({ id: "x", ...parsed.row } as never).discount).toEqual({ kind: "percent", pct: 15 });
  });
  it("says what's missing", () => {
    expect(parsePromotionInput({ ...NEW_PROMOTION, name: "" })).toMatchObject({ ok: false });
    expect(parsePromotionInput({ ...NEW_PROMOTION, name: "A", code: "X", value: "10" })).toEqual({ ok: false, message: "Give the code 3 to 24 letters or numbers." });
    expect(parsePromotionInput({ ...NEW_PROMOTION, name: "A", code: "ABC", value: "150" })).toEqual({ ok: false, message: "Give the discount as 1 to 100%." });
    expect(parsePromotionInput({ ...NEW_PROMOTION, name: "A", code: "ABC", value: "10", newClientsOnly: true })).toEqual({ ok: false, message: "New clients only needs a start date (clients added from then)." });
    expect(parsePromotionInput({ ...NEW_PROMOTION, name: "A", kind: "last_minute", value: "10", hoursAhead: "0" })).toEqual({ ok: false, message: "Give the hours ahead as 1 to 168." });
  });
});

describe("Denise's ideas for open time", () => {
  const now = Date.parse("2026-10-24T15:00:00Z");
  const gap = (staffId: string, hours: number): Gap => ({ staffId, date: "2026-10-24", start: 14 * 60, end: 16 * 60, startsAt: now + hours * 3_600_000 });
  const regular = (clientId: string, over: Partial<Regular> = {}): Regular => ({
    clientId,
    firstName: clientId,
    preferredStaffId: "gil",
    usualServiceIds: ["cut"],
    overdueDays: 10,
    channel: "sms",
    offeredRecently: false,
    ...over,
  });
  const offers = (id: string) => new Set(id === "gil" ? ["cut", "color"] : ["cut"]);
  const special = rule({ kind: "last_minute", code: null, hoursAhead: 24 });

  it("their own stylist first, the most overdue first, and never the same client twice", () => {
    const ideas = openingIdeas(
      [gap("gil", 2), gap("lois", 3)],
      [regular("ava", { overdueDays: 3 }), regular("bo", { overdueDays: 20 }), regular("cy", { preferredStaffId: "lois", overdueDays: 1 })],
      special,
      offers,
      now,
      2,
    );
    expect(ideas.map((i) => [i.gap.staffId, i.clients.map((c) => c.clientId)])).toEqual([
      ["gil", ["bo", "ava"]],
      ["lois", ["cy"]],
    ]);
  });

  it("only clients an offer can reach, not offered this week, whose services the stylist does, in the special's hours", () => {
    const ideas = openingIdeas(
      [gap("lois", 2), gap("gil", 30)],
      [regular("no", { channel: null }), regular("recent", { offeredRecently: true }), regular("color", { usualServiceIds: ["color"] }), regular("ok")],
      special,
      offers,
      now,
    );
    expect(ideas.map((i) => [i.gap.staffId, i.clients.map((c) => c.clientId)])).toEqual([["lois", ["ok"]]]);
  });

  it("the message is our template, filled in", () => {
    expect(whenText("2026-10-25", 14 * 60 + 30, "2026-10-24", "2026-10-25", (d) => d)).toBe("tomorrow at 2:30pm");
    expect(specialMessage({ firstName: "Ava", salon: "Maple & Ash", stylist: "Gil", when: "today at 2:00pm", offer: "15% off", link: "https://x/book" })).toBe(
      "Hi Ava, Maple & Ash here. Gil has an opening today at 2:00pm, with 15% off if you book it. Book here: https://x/book",
    );
  });
});

describe("the report", () => {
  it("adds up redemptions, revenue, discount cost, gaps filled and new clients", () => {
    expect(
      promotionReport([
        { promotionId: "a", discountCents: 1500, saleNetCents: 8500, lastMinute: true, firstVisit: false },
        { promotionId: "a", discountCents: 1000, saleNetCents: 9000, lastMinute: true, firstVisit: true },
        { promotionId: "b", discountCents: 500, saleNetCents: 2000, lastMinute: false, firstVisit: true },
      ]),
    ).toEqual([
      { promotionId: "a", redemptions: 2, revenueCents: 17_500, discountCents: 2500, gapsFilled: 2, newClients: 1 },
      { promotionId: "b", redemptions: 1, revenueCents: 2000, discountCents: 500, gapsFilled: 0, newClients: 1 },
    ]);
  });
});
