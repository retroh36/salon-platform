// Consultation forms by link (migration …_form_links.sql, lib/form-links.ts):
// the front of house sends a visit's unsigned forms; the client signs them on
// their phone through the service role; a form signed at the desk counts too.
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { policyForBooking } from "@/lib/booking-policy";
import { loadFormLink } from "@/lib/form-links";
import { admin, anon, type Client, SEED, signIn, throwawayStylist } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TAG = `Frm${Date.now().toString(36)}`;
const HOUR = 3_600_000;

let frontDesk: Client;
let stylistLogin: Client;
let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
const clients: string[] = [];
const template: Record<string, string> = {};
let balayage: string;

const token = () => randomBytes(32).toString("base64url");
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

let hours = 96;
async function visitFor() {
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Ava`, last_name: "Test", phone: "3125550188" }).select("id").single();
  clients.push(c!.id);
  hours += 2;
  const start = new Date(Date.now() + hours * HOUR);
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + HOUR);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: c!.id, starts_at: start.toISOString(), ends_at: end.toISOString() }).select("id").single();
  await admin
    .from("appointment_items")
    .insert({ business_id: B, location_id: L, appointment_id: a!.id, service_id: balayage, staff_id: stylist.id, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 24000 });
  return { clientId: c!.id, appointmentId: a!.id };
}

async function send(who: Client, appointmentId: string, t = token()) {
  const r = await who.rpc("create_form_request", {
    p_appointment_id: appointmentId,
    p_template_ids: [template["New client consultation"], template["Color consent"]],
    p_token_hash: hash(t),
    p_channel: "sms",
    p_to: "3125550188",
    p_hours: 336,
  });
  return { ...r, token: t };
}

beforeAll(async () => {
  frontDesk = await signIn("frontdesk@mapleandash.test");
  stylistLogin = await signIn("bridget@mapleandash.test");
  stylist = await throwawayStylist(`${TAG}Sty`);
  const { data } = await admin.from("form_templates").select("id, name").eq("business_id", B);
  for (const t of data!) template[t.name] = t.id;
  balayage = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Balayage").single()).data!.id;
});

afterAll(async () => {
  await admin.from("appointments").delete().in("client_id", clients);
  await admin.from("clients").delete().in("id", clients);
  await stylist.remove();
});

describe("form links", () => {
  it("are sent by the front of house only, for a visit still to come", async () => {
    const v = await visitFor();
    expect((await send(stylistLogin, v.appointmentId)).error?.code).toBe("42501");
    const sent = await send(frontDesk, v.appointmentId);
    expect(sent.error).toBeNull();
    const { data: rows } = await frontDesk.from("form_requests").select("status, expires_at").eq("appointment_id", v.appointmentId);
    expect(rows).toHaveLength(1);
    // A new link replaces the open one.
    await send(frontDesk, v.appointmentId);
    const { data: again } = await admin.from("form_requests").select("status").eq("appointment_id", v.appointmentId).order("created_at");
    expect(again!.map((r) => r.status)).toEqual(["canceled", "open"]);
  });

  it("are signed by the client through the service role, once each, and close when all are signed", async () => {
    const v = await visitFor();
    const { data: id, token: t } = await send(frontDesk, v.appointmentId);
    const args = { p_request_id: id!, p_template_id: template["Color consent"], p_answers: {}, p_signature: null as never };
    expect((await anon.rpc("sign_form_from_link", args)).error?.code).toBe("42501");
    expect((await admin.rpc("sign_form_from_link", args)).data).toBe(1);
    expect((await admin.rpc("sign_form_from_link", args)).error?.hint).toBe("signed");
    const link = await loadFormLink(admin, t);
    expect(link!.forms.map((f) => [f.name, f.signed])).toEqual([
      ["New client consultation", false],
      ["Color consent", true],
    ]);
    expect((await admin.rpc("sign_form_from_link", { ...args, p_template_id: template["New client consultation"] })).data).toBe(0);
    expect((await admin.from("form_requests").select("status").eq("id", id!).single()).data!.status).toBe("done");
    const { data: forms } = await frontDesk.from("client_forms").select("template_name, form_request_id").eq("client_id", v.clientId);
    expect(forms).toHaveLength(2);
    expect(forms!.every((f) => f.form_request_id === id)).toBe(true);
  });

  it("count a form signed at the desk after the link went", async () => {
    const v = await visitFor();
    const { data: id, token: t } = await send(frontDesk, v.appointmentId);
    const { data: fields } = await admin.from("form_templates").select("name, fields").eq("id", template["Color consent"]).single();
    const { data: me } = await admin.from("staff").select("id").eq("email", "frontdesk@mapleandash.test").single();
    await frontDesk.from("client_forms").insert({ business_id: B, client_id: v.clientId, template_id: template["Color consent"], template_name: fields!.name, fields: fields!.fields, answers: {}, collected_by: me!.id });
    expect((await loadFormLink(admin, t))!.forms.find((f) => f.name === "Color consent")!.signed).toBe(true);
    expect((await admin.rpc("sign_form_from_link", { p_request_id: id!, p_template_id: template["Color consent"], p_answers: {}, p_signature: null as never })).error?.hint).toBe("signed");
  });

  it("are offered before booking for the forms a visit will need", async () => {
    const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}New`, last_name: "Test", phone: "3125550187" }).select("id").single();
    clients.push(c!.id);
    const p = await policyForBooking(frontDesk, B, "front_desk", c!.id, [{ serviceId: balayage, staffId: stylist.id, priceCents: 24000 }]);
    expect(p!.forms.sort()).toEqual(["Color consent", "New client consultation"]);
  });
});
