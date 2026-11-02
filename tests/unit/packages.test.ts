import { describe, expect, it } from "vitest";
import { packageFor, packageNote, packageTags, proRatedRefund, usesLeft, withPackages, type ClientPackage } from "@/lib/packages";

const NOW = new Date("2026-10-23T12:00:00Z");
const pkg = (over: Partial<ClientPackage> = {}): ClientPackage => ({
  id: "p1",
  name: "5 blowouts",
  priceCents: 20000,
  levels: null,
  expiresAt: null,
  status: "active",
  refundedCents: 0,
  createdAt: "2026-09-01T00:00:00Z",
  items: [{ id: "i1", serviceId: "blowout", serviceName: "Blowout", total: 5, used: 2, useValueCents: 4000 }],
  ...over,
});

describe("which package covers a service", () => {
  it("finds a package with a use left, for the stylist's level, not expired or canceled", () => {
    expect(packageFor([pkg()], "blowout", "artisan", NOW)?.item.id).toBe("i1");
    expect(packageFor([pkg()], "cut", "artisan", NOW)).toBeNull();
    expect(packageFor([pkg({ levels: ["master"] })], "blowout", "artisan", NOW)).toBeNull();
    expect(packageFor([pkg({ levels: ["master"] })], "blowout", "master", NOW)).not.toBeNull();
    expect(packageFor([pkg({ expiresAt: "2026-10-01T00:00:00Z" })], "blowout", null, NOW)).toBeNull();
    expect(packageFor([pkg({ status: "canceled" })], "blowout", null, NOW)).toBeNull();
    const done = pkg({ items: [{ id: "i1", serviceId: "blowout", serviceName: "Blowout", total: 5, used: 5, useValueCents: 4000 }] });
    expect(packageFor([done], "blowout", null, NOW)).toBeNull();
  });

  it("uses the one that expires soonest first", () => {
    const later = pkg({ id: "later", expiresAt: "2027-06-01T00:00:00Z", items: [{ id: "a", serviceId: "blowout", serviceName: "Blowout", total: 3, used: 0, useValueCents: 4000 }] });
    const sooner = pkg({ id: "sooner", expiresAt: "2026-12-01T00:00:00Z", items: [{ id: "b", serviceId: "blowout", serviceName: "Blowout", total: 3, used: 0, useValueCents: 4000 }] });
    expect(packageFor([later, sooner, pkg()], "blowout", null, NOW)?.pkg.id).toBe("sooner");
  });
});

describe("package wording and refunds", () => {
  it("says what's left, and refunds what the unused uses are worth", () => {
    expect(usesLeft({ total: 5, used: 2, serviceName: "Blowout" })).toBe("3 Blowouts left");
    expect(usesLeft({ total: 5, used: 4, serviceName: "Blowout" })).toBe("1 Blowout left");
    expect(proRatedRefund(pkg())).toBe(12000);
    // Never more than was paid less what's already been refunded.
    expect(proRatedRefund(pkg({ refundedCents: 15000 }))).toBe(5000);
    expect(packageTags([pkg()], NOW)).toEqual([{ label: "Package: 3 Blowouts left", tone: "good" }]);
    expect(withPackages(null, [pkg()])).toEqual({ summary: "Has a package with uses left.", line: "Has a package with uses left", tags: [{ label: "Package: 3 Blowouts left", tone: "good" }] });
    expect(withPackages({ summary: "Comes every 4 weeks.", tags: [] }, [])).toEqual({ summary: "Comes every 4 weeks.", tags: [] });
  });
});

// Package at checkout used to grey out with no reason, so testers took it
// for broken. It says why now.
describe("why Package can't be used at checkout", () => {
  const line = (over: Partial<{ serviceId: string; name: string; staffLevel: "artisan" | "senior" | "master" | null; packageItemId: string | null }> = {}) => ({ serviceId: "blowout", name: "Blowout", staffLevel: "artisan" as const, packageItemId: null, ...over });
  const michael = { firstName: "Michael" };

  it("says nothing when it can be used", () => {
    expect(packageNote([line()], [pkg()], michael, NOW)).toBeNull();
  });

  it("says why when it can't", () => {
    expect(packageNote([line()], [], null, NOW)).toBe("Packages need a client on the sale.");
    expect(packageNote([line()], [], michael, NOW)).toBe("Michael has no package with uses left.");
    expect(packageNote([line({ packageItemId: "i1" })], [pkg()], michael, NOW)).toBe("Michael's package is already paying for Blowout.");
    expect(packageNote([line({ serviceId: "cut", name: "Men's Cut" })], [pkg()], michael, NOW)).toBe("Michael's package (3 Blowouts left) doesn't cover anything on this sale.");
    expect(packageNote([line()], [pkg({ levels: ["senior", "master"] })], michael, NOW)).toBe("Michael's package is only for Senior or Master stylists.");
  });
});
