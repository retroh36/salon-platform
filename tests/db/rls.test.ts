// Row Level Security checks for businesses, locations and staff.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anon, countFor, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const SEED_BUSINESS = SEED.business;
const SEED_LOCATION = SEED.location;
const SEED_STYLIST = SEED.staff.hannah;


let other: Awaited<ReturnType<typeof createOtherSalon>>;
let owner: Client;
let manager: Client;
let stylist: Client;
let otherOwner: Client;

beforeAll(async () => {
  other = await createOtherSalon();
  [owner, manager, stylist, otherOwner] = await Promise.all([
    signIn("owner@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
    signIn(other.email),
  ]);
});

afterAll(async () => {
  await other?.cleanup();
});

describe("signed-out visitors", () => {
  it("see no businesses, locations or staff", async () => {
    for (const table of ["businesses", "locations", "staff"] as const) {
      const { data, error } = await anon.from(table).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });
});

describe("tenant isolation", () => {
  it("each owner sees only their own business", async () => {
    const mine = await owner.from("businesses").select("id");
    expect(mine.data?.map((b) => b.id)).toEqual([SEED_BUSINESS]);

    const theirs = await otherOwner.from("businesses").select("id");
    expect(theirs.data?.map((b) => b.id)).toEqual([other.businessId]);
  });

  it("each owner sees only their own staff", async () => {
    const mine = await owner.from("staff").select("business_id");
    expect(mine.data).toHaveLength(await countFor("staff"));
    expect(new Set(mine.data?.map((s) => s.business_id))).toEqual(new Set([SEED_BUSINESS]));

    const theirs = await otherOwner.from("staff").select("business_id");
    expect(theirs.data).toHaveLength(1);
  });

  it("an owner can't add staff to another business", async () => {
    const { error } = await otherOwner.from("staff").insert({
      business_id: SEED_BUSINESS,
      location_id: SEED_LOCATION,
      first_name: "Intruder",
    });
    expect(error?.code).toBe("42501"); // RLS violation
  });

  it("an owner can't update or delete another business's staff", async () => {
    const update = await otherOwner.from("staff").update({ first_name: "Hacked" }).eq("id", SEED_STYLIST).select();
    expect(update.data).toEqual([]);

    const remove = await otherOwner.from("staff").delete().eq("id", SEED_STYLIST).select();
    expect(remove.data).toEqual([]);

    const { data } = await admin.from("staff").select("first_name").eq("id", SEED_STYLIST).single();
    expect(data?.first_name).toBe("Hannah");
  });

  it("staff can't be attached to a location in another business", async () => {
    const { error } = await otherOwner.from("staff").insert({
      business_id: other.businessId,
      location_id: SEED_LOCATION,
      first_name: "Wrong location",
    });
    expect(error).not.toBeNull();
  });
});

describe("salon links the database keeps", () => {
  it("a checkout draft can't point at another salon's visit, client or sale, and a team member can't be on another salon's commission plan", async () => {
    const { data: theirClient } = await admin.from("clients").insert({ business_id: other.businessId, first_name: "Elsewhere", last_name: "Client" }).select("id").single();
    const { data: ourVisit } = await admin.from("appointments").select("id").eq("business_id", SEED_BUSINESS).limit(1).single();
    const { data: ourSale } = await admin.from("sales").select("id").eq("business_id", SEED_BUSINESS).limit(1).single();
    const draft = { business_id: other.businessId, location_id: other.locationId, ticket: {} };
    for (const wrong of [{ client_id: theirClient!.id, appointment_id: ourVisit!.id }, { sale_id: ourSale!.id }]) {
      const { error } = await admin.from("sale_drafts").insert({ ...draft, ...wrong });
      expect(error?.code, JSON.stringify(wrong)).toBe("23503");
    }
    // Our client on their draft, too.
    const { data: ourClient } = await admin.from("clients").select("id").eq("business_id", SEED_BUSINESS).limit(1).single();
    expect((await admin.from("sale_drafts").insert({ ...draft, client_id: ourClient!.id })).error?.code).toBe("23503");

    const { data: plan } = await admin.from("commission_plans").select("id").eq("business_id", SEED_BUSINESS).limit(1).single();
    const { error } = await admin.from("staff_compensation").upsert({ business_id: other.businessId, staff_id: other.staffId, plan_id: plan!.id });
    expect(error?.code).toBe("23503");
  });
});

describe("roles", () => {
  it("stylists can view staff but not change them", async () => {
    const { data } = await stylist.from("staff").select("id");
    expect(data).toHaveLength(await countFor("staff"));

    const insert = await stylist.from("staff").insert({
      business_id: SEED_BUSINESS,
      location_id: SEED_LOCATION,
      first_name: "New",
    });
    expect(insert.error?.code).toBe("42501");

    const update = await stylist.from("staff").update({ first_name: "Changed" }).eq("id", SEED_STYLIST).select();
    expect(update.data).toEqual([]);
  });

  it("managers can edit stylists", async () => {
    const { data, error } = await manager
      .from("staff")
      .update({ phone: "(555) 010-0199" })
      .eq("id", SEED_STYLIST)
      .select("phone");
    expect(error).toBeNull();
    expect(data).toEqual([{ phone: "(555) 010-0199" }]);

    await admin.from("staff").update({ phone: "(555) 010-0106" }).eq("id", SEED_STYLIST);
  });

  it("managers can't promote anyone to owner", async () => {
    const { error } = await manager.from("staff").update({ role: "owner" }).eq("id", SEED_STYLIST);
    expect(error?.code).toBe("42501");
  });

  it("owners and managers update the business; only owners its billing", async () => {
    const byManager = await manager.from("businesses").update({ plan: "pro" }).eq("id", SEED_BUSINESS).select();
    expect(byManager.error?.code).toBe("42501");
    expect((await manager.from("businesses").update({ receipt_footer: "Thanks" }).eq("id", SEED_BUSINESS).select("receipt_footer")).data).toEqual([{ receipt_footer: "Thanks" }]);
    await admin.from("businesses").update({ receipt_footer: null }).eq("id", SEED_BUSINESS);

    const byOwner = await owner.from("businesses").update({ plan: "trial" }).eq("id", SEED_BUSINESS).select("plan");
    expect(byOwner.data).toEqual([{ plan: "trial" }]);
  });
});
