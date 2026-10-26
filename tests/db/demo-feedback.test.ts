// The public demo's feedback table (migration …_demo_feedback.sql): only the
// service role reads or writes it, and every table has Row Level Security.
import { afterAll, describe, expect, it } from "vitest";
import { admin, anon, signIn } from "./helpers";

const NOTE = `db test note ${Date.now()}`;

afterAll(async () => {
  await admin.from("demo_feedback").delete().eq("note", NOTE);
});

describe("demo feedback", () => {
  it("is saved and read by the service role only", async () => {
    const { error } = await admin.from("demo_feedback").insert({ note: NOTE, page: "/dashboard", role: "Owner", salon: "Maple & Ash Hair Studio" });
    expect(error).toBeNull();
    const owner = await signIn("owner@mapleandash.test");
    for (const client of [anon, owner]) {
      const read = await client.from("demo_feedback").select("id").eq("note", NOTE);
      expect(read.data ?? []).toEqual([]);
      const write = await client.from("demo_feedback").insert({ note: "sneaky", page: "/", role: "Owner" });
      expect(write.error).not.toBeNull();
    }
    const { data } = await admin.from("demo_feedback").select("note").eq("note", NOTE);
    expect(data).toHaveLength(1);
  });

  it("checks a note's length", async () => {
    const { error } = await admin.from("demo_feedback").insert({ note: "x".repeat(2001), page: "/", role: "Owner" });
    expect(error?.code).toBe("23514");
  });
});

describe("Row Level Security", () => {
  it("is on for every table, and only the service role can ask", async () => {
    const { data, error } = await admin.rpc("tables_without_rls");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const owner = await signIn("owner@mapleandash.test");
    for (const client of [anon, owner]) expect((await client.rpc("tables_without_rls")).error).not.toBeNull();
  });
});
