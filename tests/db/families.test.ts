// Families (migration …_families.sql, app/clients/family-actions.ts):
// clients linked into a household, written only through save_family /
// delete_family by the front of house, kept to the salon.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, type Client, createOtherSalon, SEED, signIn } from "./helpers";

const B = SEED.business;
const TAG = `Fam${Date.now().toString(36)}`;

let frontDesk: Client;
let stylist: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let otherOwner: Client;
const ids: string[] = [];

async function client(first: string) {
  const { data, error } = await admin.from("clients").insert({ business_id: B, first_name: `${TAG}${first}`, last_name: "Park" }).select("id").single();
  if (error) throw error;
  ids.push(data.id);
  return data.id;
}

const save = (who: Client, members: string[], payer: string | null = null, familyId: string | null = null, name = "The Parks") =>
  who.rpc("save_family", { p_business_id: B, p_family_id: familyId as string, p_name: name, p_client_ids: members, p_payer_client_id: payer as string });

beforeAll(async () => {
  frontDesk = await signIn("frontdesk@mapleandash.test");
  stylist = await signIn("bridget@mapleandash.test");
  other = await createOtherSalon();
  otherOwner = await signIn(other.email);
});

afterAll(async () => {
  await admin.from("families").delete().eq("business_id", B).like("name", `%${TAG}%`);
  const { data } = await admin.from("clients").select("family_id").in("id", ids);
  const families = [...new Set((data ?? []).map((c) => c.family_id).filter(Boolean))] as string[];
  if (families.length) await admin.from("families").delete().in("id", families);
  await admin.from("clients").delete().in("id", ids);
  await other.cleanup();
});

describe("families", () => {
  it("links clients, names who usually pays, and changes the members", async () => {
    const [mom, mia, leo] = [await client("Jen"), await client("Mia"), await client("Leo")];
    const { data: id, error } = await save(frontDesk, [mom, mia], mom);
    expect(error).toBeNull();
    const { data: family } = await frontDesk.from("families").select("name, payer_client_id").eq("id", id!).single();
    expect(family).toEqual({ name: "The Parks", payer_client_id: mom });
    expect((await admin.from("clients").select("family_id").in("id", [mom, mia])).data!.map((c) => c.family_id)).toEqual([id, id]);

    // Leo joins, Mia leaves (still her own client), each pays their own now.
    expect((await save(frontDesk, [mom, leo], null, id!)).error).toBeNull();
    const { data: rows } = await admin.from("clients").select("id, family_id").in("id", [mom, mia, leo]);
    expect(Object.fromEntries(rows!.map((r) => [r.id, r.family_id]))).toEqual({ [mom]: id, [mia]: null, [leo]: id });
    expect((await admin.from("families").select("payer_client_id").eq("id", id!).single()).data!.payer_client_id).toBeNull();

    // Removing it unlinks everyone.
    expect((await frontDesk.rpc("delete_family", { p_family_id: id! })).error).toBeNull();
    expect((await admin.from("clients").select("family_id").in("id", [mom, leo])).data!.every((c) => c.family_id === null)).toBe(true);
    expect((await admin.from("families").select("id").eq("id", id!)).data).toEqual([]);
  });

  it("refuses a lone member, a payer outside it, and someone already in another family", async () => {
    const [a, b, c] = [await client("Ann"), await client("Ben"), await client("Cal")];
    expect((await save(frontDesk, [a])).error).toMatchObject({ hint: "members" });
    expect((await save(frontDesk, [a, b], c)).error).toMatchObject({ hint: "payer" });
    expect((await save(frontDesk, [a, b], null, null, "  ")).error).toMatchObject({ hint: "name" });
    expect((await save(frontDesk, [a, b])).error).toBeNull();
    const { error } = await save(frontDesk, [b, c]);
    expect(error).toMatchObject({ hint: "other_family" });
    expect(error!.message).toContain(`${TAG}Ben Park is already in another family`);
  });

  it("can't be changed by writing a client's family directly, or by a stylist", async () => {
    const [a, b] = [await client("Dee"), await client("Eli")];
    const { data: id } = await save(frontDesk, [a, b]);
    const c = await client("Fay");
    const { error } = await frontDesk.from("clients").update({ family_id: id! }).eq("id", c);
    expect(error).toMatchObject({ code: "42501" });
    expect((await save(stylist, [c, a], null, id!)).error).toMatchObject({ code: "42501" });
    expect((await stylist.rpc("delete_family", { p_family_id: id! })).error).toMatchObject({ code: "42501" });
    // A family isn't written directly either.
    await frontDesk.from("families").update({ name: "Hacked" }).eq("id", id!);
    expect((await admin.from("families").select("name").eq("id", id!).single()).data!.name).toBe("The Parks");
  });

  it("stays with its salon", async () => {
    const [a, b] = [await client("Gus"), await client("Hal")];
    const { data: id } = await save(frontDesk, [a, b]);
    expect((await otherOwner.from("families").select("id").eq("id", id!)).data).toEqual([]);
    const { error } = await otherOwner.rpc("save_family", { p_business_id: other.businessId, p_family_id: null as never, p_name: "Ours", p_client_ids: [a, b], p_payer_client_id: null as never });
    expect(error).toMatchObject({ code: "P0002" });
    expect((await otherOwner.rpc("delete_family", { p_family_id: id! })).error).toMatchObject({ code: "42501" });
  });
});
