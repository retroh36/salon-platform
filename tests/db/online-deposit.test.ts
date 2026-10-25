// The online deposit is charged before the visit is booked, so if booking
// then fails in any way (not just a time that was taken: the database
// unreachable, say), the deposit goes back and the client is told, rather
// than being charged with nothing booked.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testProvider } from "@/lib/payments/test-provider";
import { sha256 } from "@/lib/online-booking/security";
import { addDays, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, SEED } from "./helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }), cookies: async () => ({ get: () => undefined, set: () => {} }) }));
const booking = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/scheduling/online-book", async (original) => {
  const real = await original<typeof import("@/lib/scheduling/online-book")>();
  return { ...real, bookOnline: async (...args: Parameters<typeof real.bookOnline>) => (booking.fail ? Promise.reject(new Error("fetch failed")) : real.bookOnline(...args)) };
});

const { book, findTimes } = await import("@/app/book/[slug]/actions");

const B = SEED.business;
const TZ = "America/Chicago";
const DAY = addDays(startOfWeek(todayIn(TZ)), 15);
const RUN = `Od${crypto.randomUUID().slice(0, 8)}`;
const PHONE = "4895550163";
let session: string;
let clientId: string;
let balayage: string;

beforeAll(async () => {
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${RUN}Client`, phone: "(489) 555-0163", email: `${RUN.toLowerCase()}@example.com` }).select("id").single();
  clientId = c!.id;
  balayage = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Balayage").single()).data!.id;
  session = `${RUN}-session-secret`;
  await admin.from("online_verifications").insert({ business_id: B, channel: "sms", destination: PHONE, code_hash: sha256("x"), session_hash: sha256(session), expires_at: new Date(Date.now() + 600_000).toISOString(), verified_at: new Date().toISOString() });
  await admin.from("rate_limits").delete().neq("key", "");
});

afterAll(async () => {
  await admin.from("online_verifications").delete().eq("session_hash", sha256(session));
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
});

describe("the online deposit", () => {
  it("is refunded when booking fails after it's charged", async () => {
    const charge = vi.spyOn(testProvider, "charge");
    const refund = vi.spyOn(testProvider, "refund");
    const times = await findTimes("maple-and-ash", [balayage], null, DAY);
    if (!times.ok) throw new Error(times.message);
    const day = times.days.find((d) => d.times.length)!;
    booking.fail = true;
    const result = await book("maple-and-ash", {
      serviceIds: [balayage],
      staffId: null,
      date: day.date,
      minute: day.times[0].minute,
      session,
      agreed: true,
      cardRef: "test_visa_4242",
      source: "direct",
    } as Parameters<typeof book>[1]).catch((e: Error) => ({ ok: "threw", message: e.message }));
    booking.fail = false;
    expect(charge).toHaveBeenCalledTimes(1);
    const reference = (await charge.mock.results[0].value) as { ok: true; reference: string };
    expect(refund).toHaveBeenCalledWith(reference.reference);
    expect(result).toMatchObject({ ok: false });
    const { count } = await admin.from("appointments").select("id", { count: "exact", head: true }).eq("client_id", clientId);
    expect(count).toBe(0);
  });
});
