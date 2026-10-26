import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

// Client notes record who last changed them and when (migration
// …_client_notes_edited.sql): set by the database, never by the caller.

let clientId: string;
let frontDesk: Client;
let manager: Client;
let stylist: Client;

beforeAll(async () => {
  [frontDesk, manager, stylist] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  const { data, error } = await admin.from("clients").insert({ business_id: SEED.business, first_name: "Notes", last_name: `Test ${Date.now()}` }).select("id").single();
  if (error) throw error;
  clientId = data.id;
});

afterAll(async () => {
  await admin.from("clients").delete().eq("id", clientId);
});

const read = async () => (await admin.from("clients").select("notes, notes_updated_at, notes_updated_by").eq("id", clientId).single()).data!;

describe("client notes", () => {
  it("records who changed the notes and when", async () => {
    expect(await read()).toMatchObject({ notes: null, notes_updated_at: null, notes_updated_by: null });
    const { error } = await frontDesk.from("clients").update({ notes: "Prefers quiet appointments." }).eq("id", clientId);
    expect(error).toBeNull();
    const row = await read();
    expect(row.notes).toBe("Prefers quiet appointments.");
    expect(row.notes_updated_by).toBe(SEED.staff.frontDesk);
    expect(Date.now() - new Date(row.notes_updated_at!).getTime()).toBeLessThan(60_000);
  });

  it("keeps the stamp when something else changes, and can't be forged", async () => {
    const before = await read();
    await manager
      .from("clients")
      .update({ preferences: "Likes a strong coffee", notes_updated_by: SEED.staff.manager, notes_updated_at: "2020-01-01T00:00:00Z" } as never)
      .eq("id", clientId);
    expect(await read()).toEqual(before);
  });

  it("moves to whoever changes them next", async () => {
    await manager.from("clients").update({ notes: "Prefers quiet appointments. Allergic to fragrance." }).eq("id", clientId);
    expect((await read()).notes_updated_by).toBe(SEED.staff.manager);
  });

  it("can't be changed by a stylist", async () => {
    const before = await read();
    await stylist.from("clients").update({ notes: "Changed by a stylist" }).eq("id", clientId);
    expect(await read()).toEqual(before);
  });
});
