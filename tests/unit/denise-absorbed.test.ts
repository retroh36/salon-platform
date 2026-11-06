// A delay Denise absorbs (lib/scheduling/resolve.ts `absorbed`): one client
// starting a little later with the same stylist and nothing else changed.
// Applied, the client still comes at their time; staff may tell them how far
// behind (absorbedDelay), from 5 minutes, and nothing goes unless they do.
import { describe, expect, it } from "vitest";
import { absorbedDelay } from "@/lib/denise/fixes";
import type { Proposal } from "@/lib/scheduling/ai-actions";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 10, h + 6, m));
const change = (appointmentId: string, from: Date, to: Date, staff = "priya", toStaff = staff) => ({
  itemId: `${appointmentId}-1`,
  appointmentId,
  from: { staffId: staff, resourceId: null, start: from },
  to: { staffId: toStaff, resourceId: null, start: to },
});
const proposal = (changes: ReturnType<typeof change>[], extra: Partial<Proposal> = {}): Proposal => ({ changes, ...extra }) as Proposal;

describe("an absorbed delay", () => {
  it("is one visit a little later with the same stylist, about how far behind it runs", () => {
    expect(absorbedDelay(proposal([change("grace", at(11), at(11, 15))]))).toEqual({ appointmentId: "grace", from: { start: at(11), staffId: "priya" }, minutes: 15 });
    // A whole visit moves together: its first service says when they come.
    expect(absorbedDelay(proposal([change("grace", at(11, 30), at(11, 45)), { ...change("grace", at(11), at(11, 15)), itemId: "grace-0" }]))?.from.start).toEqual(at(11));
  });

  it("doesn't ask under 5 minutes", () => {
    expect(absorbedDelay(proposal([change("grace", at(11), at(11, 3))]))?.minutes).toBe(0);
  });

  it("isn't another stylist, two clients, a long wait, a lunch moved or a booking", () => {
    expect(absorbedDelay(proposal([change("grace", at(11), at(11), "priya", "ethan")]))).toBeNull();
    expect(absorbedDelay(proposal([change("grace", at(11), at(11, 10)), change("ada", at(12), at(12, 10))]))).toBeNull();
    expect(absorbedDelay(proposal([change("grace", at(11), at(11, 25))]))).toBeNull();
    expect(absorbedDelay(proposal([change("grace", at(11), at(11, 10))], { blockMoves: [{ blockId: "b", date: "2026-11-10", from: { start: 780, end: 840 }, to: { start: 790, end: 850 } }] }))).toBeNull();
  });
});
