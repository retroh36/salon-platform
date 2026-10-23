// Patch tests and forms: who can record and see them, the hard block when
// the salon requires a valid patch test, and the warnings before a visit.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { visitWarnings } from "@/lib/client-checks";
import { saveBooking } from "@/lib/scheduling/book";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const location = { id: L, timezone: TZ };
const DAY = "2031-09-09";
const at = (h: number) => fromLocal(DAY, h * 60, TZ)!;
const SIG = "data:image/png;base64,iVBORw0KGgo=";

let owner: Client, frontDesk: Client, bridget: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let otherOwner: Client;
let clientId: string;
let gloss: string;
let cut: string;

beforeAll(async () => {
  [owner, frontDesk, bridget] = await Promise.all([signIn("owner@mapleandash.test"), signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  other = await createOtherSalon();
  otherOwner = await signIn(other.email);
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: "Patchy", last_name: "Test" }).select("id").single();
  clientId = c!.id;
  const { data: s } = await admin.from("services").select("id, name, requires_patch_test").eq("business_id", B).in("name", ["Gloss / Toner", "Women's Cut & Style"]);
  gloss = s!.find((x) => x.name === "Gloss / Toner")!.id;
  cut = s!.find((x) => x.name === "Women's Cut & Style")!.id;
  expect(s!.find((x) => x.id === gloss)!.requires_patch_test).toBe(true);
  expect(s!.find((x) => x.id === cut)!.requires_patch_test).toBe(false);
});

afterAll(async () => {
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("businesses").update({ patch_test_enforcement: "warn" }).eq("id", B);
  await admin.from("form_templates").delete().eq("business_id", B).like("name", "Test form%");
  await other.cleanup();
});

describe("patch tests", () => {
  it("any staff member records one; everyone in the salon sees them, no one else; no edits", async () => {
    const { error } = await bridget.from("client_patch_tests").insert({ business_id: B, client_id: clientId, tested_at: new Date(Date.now() - 3_600_000).toISOString(), products: "6N + 20 vol", result: "no_reaction", performed_by: SEED.staff.bridget });
    expect(error).toBeNull();
    expect((await frontDesk.from("client_patch_tests").select("id").eq("client_id", clientId)).data).toHaveLength(1);
    expect((await otherOwner.from("client_patch_tests").select("id").eq("client_id", clientId)).data).toHaveLength(0);
    const { data: changed } = await owner.from("client_patch_tests").update({ result: "reaction" }).eq("client_id", clientId).select("id");
    expect(changed).toHaveLength(0);
    const { error: cross } = await otherOwner.from("client_patch_tests").insert({ business_id: B, client_id: clientId, tested_at: new Date().toISOString(), products: "x", result: "no_reaction", performed_by: other.staffId });
    expect(cross?.code).toBe("42501");
  });

  it("blocks a booking that needs one only when the salon says so", async () => {
    // The test above is years before DAY, so it has expired.
    const book = () => saveBooking(frontDesk, location, { clientId, notes: null, items: [{ serviceId: gloss, staffId: SEED.staff.bridget, start: at(10), resource: { kind: "none" } }] });
    const warned = await book();
    expect(warned.ok).toBe(true);
    await admin.from("appointments").delete().eq("client_id", clientId);

    await admin.from("businesses").update({ patch_test_enforcement: "block" }).eq("id", B);
    const blocked = await book();
    expect(blocked).toEqual({ ok: false, error: "invalid", problems: [[{ code: "patch_test", state: "expired" }]] });
    // A cut doesn't need one.
    const ok = await saveBooking(frontDesk, location, { clientId, notes: null, items: [{ serviceId: cut, staffId: SEED.staff.bridget, start: at(10), resource: { kind: "none" } }] });
    expect(ok.ok).toBe(true);
    // A recent enough test lets it through.
    await admin.from("client_patch_tests").insert({ business_id: B, client_id: clientId, tested_at: fromLocal("2031-09-01", 600, TZ)!.toISOString(), products: "6N", result: "no_reaction", performed_by: SEED.staff.bridget });
    expect((await saveBooking(frontDesk, location, { clientId, notes: null, items: [{ serviceId: gloss, staffId: SEED.staff.bridget, start: at(14), resource: { kind: "none" } }] })).ok).toBe(true);
    await admin.from("businesses").update({ patch_test_enforcement: "warn" }).eq("id", B);
  });

  it("only owners change the rules", async () => {
    expect((await frontDesk.from("businesses").update({ patch_test_valid_days: 30 }).eq("id", B).select("id")).data).toHaveLength(0);
    expect((await owner.from("businesses").update({ patch_test_valid_days: 182 }).eq("id", B).select("id")).data).toHaveLength(1);
  });
});

