import { describe, expect, it } from "vitest";
import { readRunningLate } from "@/lib/denise/call-out";
import { arrivesAt, lateChoice, lateTarget } from "@/lib/running-late";

// "Gil is running 20 minutes late": testers looked for it and found it only
// in a client's booking, under "⋯". It's on the stylist's column now, and
// Denise reads it from the chat.

const team = [
  { id: "gil", firstName: "Gil" },
  { id: "nola", firstName: "Nola" },
];

describe("reading a stylist running late from the chat", () => {
  it("reads who and how late", () => {
    expect(readRunningLate("Gil is running 20 minutes late", team)).toEqual({ staffId: "gil", firstName: "Gil", minutes: 20 });
    expect(readRunningLate("gil's running 15 min behind", team)?.minutes).toBe(15);
    expect(readRunningLate("Nola is running late by 10", team)?.minutes).toBe(10);
    expect(readRunningLate("Gil is half an hour behind", team)?.minutes).toBe(30);
    expect(readRunningLate("Gil is running late", team)).toEqual({ staffId: "gil", firstName: "Gil", minutes: null });
  });

  it("leaves questions, clients, coming in late and anything else alone", () => {
    expect(readRunningLate("Is Gil running late?", team)).toBeNull();
    expect(readRunningLate("Gil's client is running late", team)).toBeNull();
    expect(readRunningLate("Gil's 11 o'clock is running 10 min late", team)).toBeNull();
    expect(readRunningLate("Gil is coming in late", team)).toBeNull();
    expect(readRunningLate("Gil and Nola are running late", team)).toBeNull();
    expect(readRunningLate("Book a cut with Gil later today", team)).toBeNull();
  });
});

describe("what running late means for the stylist's day", () => {
  const block = (over: Partial<Parameters<typeof lateTarget>[0][number]>) => ({ itemId: "a", staffId: "gil", start: 600, end: 660, status: "booked", clientName: "Maria Lopez", service: "Men's Cut", ...over });

  it("is the visit in their chair, else their next client, else nothing", () => {
    const day = [block({ itemId: "done", start: 540, end: 600, status: "completed" }), block({ itemId: "now", start: 600, end: 660, status: "checked_in" }), block({ itemId: "next", start: 660, end: 720 })];
    expect(lateTarget(day, "gil", 630)).toMatchObject({ kind: "in_chair", itemId: "now", end: 660 });
    expect(lateTarget(day.filter((b) => b.itemId !== "now"), "gil", 630)).toMatchObject({ kind: "next", itemId: "next", start: 660 });
    expect(lateTarget(day.filter((b) => b.itemId !== "now"), "nola", 630)).toEqual({ kind: "none" });
    expect(lateTarget([block({ end: 620 })], "gil", 630)).toEqual({ kind: "none" });
    // Another day: the first not started.
    expect(lateTarget(day.filter((b) => b.itemId !== "now"), "gil", null)).toMatchObject({ itemId: "next" });
  });

  it("rounds how late up to a choice, and works out when they'd be in", () => {
    expect(lateChoice(12)).toBe(15);
    expect(lateChoice(20)).toBe(20);
    expect(lateChoice(90)).toBe(60);
    const next = { kind: "next" as const, itemId: "x", clientName: "M", service: "S", start: 660 };
    expect(arrivesAt(next, 600, 20)).toBe(690); // late for the 11:00: in by 11:30 (11:20, on the quarter after)
    expect(arrivesAt(next, 675, 20)).toBe(705); // the 11:00 is waiting: 20 from now (11:35), on the quarter after
    expect(arrivesAt({ kind: "none" }, 600, 20)).toBeNull();
  });
});
