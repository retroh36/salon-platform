// "Not charged, and why" (migration …_policy_not_charged.sql): every
// no-show and late cancellation with its booked value, fee and what was
// collected, for those with Reports, without client names.
import { beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const args = { p_business_id: B, p_from: new Date(Date.now() - 200 * 86_400_000).toISOString(), p_to: new Date().toISOString() };
let owner: Client;
let books: Client;
let desk: Client;

beforeAll(async () => {
  [owner, books, desk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("books@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
});

describe("policy_not_charged", () => {
  it("has every no-show and late cancellation, with its fee and what was collected", async () => {
    const { data, error } = await owner.rpc("policy_not_charged", args);
    expect(error).toBeNull();
    const { data: fees } = await admin
      .from("policy_fees")
      .select("kind, status, fee_cents, appointment:appointments!inner(starts_at)")
      .eq("business_id", B)
      .neq("status", "voided")
      .gte("appointment.starts_at", args.p_from)
      .lt("appointment.starts_at", args.p_to);
    const { count: unassessed } = await admin
      .from("appointments")
      .select("id, policy_fees!left(id)", { count: "exact", head: true })
      .eq("business_id", B)
      .eq("status", "no_show")
      .is("policy_fees", null)
      .gte("starts_at", args.p_from)
      .lt("starts_at", args.p_to);
    expect(data!.length).toBe(fees!.length + (unassessed ?? 0));
    expect(data!.filter((r) => r.status === "no_card").length).toBe(fees!.filter((f) => f.status === "no_card").length);
    const charged = (data ?? []).filter((r) => r.status === "charged");
    expect(charged.reduce((n, r) => n + r.collected_cents, 0)).toBe(fees!.filter((f) => f.status === "charged").reduce((n, f) => n + f.fee_cents, 0));
    expect(data!.every((r) => r.visit_cents >= 0 && (r.status !== "waived" || r.collected_cents === 0))).toBe(true);
    expect(data!.some((r) => r.status === "waived" && r.waive_reason)).toBe(true);
  });

  it("is the same for a bookkeeper, and nothing without Reports", async () => {
    const [o, b, d] = await Promise.all([owner.rpc("policy_not_charged", args), books.rpc("policy_not_charged", args), desk.rpc("policy_not_charged", args)]);
    expect(b.data).toEqual(o.data);
    expect(d.data).toEqual([]);
  });

  it("never gives another salon's", async () => {
    const { data } = await owner.rpc("policy_not_charged", { ...args, p_business_id: SEED.large.business });
    expect(data).toEqual([]);
  });
});
