import { describe, expect, it } from "vitest";
import { auditHref, mergeAudit, parseAuditFilters, type AuditRow } from "@/lib/audit";
import { changeLine, changeWhat, type ChangeNames } from "@/lib/visit-changes";

const TZ = "America/Chicago";
const names: ChangeNames = {
  staff: (id) => ({ s1: "Gil Moreno", s2: "Lois Chen", fd: "Sam Rivera" })[id ?? ""] ?? null,
  service: (id) => ({ v1: "Blowout", v2: "Gloss" })[id ?? ""] ?? null,
  client: (id) => (id === "c1" ? "Maria Lopez" : id ? "another client" : null),
  timeZone: TZ,
};

describe("the audit filters", () => {
  it("default to the last 7 days, and keep to 92 days and no further than today", () => {
    expect(parseAuditFilters({}, "2026-11-05")).toEqual({ type: null, staffId: null, from: "2026-10-30", to: "2026-11-05" });
    expect(parseAuditFilters({ type: "sales", staff: "not-an-id", from: "2025-01-01", to: "2027-01-01" }, "2026-11-05")).toEqual({ type: "sales", staffId: null, from: "2026-08-06", to: "2026-11-05" });
    expect(parseAuditFilters({ type: "bogus", from: "2026-11-04", to: "2026-11-01" }, "2026-11-05")).toMatchObject({ type: null, from: "2026-11-01", to: "2026-11-01" });
    expect(auditHref({ type: "visits", from: "2026-11-01" })).toBe("/audit?type=visits&from=2026-11-01");
  });

  it("merges every log newest first, at most the limit", () => {
    const row = (id: string, at: string): AuditRow => ({ id, at, type: "visits", staffId: null, who: "Maestra", what: id, href: null });
    const { rows, more } = mergeAudit([[row("a", "2026-11-01T10:00:00Z"), row("b", "2026-11-03T10:00:00Z")], [row("c", "2026-11-02T10:00:00Z")]], 2);
    expect(rows.map((r) => r.id)).toEqual(["b", "c"]);
    expect(more).toBe(true);
  });
});

describe("a visit's changes in words", () => {
  const at = "2026-11-03T15:12:00Z";
  it("says what changed, by whom and when", () => {
    expect(changeLine({ kind: "status", before: { status: "booked" }, after: { status: "no_show" }, by_staff_id: "fd", by_kind: "staff", created_at: at }, names)).toBe("Marked no-show by Sam Rivera · Tue, Nov 3, 9:12am");
    expect(changeWhat({ kind: "status", before: { status: "no_show" }, after: { status: "booked" } }, names)).toBe("No-show undone");
    expect(changeWhat({ kind: "status", before: { status: "checked_in" }, after: { status: "booked" } }, names)).toBe("Check-in undone");
    expect(changeWhat({ kind: "status", before: { status: "completed" }, after: { status: "checked_in" } }, names)).toBe("Checkout reversed");
    expect(changeWhat({ kind: "status", before: { status: "booked" }, after: { status: "canceled", reason: "client" } }, names)).toBe("Canceled (client)");
    expect(changeLine({ kind: "status", before: { status: "booked" }, after: { status: "canceled" }, by_staff_id: null, by_kind: "client", created_at: at }, names)).toMatch(/^Canceled by the client · /);
  });

  it("describes moves, a new stylist, a new service and a new price", () => {
    const moved = { kind: "changed" as const, before: { service: "v1", starts_at: "2026-11-03T20:00:00Z", staff_id: "s1" }, after: { starts_at: "2026-11-04T21:15:00Z", staff_id: "s2" } };
    expect(changeWhat(moved, names)).toBe("Blowout: moved from Tue, Nov 3, 2pm to Wed, Nov 4, 3:15pm, from Gil Moreno to Lois Chen");
    expect(changeWhat({ kind: "changed", before: { service: "v1", starts_at: "2026-11-03T20:00:00Z" }, after: { starts_at: "2026-11-03T21:00:00Z" } }, names)).toBe("Blowout: moved from Tue, Nov 3, 2pm to 3pm");
    expect(changeWhat({ kind: "changed", before: { service: "v1", service_id: "v1" }, after: { service_id: "v2" } }, names)).toBe("Service changed to Gloss");
    expect(changeWhat({ kind: "changed", before: { service: "v1", price_cents: 6500 }, after: { price_cents: 4500 } }, names)).toBe("Blowout: price $65 to $45");
    expect(changeWhat({ kind: "service_added", before: {}, after: { service_id: "v2", staff_id: "s1" } }, names)).toBe("Added Gloss with Gil Moreno");
    expect(changeWhat({ kind: "client", before: { client_id: "c9" }, after: { client_id: "c1" } }, names)).toBe("Client changed from another client to Maria Lopez");
    expect(changeLine({ kind: "booked", before: {}, after: { source: "online" }, by_staff_id: null, by_kind: "system", created_at: at }, names)).toMatch(/^Booked online by Maestra/);
  });
});
