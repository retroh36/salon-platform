// Before and after photos: the private bucket (no public links, one folder
// per salon), saving a photo to a visit, consent before marketing, and who
// can remove what.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anon, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const BUCKET = "visit-photos";
// A tiny JPEG header is enough for storage; the app checks real bytes.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

let frontDesk: Client;
let bridget: Client;
let manager: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let otherOwner: Client;
let clientId: string;
let appointmentId: string;

const path = (client = clientId) => `${B}/${client}/${crypto.randomUUID()}.jpg`;
async function upload(c: Client, p: string) {
  return c.storage.from(BUCKET).upload(p, JPEG, { contentType: "image/jpeg" });
}

beforeAll(async () => {
  [frontDesk, bridget, manager] = await Promise.all(["frontdesk", "bridget", "manager"].map((u) => signIn(`${u}@mapleandash.test`)));
  other = await createOtherSalon();
  otherOwner = await signIn(other.email);
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: "Photogenia", last_name: "Test" }).select("id").single();
  clientId = c!.id;
  const start = new Date(Date.now() - 2 * 3600_000);
  const end = new Date(start.getTime() + 3600_000);
  const { data: a } = await admin.from("appointments").insert({ business_id: B, location_id: L, client_id: clientId, starts_at: start.toISOString(), ends_at: end.toISOString(), status: "checked_in" }).select("id").single();
  appointmentId = a!.id;
  const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single();
  await admin.from("appointment_items").insert({ business_id: B, location_id: L, appointment_id: appointmentId, service_id: s!.id, staff_id: SEED.staff.bridget, starts_at: start.toISOString(), ends_at: end.toISOString(), active_minutes: 60, price_cents: 0 });
});

afterAll(async () => {
  const { data: files } = await admin.storage.from(BUCKET).list(`${B}/${clientId}`);
  if (files?.length) await admin.storage.from(BUCKET).remove(files.map((f) => `${B}/${clientId}/${f.name}`));
  await admin.from("appointments").delete().eq("id", appointmentId);
  await admin.from("clients").delete().eq("id", clientId);
  await other.cleanup();
});

describe("the bucket", () => {
  it("is private: no public links, and signed out or another salon sees nothing", async () => {
    const { data: bucket } = await admin.storage.getBucket(BUCKET);
    expect(bucket!.public).toBe(false);
    const p = path();
    expect((await upload(frontDesk, p)).error).toBeNull();
    const publicUrl = anon.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);
    expect((await anon.storage.from(BUCKET).download(p)).error).not.toBeNull();
    expect((await otherOwner.storage.from(BUCKET).download(p)).error).not.toBeNull();
    expect((await otherOwner.storage.from(BUCKET).createSignedUrl(p, 60)).error).not.toBeNull();
    // Staff get a short-lived signed link.
    const signed = await bridget.storage.from(BUCKET).createSignedUrl(p, 60);
    expect(signed.error).toBeNull();
    expect((await fetch(signed.data!.signedUrl)).ok).toBe(true);
    // No one writes into another salon's folder.
    expect((await upload(otherOwner, p.replace(/\.jpg$/, "-x.jpg"))).error).not.toBeNull();
    const own = `${other.businessId}/${clientId}/${crypto.randomUUID()}.jpg`;
    expect((await upload(otherOwner, own)).error).toBeNull();
    await admin.storage.from(BUCKET).remove([own]);
  });
});

