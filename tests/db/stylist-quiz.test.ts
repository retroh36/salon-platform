// Find my stylist in the database: who reads a quiz, nobody writes one, and
// who decides the flag.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const ids: string[] = [];
let frontDesk: Client;
let stylist: Client;
const make = async (flag: number | null = 15) => {
  const { data, error } = await admin.from("stylist_quizzes").insert({ business_id: B, answers: {}, flag_minutes: flag, flag_reasons: flag ? ["Very long hair"] : [] }).select("id").single();
  if (error) throw error;
  ids.push(data.id);
  return data.id;
};

beforeAll(async () => {
  [frontDesk, stylist] = await Promise.all(["frontdesk", "bridget"].map((u) => signIn(`${u}@mapleandash.test`)));
});
afterAll(async () => {
  await admin.from("stylist_quizzes").delete().in("id", ids);
});

describe("stylist quizzes", () => {
  it("are read by the front of house, not by a stylist with no visit on it", async () => {
    const id = await make();
    expect((await frontDesk.from("stylist_quizzes").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await stylist.from("stylist_quizzes").select("id").eq("id", id)).data).toEqual([]);
  });
  it("can't be written directly", async () => {
    const { error } = await frontDesk.from("stylist_quizzes").insert({ business_id: B, answers: {} });
    expect(error).not.toBeNull();
  });
  it("records who decides the flag, once, and only the front of house", async () => {
    const id = await make();
    expect((await stylist.rpc("decide_quiz_flag", { p_quiz_id: id, p_decision: "ignored" })).error?.code).toBe("42501");
    expect((await frontDesk.rpc("decide_quiz_flag", { p_quiz_id: id, p_decision: "ignored" })).error).toBeNull();
    const { data } = await admin.from("stylist_quizzes").select("flag_status, flag_by").eq("id", id).single();
    expect(data!.flag_status).toBe("ignored");
    expect(data!.flag_by).not.toBeNull();
    expect((await frontDesk.rpc("decide_quiz_flag", { p_quiz_id: id, p_decision: "accepted" })).error?.hint).toBe("decided");
  });
  it("has nothing to decide without a flag", async () => {
    expect((await frontDesk.rpc("decide_quiz_flag", { p_quiz_id: await make(null), p_decision: "accepted" })).error?.code).toBe("22023");
  });
});
