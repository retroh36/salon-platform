// Stylists' own lengths: booking with them, a booking's own length,
// Denise's duration suggestions (applied and undone through the AI action
// log), proposals recorded by the server, and the risk check finding a
// visit likely to run over.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeInsights } from "@/lib/insights/compute";
import { scanDay } from "@/lib/denise/scan";
import { saveBooking } from "@/lib/scheduling/book";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, anon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const location = { id: L, timezone: TZ };
// A clear Tuesday well past the demo: Bridget works 9-1 and 2-6.
const DAY = addDays(startOfWeek(todayIn(TZ)), 7 * 35 + 1);
const at = (h: number, m = 0, day = DAY) => fromLocal(day, h * 60 + m, TZ)!;
// The risk check's day: the Wednesday after (Bridget works then too).
const RISK_DAY = addDays(DAY, 1);

let owner: Client;
let frontDesk: Client;
let client: string;
let balayage: string;
let cut: string;
const appointments: string[] = [];

beforeAll(async () => {
  [owner, frontDesk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: "DurTest" }).select("id").single();
  client = c!.id;
  const { data: s } = await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Balayage", "Women's Cut & Style"]);
  balayage = s!.find((x) => x.name === "Balayage")!.id;
  cut = s!.find((x) => x.name === "Women's Cut & Style")!.id;
  await computeInsights(admin, B);
});

afterAll(async () => {
  await admin.from("appointments").delete().in("id", appointments);
  await admin.from("ai_actions").delete().eq("feature", "duration");
  await admin.from("ai_actions").delete().like("subject", `${DAY}:%`);
  await admin.from("ai_actions").delete().like("subject", `${RISK_DAY}:%`);
  await admin.from("staff_services").update({ active_minutes: null, processing_minutes: null, finishing_minutes: null }).eq("staff_id", SEED.staff.bridget);
  await admin.from("clients").delete().eq("id", client);
});

const book = async (items: Parameters<typeof saveBooking>[2]["items"]) => {
  const r = await saveBooking(frontDesk, location, { clientId: client, notes: null, items });
  if (r.ok) appointments.push(r.appointmentId);
  return r;
};
const lengthOf = async (appointmentId: string) =>
  (await admin.from("appointment_items").select("active_minutes, processing_minutes, finishing_minutes").eq("appointment_id", appointmentId).single()).data!;

describe("a booking's own length", () => {
  it("can be set in minutes, stretching the finishing time after processing", async () => {
    const r = await book([{ serviceId: balayage, staffId: SEED.staff.bridget, start: at(9), resource: { kind: "any" }, minutes: 185 }]);
    expect(r.ok).toBe(true);
    // The menu's 75 + 40 + 40, made 185 minutes long.
    expect(await lengthOf(r.ok ? r.appointmentId : "")).toEqual({ active_minutes: 75, processing_minutes: 40, finishing_minutes: 70 });
  });

  it("refuses lengths that aren't in 5-minute steps", async () => {
    const { data: version } = await admin.from("locations").select("calendar_version").eq("id", L).single();
    const bad = await frontDesk.rpc("save_appointment", {
      p_location_id: L,
      p_appointment_id: null!,
      p_client_id: client,
      p_notes: "",
      p_items: [{ service_id: cut, staff_id: SEED.staff.bridget, resource_id: null, starts_at: at(16).toISOString(), timing: { active: 62, processing: 0, finishing: 0 } }],
      p_expected_version: version!.calendar_version,
    });
    expect(bad.error?.code).toBe("22023");
  });
});

describe("Denise's duration suggestions", () => {
  async function propose(client: Client) {
    return client.rpc("record_ai_proposals", {
      p_location_id: L,
      p_feature: "duration",
      p_subject: `duration:${SEED.staff.bridget}:${cut}`,
      p_options: [{ summary: "Cut with Bridget: 1h 15m", reason: "test", proposal: { staff_service: { staff_id: SEED.staff.bridget, service_id: cut, to: { active: 75, processing: 0, finishing: 0 } } } }],
    });
  }

  it("owners apply them; new bookings with that stylist take the new length; undo puts it back", async () => {
    const { data: ids } = await propose(owner);
    expect((await frontDesk.rpc("apply_duration_action", { p_action_id: ids![0] })).error?.code).toBe("42501");
    expect((await owner.rpc("apply_duration_action", { p_action_id: ids![0] })).error).toBeNull();
    const { data: ss } = await admin.from("staff_services").select("active_minutes").eq("staff_id", SEED.staff.bridget).eq("service_id", cut).single();
    expect(ss!.active_minutes).toBe(75);

    const r = await book([{ serviceId: cut, staffId: SEED.staff.bridget, start: at(14), resource: { kind: "any" } }]);
    expect(r.ok).toBe(true);
    expect((await lengthOf(r.ok ? r.appointmentId : "")).active_minutes).toBe(75);

    expect((await owner.rpc("undo_duration_action", { p_action_id: ids![0] })).error).toBeNull();
    const { data: after } = await admin.from("staff_services").select("active_minutes").eq("staff_id", SEED.staff.bridget).eq("service_id", cut).single();
    expect(after!.active_minutes).toBeNull();
    const { data: action } = await admin.from("ai_actions").select("status, previous_state").eq("id", ids![0]).single();
    expect(action!.status).toBe("undone");
  });
});

describe("proposals from the server", () => {
  it("only the service role records them, with no staff member", async () => {
    const args = { p_location_id: L, p_feature: "test", p_subject: `${DAY}:system-test`, p_options: [{ summary: "Test", reason: "", proposal: { changes: [] } }] };
    expect((await anon.rpc("record_ai_proposals_as_system", args)).error?.code).toBe("42501");
    expect((await frontDesk.rpc("record_ai_proposals_as_system", args)).error?.code).toBe("42501");
    const { data, error } = await admin.rpc("record_ai_proposals_as_system", args);
    expect(error).toBeNull();
    const { data: row } = await admin.from("ai_actions").select("proposed_by").eq("id", data![0]).single();
    expect(row!.proposed_by).toBeNull();
  });
});

describe("the risk check", () => {
  it("finds a balayage with Bridget likely to run into her next client, with fixes", async () => {
    // Bridget's balayage at 2pm, booked at the menu length (2h 35m), then a
    // cut straight after at 4:35. She usually takes longer.
    const first = await book([{ serviceId: balayage, staffId: SEED.staff.bridget, start: at(14, 0, RISK_DAY), resource: { kind: "any" } }]);
    const next = await book([{ serviceId: cut, staffId: SEED.staff.bridget, start: at(16, 35, RISK_DAY), resource: { kind: "any" } }]);
    expect(first.ok && next.ok).toBe(true);
    const state = await scanDay(frontDesk, { location, salon: "Maple & Ash", canBook: true }, RISK_DAY, { now: at(7, 0, RISK_DAY) });
    const risk = state.conflicts.find((c) => c.kind === "likely_overrun");
    expect(risk?.headline).toMatch(/^Bridget usually takes about \d+ minutes longer than booked for Balayage/);
    expect(risk!.options.length).toBeGreaterThan(0);
    expect(risk!.options[0].actionId).toBeTruthy();
  });
});