describe("photos on a visit", () => {
  it("saves an uploaded photo to the visit with its stylist, in that client's folder only", async () => {
    const p = path();
    await upload(frontDesk, p);
    const { data: id, error } = await frontDesk.rpc("add_visit_photo", { p_appointment_id: appointmentId, p_kind: "before", p_path: p });
    expect(error).toBeNull();
    const { data: row } = await admin.from("visit_photos").select("client_id, staff_id, kind, created_by, marketing_ok").eq("id", id!).single();
    expect(row).toEqual({ client_id: clientId, staff_id: SEED.staff.bridget, kind: "before", created_by: SEED.staff.frontDesk, marketing_ok: false });

    // Not uploaded, someone else's folder, or a wrong tag: refused.
    expect((await frontDesk.rpc("add_visit_photo", { p_appointment_id: appointmentId, p_kind: "after", p_path: path() })).error?.message).toBe("Upload the photo first");
    const elsewhere = `${B}/${SEED.business}/${crypto.randomUUID()}.jpg`;
    await upload(frontDesk, elsewhere);
    expect((await frontDesk.rpc("add_visit_photo", { p_appointment_id: appointmentId, p_kind: "after", p_path: elsewhere })).error?.code).toBe("22023");
    await admin.storage.from(BUCKET).remove([elsewhere]);
    expect((await frontDesk.rpc("add_visit_photo", { p_appointment_id: appointmentId, p_kind: "during", p_path: p })).error?.code).toBe("22023");
    // Another salon can't add to this visit or see the photo.
    expect((await otherOwner.rpc("add_visit_photo", { p_appointment_id: appointmentId, p_kind: "after", p_path: p })).error?.code).toBe("42501");
    expect((await otherOwner.from("visit_photos").select("id").eq("id", id!)).data).toEqual([]);
    // Nobody writes the table directly.
    expect((await manager.from("visit_photos").update({ marketing_ok: true }).eq("id", id!).select()).data).toEqual([]);
  });

  it("is OK for marketing only once the client's consent is recorded, and withdrawing it takes them all out", async () => {
    const p = path();
    await upload(bridget, p);
    const { data: id } = await bridget.rpc("add_visit_photo", { p_appointment_id: appointmentId, p_kind: "after", p_path: p });
    const mark = (ok: boolean) => bridget.rpc("set_photo_marketing", { p_photo_id: id!, p_ok: ok });
    const refused = await mark(true);
    expect(refused.error?.code).toBe("55000");
    expect(refused.error?.hint).toBe("photo_consent");

    const tomorrowPlus = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await frontDesk.rpc("set_photo_consent", { p_client_id: clientId, p_on: tomorrowPlus })).error?.code).toBe("22023");
    expect((await frontDesk.rpc("set_photo_consent", { p_client_id: clientId, p_on: "2026-10-01" })).error).toBeNull();
    expect((await admin.from("clients").select("photo_consent_on, photo_consent_by").eq("id", clientId).single()).data).toEqual({ photo_consent_on: "2026-10-01", photo_consent_by: SEED.staff.frontDesk });
    expect((await mark(true)).error).toBeNull();
    expect((await admin.from("visit_photos").select("marketing_ok, marketing_marked_by").eq("id", id!).single()).data).toEqual({ marketing_ok: true, marketing_marked_by: SEED.staff.bridget });

    expect((await frontDesk.rpc("set_photo_consent", { p_client_id: clientId, p_on: null as never })).error).toBeNull();
    expect((await admin.from("visit_photos").select("marketing_ok").eq("client_id", clientId).eq("marketing_ok", true)).data).toEqual([]);
    expect((await otherOwner.rpc("set_photo_consent", { p_client_id: clientId, p_on: "2026-10-01" })).error?.code).toBe("42501");
  });

  it("is removed by whoever added it or a manager, file and all", async () => {
    const p = path();
    await upload(frontDesk, p);
    const { data: id } = await frontDesk.rpc("add_visit_photo", { p_appointment_id: appointmentId, p_kind: "before", p_path: p });
    // Bridget didn't add it: neither the row nor the file.
    expect((await bridget.rpc("delete_visit_photo", { p_photo_id: id! })).error?.code).toBe("42501");
    await bridget.storage.from(BUCKET).remove([p]);
    expect((await admin.storage.from(BUCKET).download(p)).error).toBeNull();
    // A manager can.
    const { data: removed, error } = await manager.rpc("delete_visit_photo", { p_photo_id: id! });
    expect(error).toBeNull();
    expect(removed).toBe(p);
    expect((await manager.storage.from(BUCKET).remove([p])).error).toBeNull();
    expect((await admin.storage.from(BUCKET).download(p)).error).not.toBeNull();
  });
});
