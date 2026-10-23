import { describe, expect, it } from "vitest";
import { packageFor, packageTags, proRatedRefund, usesLeft, withPackages, type ClientPackage } from "@/lib/packages";

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
    expect(withPackages(null, [pkg()])).toEqual({ summary: "Has a package with uses left.", tags: [{ label: "Package: 3 Blowouts left", tone: "good" }] });
    expect(withPackages({ summary: "Comes every 4 weeks.", tags: [] }, [])).toEqual({ summary: "Comes every 4 weeks.", tags: [] });
  });
});
