import { describe, expect, it } from "vitest";
import { bookingPath, CODE_LENGTH, linkCode } from "@/lib/booking-links";

const link = { businessId: "b1", staffId: "s1", serviceIds: ["c2", "c1"], source: "special" };

describe("short booking links", () => {
  it("gives the same short code for the same choices, whatever the services' order", () => {
    const code = linkCode(link);
    expect(code).toMatch(new RegExp(`^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{${CODE_LENGTH}}$`));
    expect(linkCode({ ...link, serviceIds: ["c1", "c2"] })).toBe(code);
    expect(linkCode({ ...link, staffId: "s2" })).not.toBe(code);
    expect(linkCode({ ...link, source: "rebook" })).not.toBe(code);
  });

  it("goes to the booking site with the stylist, services and source", () => {
    expect(bookingPath("maple-and-ash", { staff_id: "s1", service_ids: ["c1", "c2"], source: "special" })).toBe("/book/maple-and-ash?src=special&staff=s1&services=c1,c2");
    expect(bookingPath("maple-and-ash", { staff_id: null, service_ids: [], source: "special" })).toBe("/book/maple-and-ash?src=special");
  });
});
