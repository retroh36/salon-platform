// A client message goes out only when staff send it: when staff drag, edit
// or move a visit to another day, the stylists are told, and the client is
// only asked about (app/calendar/move-prompt.tsx). Nothing is queued for the
// client until someone taps Send.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withMoveNotices } from "@/lib/move-notices";
import { moveItem, saveBooking, type BookingItemInput } from "@/lib/scheduling/book";
import { moveVisitTo } from "@/lib/scheduling/move-day";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const location = { id: L, timezone: TZ };
const { bridget: BRIDGET, shae: SHAE, frontDesk: FRONT_DESK } = SEED.staff;
// Tuesdays no other test uses.
const DAY = "2031-11-18";
const NEXT = "2031-11-25";
const at = (date: string, hour: number) => fromLocal(date, hour * 60, TZ)!;

let frontDesk: Client;
let clientId: string;
let cut: string;
const started = new Date().toISOString();

async function clear() {
  await admin.from("appointments").delete().eq("location_id", L).gte("starts_at", at(DAY, 0).toISOString()).lt("starts_at", at("2031-11-26", 0).toISOString());
}

beforeAll(async () => {
  frontDesk = await signIn("frontdesk@mapleandash.test");
  const { data: c } = await admin
    .from("clients")
    .insert({ business_id: B, first_name: "Moveprompt", last_name: "Test", phone: "(312) 555-0177", email: "moveprompt@example.test" })
    .select("id")
    .single();
  clientId = c!.id;
  cut = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Women's Cut & Style").single()).data!.id;
  await clear();
});

afterAll(async () => {
  await clear();
  await admin.from("client_messages").delete().eq("client_id", clientId);
  await admin.from("outbox_messages").delete().like("body", "%Moveprompt%");
  await admin.from("clients").delete().eq("id", clientId);
});

const item = (staffId: string, start: Date, id?: string): BookingItemInput => ({ id, serviceId: cut, staffId, start, resource: { kind: "none" } });

async function visit(start: Date) {
  const r = await saveBooking(frontDesk, location, { clientId, notes: null, items: [item(BRIDGET, start)] });
  if (!r.ok) throw new Error(`Couldn't set up a booking: ${JSON.stringify(r)}`);
  const { data } = await admin.from("appointment_items").select("id").eq("appointment_id", r.appointmentId).single();
  return { appointmentId: r.appointmentId, itemId: data!.id };
}

// Everything that could reach the client since the test began.
async function toClient() {
  const [notices, messages, outbox] = await Promise.all([
    admin.from("notifications").select("template, status").eq("client_id", clientId),
    admin.from("client_messages").select("template, sent_by").eq("client_id", clientId),
    admin.from("outbox_messages").select("body").gte("created_at", started).like("body", "%Moveprompt%"),
  ]);
  return { notices: notices.data!, messages: messages.data!, outbox: outbox.data! };
}

describe("staff moves", () => {
  it("never queue a client message without an explicit Send", async () => {
    const v = await visit(at(DAY, 10));
    const nothing = { notices: [], messages: [], outbox: [] };

    // A drag to a new time and stylist.
    const dragged = await withMoveNotices(frontDesk, location, v.appointmentId, () => moveItem(frontDesk, location, { itemId: v.itemId, staffId: SHAE, start: at(DAY, 14) }));
    expect(dragged.result.ok).toBe(true);
    expect(dragged.moved?.appointmentIds).toEqual([v.appointmentId]);
    expect(await toClient()).toEqual(nothing);

    // Edit booking: a new time and the stylist back.
    const edited = await withMoveNotices(frontDesk, location, v.appointmentId, () =>
      saveBooking(frontDesk, location, { appointmentId: v.appointmentId, clientId, notes: null, items: [item(BRIDGET, at(DAY, 11), v.itemId)] }),
    );
    expect(edited.result.ok).toBe(true);
    expect(edited.moved?.appointmentIds).toEqual([v.appointmentId]);
    expect(await toClient()).toEqual(nothing);

    // Move to another day.
    const moved = await withMoveNotices(frontDesk, location, v.appointmentId, () => moveVisitTo(frontDesk, location, { appointmentId: v.appointmentId, date: NEXT, startMinute: 10 * 60 }, "this"));
    expect(moved.result.kind === "single" && moved.result.result.ok).toBe(true);
    expect(await toClient()).toEqual(nothing);

    // The stylists were told each time.
    const { data: stylists } = await admin.from("notifications").select("staff_id, template").eq("appointment_id", v.appointmentId);
    expect(new Set(stylists!.map((n) => n.template))).toEqual(new Set(["staff_visit_moved"]));
    expect(new Set(stylists!.map((n) => n.staff_id))).toEqual(new Set([BRIDGET, SHAE]));

    // A new chair, the same time and stylist: nothing to ask about.
    const chair = await withMoveNotices(frontDesk, location, v.appointmentId, () => moveItem(frontDesk, location, { itemId: v.itemId, staffId: BRIDGET, start: at(NEXT, 10) }));
    expect(chair.moved).toBeNull();

    // Only Send reaches the client, once, logged with who sent it.
    const sent = await frontDesk.rpc("send_client_message", {
      p_appointment_id: v.appointmentId,
      p_purpose: "appointment",
      p_template: "visit_moved",
      p_channel: "email",
      p_subject: "Your visit has moved",
      p_body: "Hi Moveprompt, we've moved your visit.",
    });
    expect(sent.error).toBeNull();
    const after = await toClient();
    expect(after.notices).toEqual([]);
    expect(after.messages).toEqual([{ template: "visit_moved", sent_by: FRONT_DESK }]);
    expect(after.outbox).toHaveLength(1);
  });

  it("refuse a client notice from a move, and none is left pending from before", async () => {
    const v = await visit(at(DAY, 15));
    const { data: user } = await frontDesk.auth.getUser();
    const notice = (n: Record<string, unknown>) =>
      admin.rpc("record_visit_notices_for_user", { p_user_id: user.user!.id, p_appointment_id: v.appointmentId, p_notices: [n] as never });
    const refused = await notice({ template: "visit_moved", body: "Your visit has moved", client_id: clientId, staff_id: null });
    expect(refused.error?.message).toBe("A move never records a message to a client");
    expect((await notice({ template: "staff_visit_moved", body: "x", client_id: clientId, staff_id: BRIDGET })).error?.message).toBe("A move never records a message to a client");
    expect((await notice({ template: "staff_visit_moved", body: "Moved.", client_id: null, staff_id: BRIDGET })).error).toBeNull();

    const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("template", "visit_moved").eq("status", "pending");
    expect(count).toBe(0);
  });

  it("the salon chooses which answer the question leans to, nothing else", async () => {
    const owner = await signIn("owner@mapleandash.test");
    expect((await owner.from("businesses").update({ move_message_default: "skip" }).eq("id", B).select("id")).data).toHaveLength(1);
    expect((await owner.from("businesses").update({ move_message_default: "always" }).eq("id", B)).error?.code).toBe("23514");
    await admin.from("businesses").update({ move_message_default: "send" }).eq("id", B);
  });
});
