// Which page Denise is asked from: its name, and where its client comes from.
import { describe, expect, it } from "vitest";
import { pageOf } from "@/lib/denise/page";

const ID = "6f1d2b8e-3c4a-4e5f-9a7b-1c2d3e4f5a6b";

describe("the page Denise is asked from", () => {
  it("names the page", () => {
    expect(pageOf({ path: "/dashboard" })).toEqual({ label: "the Dashboard" });
    expect(pageOf({ path: "/reports?from=2026-10-01" })).toEqual({ label: "Reports" });
    expect(pageOf({ path: "/calendar/waitlist" })).toEqual({ label: "the Waitlist" });
    expect(pageOf({ path: "/book/maple-and-ash" })).toBeNull();
    expect(pageOf(null)).toBeNull();
  });

  it("knows whose page it is", () => {
    expect(pageOf({ path: `/clients/${ID}` })).toEqual({ label: "a client's profile", clientFrom: { kind: "client", id: ID } });
    expect(pageOf({ path: `/checkout/${ID}` })).toEqual({ label: "the checkout", clientFrom: { kind: "draft", id: ID } });
    expect(pageOf({ path: `/sales/${ID}` })).toEqual({ label: "a sale", clientFrom: { kind: "sale", id: ID } });
    expect(pageOf({ path: "/calendar", appointmentId: ID })).toEqual({ label: "a visit open on the Calendar", clientFrom: { kind: "appointment", id: ID } });
    // Not an id: no client.
    expect(pageOf({ path: "/clients/new" })).toEqual({ label: "the new client form" });
    expect(pageOf({ path: "/calendar", appointmentId: "nope" })).toEqual({ label: "the Calendar" });
  });
});