describe("forms", () => {
  it("owners build templates; others only read them", async () => {
    const row = { business_id: B, name: "Test form A", fields: [{ id: "s", type: "signature", label: "Sign", required: true }], required: "none" as const };
    expect((await frontDesk.from("form_templates").insert(row)).error?.code).toBe("42501");
    expect((await owner.from("form_templates").insert(row)).error).toBeNull();
    expect((await bridget.from("form_templates").select("id").eq("name", "Test form A")).data).toHaveLength(1);
    expect((await otherOwner.from("form_templates").select("id").eq("business_id", B)).data).toHaveLength(0);
    // "Before some services" needs services.
    expect((await owner.from("form_templates").insert({ ...row, name: "Test form B", required: "services" })).error?.code).toBe("23514");
  });

  it("staff collect signed forms as themselves; signed forms can't be changed", async () => {
    const { data: t } = await admin.from("form_templates").select("id, name, fields").eq("name", "Test form A").single();
    const form = { business_id: B, client_id: clientId, template_id: t!.id, template_name: t!.name, fields: t!.fields, answers: { s: true }, signature: SIG };
    expect((await frontDesk.from("client_forms").insert({ ...form, collected_by: SEED.staff.bridget })).error?.code).toBe("42501");
    expect((await frontDesk.from("client_forms").insert({ ...form, collected_by: SEED.staff.frontDesk })).error).toBeNull();
    expect((await frontDesk.from("client_forms").insert({ ...form, signature: "javascript:alert(1)", collected_by: SEED.staff.frontDesk })).error?.code).toBe("23514");
    expect((await owner.from("client_forms").update({ answers: {} }).eq("client_id", clientId).select("id")).data).toHaveLength(0);
    expect((await otherOwner.from("client_forms").select("id").eq("client_id", clientId)).data).toHaveLength(0);
  });

  it("warns before a visit about missing forms and patch tests", async () => {
    // A new client booking color: the consultation (first visit) and color consent.
    const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: "Newby", last_name: "Test" }).select("id").single();
    try {
      const warnings = await visitWarnings(frontDesk, B, [{ appointmentId: "a", clientId: c!.id, start: at(10), items: [{ serviceId: gloss, start: at(10) }] }]);
      expect(warnings.get("a")).toEqual({
        patch: ["No patch test on record for this client."],
        patchNotices: [{ title: "Patch test missing — required for Gloss / Toner", detail: "None on file for this client." }],
        patchBlocks: false,
        forms: [
          { templateId: "e3000000-0000-4000-8000-000000000002", name: "Color consent" },
          { templateId: "e3000000-0000-4000-8000-000000000001", name: "New client consultation" },
        ],
      });
      const cutOnly = await visitWarnings(frontDesk, B, [{ appointmentId: "a", clientId: c!.id, start: at(10), items: [{ serviceId: cut, start: at(10) }] }]);
      expect(cutOnly.get("a")?.forms.map((f) => f.name)).toEqual(["New client consultation"]);
    } finally {
      await admin.from("clients").delete().eq("id", c!.id);
    }
  });
});
