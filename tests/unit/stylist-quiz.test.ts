// Find my stylist: the service, the stylists and the extra-time flag.
import { describe, expect, it } from "vitest";
import { extraTimeFlag, rankStylists, readAnswers, suggestService, type QuizAnswers, type QuizService, type QuizStylist } from "@/lib/stylist-quiz";
import type { Level } from "@/lib/levels";

const svc = (id: string, category: string, minutes: number, patch = false): QuizService => ({ id, name: `${id} service`, category, minutes, mode: "bookable", requiresPatchTest: patch });
const SERVICES = [svc("gloss", "Color", 45, true), svc("highlights", "Color", 120, true), svc("balayage", "Color", 180, true), svc("consult", "Consult", 30), svc("cut", "Cut", 60)];
const SET = { consultationServiceId: "consult", patchTestServiceId: null };
const A: QuizAnswers = { category: "Color", change: "refresh", length: "medium", history: [], budget: "any", notes: "" };
const LEVELS = [{ key: "master", name: "Master" }, { key: "senior", name: "Senior" }, { key: "artisan", name: "Artisan" }] as unknown as Level[];
const st = (id: string, level: string, cents: number, specialty: string | null = null): QuizStylist => ({ id, displayName: `${id} Lee`, firstName: id, level, specialty, bio: null, prices: { balayage: cents } });
const SVC = SERVICES[2];

describe("reading answers", () => {
  it("takes only what's on the lists", () => {
    expect(readAnswers({ ...A, notes: "  hi " }, ["Color"])).toEqual({ ...A, notes: "hi" });
    expect(readAnswers({ ...A, category: "Nope" }, ["Color"])).toBeNull();
    expect(readAnswers({ ...A, history: ["x"] }, ["Color"])).toBeNull();
    expect(readAnswers(null, ["Color"])).toBeNull();
  });
});

describe("the service", () => {
  it("goes by how much of a change", () => {
    expect(suggestService(SERVICES, A, SET)!.service.id).toBe("gloss");
    expect(suggestService(SERVICES, { ...A, change: "noticeable" }, SET)!.service.id).toBe("highlights");
    expect(suggestService(SERVICES, { ...A, change: "complete" }, SET)!.service.id).toBe("balayage");
  });
  it("starts with a consultation for a complete color change over past treatments", () => {
    expect(suggestService(SERVICES, { ...A, change: "complete", history: ["box_dye"] }, SET)).toMatchObject({ consultation: true, service: { id: "consult" } });
    expect(suggestService(SERVICES, { ...A, category: "Cut", change: "complete", history: ["box_dye"] }, SET)).toMatchObject({ consultation: false });
    expect(suggestService(SERVICES, { ...A, change: "complete", history: ["box_dye"] }, { ...SET, consultationServiceId: null })).toMatchObject({ consultation: false });
  });
});

describe("the stylists", () => {
  const all = (ids: string[], d: number | null = 2) => new Map(ids.map((i) => [i, d]));
  it("puts a specialty first, and says why", () => {
    const out = rankStylists([st("a", "artisan", 100), st("b", "artisan", 100, "Lived-in balayage")], SVC, A, LEVELS, all(["a", "b"]));
    expect(out[0].stylist.id).toBe("b");
    expect(out[0].reasons).toEqual(["Lived-in balayage", "Has time this week"]);
  });
  it("prefers seniority for a bigger change, and lower prices when asked", () => {
    const list = [st("a", "artisan", 100), st("m", "master", 200)];
    expect(rankStylists(list, SVC, { ...A, change: "complete" }, LEVELS, all(["a", "m"]))[0].stylist.id).toBe("m");
    expect(rankStylists(list, SVC, { ...A, budget: "value" }, LEVELS, all(["a", "m"]))[0].stylist.id).toBe("a");
  });
  it("leaves out anyone with no time, unless nobody has any, and shows at most three", () => {
    const list = ["a", "b", "c", "d"].map((i) => st(i, "artisan", 100));
    expect(rankStylists(list.slice(0, 2), SVC, A, LEVELS, new Map([["a", null], ["b", 3]])).map((m) => m.stylist.id)).toEqual(["b"]);
    expect(rankStylists(list.slice(0, 2), SVC, A, LEVELS, all(["a", "b"], null))).toHaveLength(2);
    expect(rankStylists(list, SVC, A, LEVELS, all(["a", "b", "c", "d"]))).toHaveLength(3);
  });
  it("skips stylists who don't offer it", () => {
    expect(rankStylists([{ ...st("a", "artisan", 1), prices: {} }], SVC, A, LEVELS, new Map())).toEqual([]);
  });
});

describe("extra time", () => {
  const color = { service: SVC, consultation: false };
  it("adds up our reasons, up to an hour", () => {
    expect(extraTimeFlag({ ...A, length: "very_long" }, color, SERVICES)).toEqual({ minutes: 15, reasons: ["Very long hair"] });
    expect(extraTimeFlag({ ...A, change: "complete", length: "very_long", history: ["box_dye", "chemical"] }, color, SERVICES)!.minutes).toBe(60);
  });
  it("keeps color reasons to color, and none for a consultation or an easy visit", () => {
    expect(extraTimeFlag({ ...A, change: "complete" }, { service: SERVICES[4], consultation: false }, SERVICES)).toBeNull();
    expect(extraTimeFlag({ ...A, length: "very_long" }, { service: SERVICES[3], consultation: true }, SERVICES)).toBeNull();
    expect(extraTimeFlag(A, color, SERVICES)).toBeNull();
  });
});
