// Waitlist offers (migration …_waitlist_offers.sql, lib/waitlist-offers.ts,
// app/offer/[token]/actions.ts): the front of house offers an opening to a
// waitlist client; the client takes it (booked by the booking rules) or says
// no thanks from the link; whoever sent it is told in the app.
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerOffer } from "@/app/offer/[token]/actions";
import { toLocal } from "@/lib/scheduling/time";
import { loadOffer, offerMessage } from "@/lib/waitlist-offers";
import { admin, type Client, openAllDay, SEED, signIn, throwawayStylist } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const TAG = `Wof${Date.now().toString(36)}`;
const MIN = 60_000;

let frontDesk: Client;
let stylistLogin: Client;
let frontDeskId: string;
let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
let blowout: string;
let undoHours: () => Promise<void>;
const clients: string[] = [];

const token = () => randomBytes(32).toString("base64url");
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
// 40 to 55 minutes from now, on the quarter hour, as openings are (held
// until 15 minutes before it).
const soon = () => new Date(Math.ceil((Date.now() + 40 * MIN) / (15 * MIN)) * 15 * MIN);

async function waiting() {
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Ava`, last_name: "Test", phone: "3125550177" }).select("id").single();
  clients.push(c!.id);
  const today = toLocal(new Date(), TZ).date;
  const { data: e, error } = await admin
    .from("waitlist_entries")
    .insert({ business_id: B, location_id: L, client_id: c!.id, service_ids: [blowout], from_date: today, to_date: today })
    .select("id")
    .single();
  if (error) throw error;
  return { clientId: c!.id, entryId: e!.id };
}

async function offer(who: Client, entryId: string, start = soon(), t = token()) {
  const r = await who.rpc("create_waitlist_offer", {
    p_entry_id: entryId,
    p_staff_id: stylist.id,
    p_starts_at: start.toISOString(),
    p_token_hash: hash(t),
    p_channel: "sms",
    p_to: "3125550177",
    p_minutes: 60,
  });
  return { ...r, token: t };
}

beforeAll(async () => {
  frontDesk = await signIn("frontdesk@mapleandash.test");
  stylistLogin = await signIn("bridget@mapleandash.test");
  frontDeskId = (await admin.from("staff").select("id").eq("email", "frontdesk@mapleandash.test").single()).data!.id;
  stylist = await throwawayStylist(`${TAG}Sty`);
  blowout = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single()).data!.id;
  await admin.from("staff_services").insert({ business_id: B, staff_id: stylist.id, service_id: blowout });
  // The stylist works all day on the day of the offer's time.
  undoHours = await openAllDay([stylist.id], { date: toLocal(soon(), TZ).date });
});

afterAll(async () => {
  await undoHours();
  await admin.from("appointments").delete().in("client_id", clients);
  await admin.from("clients").delete().in("id", clients);
  await stylist.remove();
});

describe("waitlist offers", () => {
  it("are sent by the front of house only, one open at a time, held until before the time", async () => {
    const w = await waiting();
    expect((await offer(stylistLogin, w.entryId)).error?.code).toBe("42501");
    const first = await offer(frontDesk, w.entryId);
    expect(first.error).toBeNull();
    await offer(frontDesk, w.entryId);
    const { data: rows } = await frontDesk.from("waitlist_offers").select("status, expires_at, starts_at").eq("entry_id", w.entryId).order("created_at");
    expect(rows!.map((r) => r.status)).toEqual(["canceled", "open"]);
    // Never past 15 minutes before the time.
    expect(Date.parse(rows![1].starts_at) - Date.parse(rows![1].expires_at)).toBe(15 * MIN);
    // The replaced link no longer works.
    expect((await loadOffer(admin, first.token))!.status).toBe("canceled");
    // Too close to offer.
    const tooSoon = await offer(frontDesk, w.entryId, new Date(Date.now() + 10 * MIN));
    expect(tooSoon.error?.hint).toBe("too_soon");
  });

  it("can be turned down from the link, which tells whoever sent it and keeps them waiting", async () => {
    const w = await waiting();
    const sent = await offer(frontDesk, w.entryId);
    expect(await answerOffer(sent.token, false)).toEqual({ ok: true, taken: false, manageUrl: null });
    expect((await loadOffer(admin, sent.token))!.status).toBe("declined");
    expect((await admin.from("waitlist_entries").select("status").eq("id", w.entryId).single()).data!.status).toBe("waiting");
    const { data: notice } = await admin.from("notifications").select("body, template").eq("staff_id", frontDeskId).eq("template", "waitlist_offer_declined").order("created_at", { ascending: false }).limit(1);
    expect(notice![0].body).toContain(`${TAG}Ava Test said no thanks`);
    // Once answered, the link can't be used again.
    expect((await answerOffer(sent.token, true)).ok).toBe(false);
  });

  it("can be taken from the link: booked by the booking rules, off the waitlist", async () => {
    const w = await waiting();
    const start = soon();
    const sent = await offer(frontDesk, w.entryId, start);
    // A new client: the demo's policy asks for a card, agreed to first.
    expect(await answerOffer(sent.token, true)).toMatchObject({ ok: false, message: "Please agree to the cancellation policy first." });
    const result = await answerOffer(sent.token, true, { cardRef: "test_visa_4242", agreed: true });
    expect(result).toMatchObject({ ok: true, taken: true });
    const o = await loadOffer(admin, sent.token);
    expect(o!.status).toBe("taken");
    const { data: visit } = await admin.from("appointments").select("starts_at, source, online_source, appointment_items(staff_id)").eq("id", o!.appointmentId!).single();
    expect(Date.parse(visit!.starts_at)).toBe(start.getTime());
    expect(visit).toMatchObject({ source: "online", online_source: "waitlist", appointment_items: [{ staff_id: stylist.id }] });
    expect((await admin.from("waitlist_entries").select("status, appointment_id").eq("id", w.entryId).single()).data).toEqual({ status: "booked", appointment_id: o!.appointmentId });
    const { data: notice } = await admin.from("notifications").select("body").eq("staff_id", frontDeskId).eq("template", "waitlist_offer_taken").order("created_at", { ascending: false }).limit(1);
    expect(notice![0].body).toContain("took the waitlist spot");

    // The same time offered to someone else is gone now; they stay waiting.
    const other = await waiting();
    const second = await offer(frontDesk, other.entryId, start);
    expect(await answerOffer(second.token, true, { cardRef: "test_visa_4242", agreed: true })).toMatchObject({ ok: false, message: expect.stringContaining("just been taken") });
    expect((await admin.from("waitlist_entries").select("status").eq("id", other.entryId).single()).data!.status).toBe("waiting");
  });

  it("is our fixed wording", () => {
    expect(offerMessage("Maple & Ash", "Ava", ["Blowout"], "Gil", "Tue, Nov 10 at 2:15pm", "1:15pm", "https://x.test/offer/abc", "sms")).toEqual({
      subject: null,
      body: "Maple & Ash: Hi Ava, a spot opened up for your Blowout with Gil on Tue, Nov 10 at 2:15pm. Take it or say no thanks here, by 1:15pm: https://x.test/offer/abc",
    });
  });
});
