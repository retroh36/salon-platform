import { beforeAll, describe, expect, it } from "vitest";
import { admin, requireDemoData, SEED, signIn, type Client } from "./helpers";

// client_overview (migration …_client_overview.sql): the Clients list's
// last and next visit, usual stylist and spend. It runs as the signed-in
// member, so RLS still decides what they see.

let frontDesk: Client;
let bridget: Client;
let largeOwner: Client;

beforeAll(async () => {
  await requireDemoData();
  [frontDesk, bridget, largeOwner] = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test"), signIn("owner@harborvine.test")]);
});

describe("client_overview", () => {
  it("gives the front of house every client, with visits, usual stylist and spend that match the records", async () => {
    // The top spender with a usual stylist (a client who sees everyone has none).
    const { data, error } = await frontDesk
      .rpc("client_overview")
      .eq("business_id", SEED.business)
      .not("usual_staff_id", "is", null)
      .order("spend_cents", { ascending: false, nullsFirst: false })
      .limit(1)
      .single();
    expect(error).toBeNull();
    expect(data!.spend_cents).toBeGreaterThan(0);
    expect(data!.usual_staff_name).toBeTruthy();

    const { data: last } = await admin.from("appointments").select("starts_at").eq("client_id", data!.id).eq("status", "completed").order("starts_at", { ascending: false }).limit(1).single();
    expect(Date.parse(data!.last_visit_at!)).toBe(Date.parse(last!.starts_at));
    const { data: next } = await admin
      .from("appointments")
      .select("starts_at")
      .eq("client_id", data!.id)
      .in("status", ["booked", "confirmed", "checked_in"])
      .gt("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(1)
      .maybeSingle();
    expect(data!.next_visit_at ? Date.parse(data!.next_visit_at) : null).toBe(next ? Date.parse(next.starts_at) : null);

    const { count } = await frontDesk.rpc("client_overview", {}, { count: "exact", head: true });
    const { count: all } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("business_id", SEED.business);
    expect(count).toBe(all);
  });

  it("gives a stylist only their own book's clients, and no spend", async () => {
    const { data, error } = await bridget.rpc("client_overview");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    const { count: all } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("business_id", SEED.business);
    expect(data!.length).toBeLessThan(all!);
    expect(data!.every((c) => c.spend_cents === null)).toBe(true);
  });

  it("never shows another salon's clients", async () => {
    const { data } = await largeOwner.rpc("client_overview").eq("business_id", SEED.business);
    expect(data).toEqual([]);
    const { data: own } = await largeOwner.rpc("client_overview").limit(5);
    expect(own!.every((c) => c.business_id === SEED.large.business)).toBe(true);
  });

  it("isn't open to anyone signed out", async () => {
    const { anon } = await import("./helpers");
    const { data, error } = await anon.rpc("client_overview");
    expect(data ?? []).toEqual([]);
    expect(error).not.toBeNull();
  });
});
