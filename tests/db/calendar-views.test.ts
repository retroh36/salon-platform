// The calendar for big salons: the salon's column order (owners) and saved
// views, shared (owners make them) or personal. Run with `npm run test:db`
// after `npm run seed:demo`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const { bridget: BRIDGET, gil: GIL, sandra: SANDRA, shae: SHAE } = SEED.staff;
const TAG = `V${Date.now().toString(36)}`;

let owner: Client, manager: Client, frontDesk: Client, bridget: Client, otherOwner: Client;

const save = (as: Client, name: string, staff: string[], shared: boolean, id: string | null = null) =>
  as.rpc("save_calendar_view", { p_location_id: L, p_view_id: id!, p_name: name, p_staff_ids: staff, p_shared: shared });

beforeAll(async () => {
  [owner, manager, frontDesk, bridget] = await Promise.all(["owner", "manager", "frontdesk", "bridget"].map((n) => signIn(`${n}@mapleandash.test`)));
  otherOwner = await signIn((await createOtherSalon()).email);
});

afterAll(async () => {
  await admin.from("calendar_views").delete().like("name", `${TAG}%`);
  await admin.from("staff").update({ calendar_position: null }).eq("business_id", B);
});

describe("the salon's column order", () => {
  it("is set by owners: those listed first, in order, and anyone left out after", async () => {
    expect((await owner.rpc("set_calendar_order", { p_business_id: B, p_staff_ids: [SANDRA, BRIDGET, SANDRA] })).error).toBeNull();
    const { data } = await admin.from("staff").select("id, calendar_position").eq("business_id", B).not("calendar_position", "is", null).order("calendar_position");
    expect(data).toEqual([
      { id: SANDRA, calendar_position: 1 },
      { id: BRIDGET, calendar_position: 2 },
    ]);
    expect((await owner.rpc("set_calendar_order", { p_business_id: B, p_staff_ids: [GIL] })).error).toBeNull();
    expect((await admin.from("staff").select("id").eq("business_id", B).not("calendar_position", "is", null)).data).toEqual([{ id: GIL }]);
  });

  it("isn't for anyone but owners and managers, or another salon", async () => {
    for (const as of [frontDesk, bridget, otherOwner]) {
      expect((await as.rpc("set_calendar_order", { p_business_id: B, p_staff_ids: [SHAE] })).error?.code).toBe("42501");
    }
  });
});

describe("saved views", () => {
  it("shared ones are made by owners and managers and seen by everyone at the salon", async () => {
    const { data: id, error } = await save(owner, `${TAG} Color`, [SANDRA, BRIDGET, SANDRA, "00000000-0000-4000-8000-000000000000"], true);
    expect(error).toBeNull();
    // Duplicates and strangers dropped, order kept.
    expect((await admin.from("calendar_views").select("staff_ids, owner_staff_id").eq("id", id!).single()).data).toEqual({ staff_ids: [SANDRA, BRIDGET], owner_staff_id: null });
    for (const as of [manager, frontDesk, bridget]) expect((await as.from("calendar_views").select("id").eq("id", id!)).data).toHaveLength(1);
    expect((await otherOwner.from("calendar_views").select("id").eq("id", id!)).data).toEqual([]);
    // Only owners and managers make, change or delete them.
    expect((await save(frontDesk, `${TAG} Nope`, [SHAE], true)).error?.code).toBe("42501");
    expect((await save(bridget, `${TAG} Color`, [SHAE], true, id!)).error?.code).toBe("42501");
    // Nor can someone take one over as their own.
    expect((await save(bridget, `${TAG} Color`, [SHAE], false, id!)).error?.code).toBe("42501");
    expect((await bridget.rpc("delete_calendar_view", { p_view_id: id! })).error?.code).toBe("42501");
    expect((await save(owner, `${TAG} Color`, [SHAE, SANDRA], true, id!)).error).toBeNull();
    expect((await owner.rpc("delete_calendar_view", { p_view_id: id! })).error).toBeNull();
  });

  it("personal ones are anyone's own: only they see and change them", async () => {
    const { data: id, error } = await save(bridget, `${TAG} My section`, [BRIDGET, SHAE], false);
    expect(error).toBeNull();
    expect((await bridget.from("calendar_views").select("owner_staff_id").eq("id", id!).single()).data).toEqual({ owner_staff_id: BRIDGET });
    expect((await owner.from("calendar_views").select("id").eq("id", id!)).data).toEqual([]);
    expect((await save(owner, `${TAG} Mine now`, [GIL], false, id!)).error?.code).toBe("42501");
    expect((await owner.rpc("delete_calendar_view", { p_view_id: id! })).error?.code).toBe("42501");
    // A name once among your own views; someone else can use it too.
    expect((await save(bridget, `${TAG} my SECTION`, [GIL], false)).error?.code).toBe("23505");
    expect((await save(frontDesk, `${TAG} My section`, [GIL], false)).error).toBeNull();
    expect((await save(bridget, `${TAG} Empty`, ["00000000-0000-4000-8000-000000000000"], false)).error?.code).toBe("22023");
    expect((await bridget.rpc("delete_calendar_view", { p_view_id: id! })).error).toBeNull();
  });

  it("can't be written directly", async () => {
    const { error } = await owner.from("calendar_views").insert({ business_id: B, location_id: L, name: `${TAG} Direct`, staff_ids: [GIL] });
    expect(error?.code).toBe("42501");
  });
});
