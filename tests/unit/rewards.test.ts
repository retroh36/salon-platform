// The rewards program's maths: earning (and what never earns), tiers,
// taking a reward, points back on refunds, and Denise's line at checkout.
import { describe, expect, it } from "vitest";
import { applyPromotions, type PromoLine } from "@/lib/promotions";
import { centsPerPoint, closestReward, NO_PROGRAM, nextTier, pointsBack, pointsFor, pointsLine, rewardProblem, rewardRule, rewardsProblem, rewardValue, tierFor, type Program, type Reward, type Tier } from "@/lib/rewards";

const PROGRAM: Program = { ...NO_PROGRAM, enabled: true, servicePoints: 1, retailPoints: 2, minRedeemPoints: 100 };
const TIERS: Tier[] = [
  { id: "silver", name: "Silver", threshold: 50_000, bonusPct: 0, freeAddonServiceId: null, priorityBooking: false },
  { id: "gold", name: "Gold", threshold: 150_000, bonusPct: 25, freeAddonServiceId: null, priorityBooking: false },
  { id: "vip", name: "VIP", threshold: 300_000, bonusPct: 50, freeAddonServiceId: "mask", priorityBooking: true },
];
const reward = (r: Partial<Reward> & Pick<Reward, "id" | "name" | "points">): Reward => ({
  kind: "amount",
  amountCents: 2500,
  pct: null,
  services: true,
  retail: true,
  serviceIds: null,
  maxPerYear: null,
  minTierId: null,
  ...r,
});
const OFF25 = reward({ id: "off25", name: "$25 off", points: 500 });
const GLOSS = reward({ id: "gloss", name: "Free gloss", points: 300, kind: "free_service", amountCents: null, serviceIds: ["gloss"] });
const RETAIL20 = reward({ id: "retail20", name: "20% off retail", points: 200, kind: "percent", amountCents: null, pct: 20, services: false, maxPerYear: 1, minTierId: "gold" });

describe("earning", () => {
  it("is per whole dollar of services and retail at their own rates, after discounts and before tax", () => {
    expect(
      pointsFor(
        [
          { kind: "service", netCents: 12_550, coveredBy: null },
          { kind: "product", netCents: 2_899, coveredBy: null },
        ],
        PROGRAM,
      ),
    ).toBe(125 + 57);
  });

  it("never on gift cards, and on packages and memberships only if the salon says so", () => {
    const lines = [
      { kind: "gift_card" as const, netCents: 10_000, coveredBy: null },
      { kind: "gift_card_reload" as const, netCents: 5_000, coveredBy: null },
      { kind: "package" as const, netCents: 20_000, coveredBy: null },
      { kind: "membership" as const, netCents: 9_900, coveredBy: null },
      { kind: "service" as const, netCents: 6_000, coveredBy: "package" as const },
      { kind: "service" as const, netCents: 4_500, coveredBy: "membership" as const },
    ];
    expect(pointsFor(lines, PROGRAM)).toBe(0);
    expect(pointsFor(lines, { ...PROGRAM, earnOnPackages: true })).toBe(200 + 60);
    expect(pointsFor(lines, { ...PROGRAM, earnOnMemberships: true })).toBe(99 + 45);
  });

  it("adds the tier's bonus, and nothing while the program is off", () => {
    const lines = [{ kind: "service" as const, netCents: 10_000, coveredBy: null }];
    expect(pointsFor(lines, PROGRAM, 25)).toBe(125);
    expect(pointsFor(lines, { ...PROGRAM, enabled: false }, 25)).toBe(0);
  });

  it("takes back the refunded share, all of it on a full refund", () => {
    expect(pointsBack(182, 4_000, 16_000)).toBe(46);
    expect(pointsBack(182, 16_000, 16_000)).toBe(182);
    expect(pointsBack(182, 20_000, 16_000)).toBe(182);
    expect(pointsBack(0, 4_000, 16_000)).toBe(0);
  });
});

