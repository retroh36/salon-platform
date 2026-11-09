// Importing clients in the database: who may, nobody overwritten or added
// twice, no marketing consent, and undo keeping anyone who's been in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TAG = `Imp${Date.now().toString(36)}`;
const digits = () => String(Math.floor(1000000 + Math.random() * 8999999));
const phone = () => {
  const d = digits();
  return `(872) ${d.slice(0, 3)}-${d.slice(3, 7)}`;
};
let owner: Client;
let frontDesk: Client;
const imports: string[] = [];

const row = (over: Record<string, unknown>) => ({ first_name: `${TAG}A`, last_name: "Test", phone: null, email: null, birth_month: null, birth_day: null, notes: null, allergies: null, ...over });
const run = async (rows: unknown[], id: string | null = null) => {
  const { data, error } = await owner.rpc("import_clients", { p_business_id: B, p_import_id: id as string, p_file_name: "test.csv", p_rows: rows as never });
  expect(error).toBeNull();
  const r = data as { import_id: string; added: number; skipped: number };
  imports.push(r.import_id);
  return r;
};

beforeAll(async () => {
  [owner, frontDesk] = await Promise.all(["owner", "frontdesk"].map((u) => signIn(`${u}@mapleandash.test`)));
});
afterAll(async () => {
  await admin.from("appointments").delete().in("client_id", ((await admin.from("clients").select("id").like("first_name", `${TAG}%`)).data ?? []).map((c) => c.id));
  await admin.from("clients").delete().like("first_name", `${TAG}%`);
  await admin.from("client_imports").delete().in("id", imports);
});

describe("importing clients", () => {
  it("is for owners and managers", async () => {
    const { error } = await frontDesk.rpc("import_clients", { p_business_id: B, p_import_id: null as never, p_file_name: "x.csv", p_rows: [row({})] as never });
    expect(error?.code).toBe("42501");
  });

  it("adds new clients with no marketing consent, and leaves anyone already here as they are", async () => {
    const p = phone();
    const email = `${TAG}@example.test`.toLowerCase();
    const { data: existing } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}Old`, last_name: "Here", phone: p, notes: "Keep this" }).select("id").single();
    const r = await run([row({ first_name: `${TAG}New`, email, notes: "Hello", birth_month: 3, birth_day: 14 }), row({ first_name: `${TAG}Changed`, phone: p, notes: "Overwrite" }), row({ first_name: `${TAG}Twin`, email })]);
    expect(r).toMatchObject({ added: 1, skipped: 2 });
    const { data: added } = await admin.from("clients").select("notes, sms_opt_in, email_opt_in, appointment_sms_ok, birth_month, import_id").eq("first_name", `${TAG}New`).single();
    expect(added).toEqual({ notes: "Hello", sms_opt_in: false, email_opt_in: false, appointment_sms_ok: true, birth_month: 3, import_id: r.import_id });
    expect((await admin.from("clients").select("first_name, notes").eq("id", existing!.id).single()).data).toEqual({ first_name: `${TAG}Old`, notes: "Keep this" });
    // The same file again adds nobody.
    expect(await run([row({ first_name: `${TAG}New`, email })])).toMatchObject({ added: 0, skipped: 1 });
  });

  it("carries one import across batches, and refuses an oversize batch", async () => {
    const first = await run([row({ first_name: `${TAG}B1`, phone: phone() })]);
    await run([row({ first_name: `${TAG}B2`, phone: phone() })], first.import_id);
    expect((await admin.from("client_imports").select("added").eq("id", first.import_id).single()).data!.added).toBe(2);
    const big = await owner.rpc("import_clients", { p_business_id: B, p_import_id: null as never, p_file_name: "x.csv", p_rows: Array(1001).fill(row({})) as never });
    expect(big.error?.code).toBe("22023");
  });

  it("undoes an import, keeping a client with a visit, once only", async () => {
    const r = await run([row({ first_name: `${TAG}Gone`, phone: phone() }), row({ first_name: `${TAG}Stays`, phone: phone() })]);
    const { data: stays } = await admin.from("clients").select("id").eq("first_name", `${TAG}Stays`).single();
    const { error: visitError } = await admin.from("appointments").insert({ business_id: B, location_id: SEED.location, client_id: stays!.id, starts_at: "2027-06-01T15:00:00Z", ends_at: "2027-06-01T16:00:00Z" } as never);
    expect(visitError).toBeNull();
    expect((await frontDesk.rpc("undo_client_import", { p_import_id: r.import_id })).error?.code).toBe("42501");
    expect((await owner.rpc("undo_client_import", { p_import_id: r.import_id })).data).toEqual({ removed: 1, kept: 1 });
    expect((await admin.from("clients").select("id").eq("first_name", `${TAG}Gone`)).data).toEqual([]);
    expect((await owner.rpc("undo_client_import", { p_import_id: r.import_id })).error?.code).toBe("22023");
  });
});