describe("tiers", () => {
  it("are the highest reached, by spend or visits, with how far to the next", () => {
    expect(tierFor(TIERS, 40_000, 0, "spend")).toBeNull();
    expect(tierFor(TIERS, 50_000, 0, "spend")?.name).toBe("Silver");
    expect(tierFor(TIERS, 299_999, 0, "spend")?.name).toBe("Gold");
    expect(nextTier(TIERS, 120_000, 0, "spend")).toMatchObject({ tier: { name: "Gold" }, toGo: 30_000 });
    expect(nextTier(TIERS, 400_000, 0, "spend")).toBeNull();
    const visits = [{ ...TIERS[0], threshold: 6 }, { ...TIERS[1], threshold: 12 }];
    expect(tierFor(visits, 0, 7, "visits")?.name).toBe("Silver");
  });
});

describe("taking a reward", () => {
  const client = { balance: 520, tierId: "silver", usedThisYear: {} };
  it("needs the points, the program's minimum, the tier and a use left this year", () => {
    expect(rewardProblem(OFF25, client, PROGRAM, TIERS)).toBeNull();
    expect(rewardProblem(OFF25, { ...client, balance: 460 }, PROGRAM, TIERS)).toBe("40 more points needed.");
    expect(rewardProblem(GLOSS, { ...client, balance: 90 }, { ...PROGRAM, minRedeemPoints: 100 }, TIERS)).toBe("Rewards start at 100 points.");
    expect(rewardProblem(RETAIL20, client, PROGRAM, TIERS)).toBe("For Gold and up.");
    expect(rewardProblem(RETAIL20, { ...client, tierId: "vip" }, PROGRAM, TIERS)).toBeNull();
    expect(rewardProblem(RETAIL20, { ...client, tierId: "vip", usedThisYear: { retail20: 1 } }, PROGRAM, TIERS)).toBe("Already used this year.");
  });

  it("can't spend the same points twice on one sale", () => {
    expect(rewardsProblem([OFF25], client, PROGRAM, TIERS)).toBeNull();
    expect(rewardsProblem([OFF25, GLOSS], client, PROGRAM, TIERS)).toBe("Free gloss: 280 more points needed.");
  });

  it("comes off like a promotion: an amount once, a percent of what it covers, a free service's first line in full", () => {
    const lines: PromoLine[] = [
      { kind: "service", serviceId: "gloss", category: "Color", staffId: "s", level: null, cents: 4_500 },
      { kind: "service", serviceId: "gloss", category: "Color", staffId: "s", level: null, cents: 4_500 },
      { kind: "product", productId: "p", cents: 3_000 },
    ];
    expect(applyPromotions([rewardRule(GLOSS)], lines).perLine).toEqual([4_500, 0, 0]);
    expect(applyPromotions([rewardRule(OFF25)], lines).perLine).toEqual([2_500, 0, 0]);
    expect(applyPromotions([rewardRule(RETAIL20)], lines).perLine).toEqual([0, 0, 600]);
  });
});

describe("words", () => {
  const all = [OFF25, GLOSS, RETAIL20];
  it("Denise's line at checkout: what they can take, or how close they are", () => {
    expect(closestReward(all, 260)).toMatchObject({ reward: { id: "gloss" }, toGo: 40 });
    expect(pointsLine("Linda", 260, all, [RETAIL20])).toBe("Linda has 260 points: enough for 20% off retail, and 40 points from a free gloss.");
    expect(pointsLine("Linda", 250, [OFF25, RETAIL20], [RETAIL20])).toBe("Linda has 250 points: enough for 20% off retail.");
    expect(pointsLine("Linda", 260, all, [])).toBe("Linda is 40 points from a free gloss.");
    expect(pointsLine("Linda", 900, all, [])).toBeNull();
  });

  it("the catalog's values and what a point is worth", () => {
    const name = (id: string) => (id === "gloss" ? "Gloss / Toner" : undefined);
    expect(rewardValue(OFF25, name)).toBe("$25 off");
    expect(rewardValue(GLOSS, name)).toBe("Free Gloss / Toner");
    expect(rewardValue(RETAIL20, name)).toBe("20% off retail");
    expect(centsPerPoint(all)).toBe(5);
    expect(centsPerPoint([GLOSS])).toBe(0);
  });
});
