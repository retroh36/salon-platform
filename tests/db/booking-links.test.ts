import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linkCode } from "@/lib/booking-links";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

// Short booking links: the front of house makes them for their own salon,
// as themselves; stylists and other salons can't make or read them.
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let frontDesk: Client;
let stylist: Client;
const made: string[] = [];

const row = (staffId: string, extra: Partial<{ business_id: string; created_by: string; staff_id: string }> = {}) => {
  const code = linkCode({ businessId: SEED.business, staffId, serviceIds: [], source: `t${Date.now() % 1e6}` });
  made.push(code);
  return { code, business_id: SEED.business, staff_id: staffId, service_ids: [], source: "special", created_by: SEED.staff.frontDesk, ...extra };
};

beforeAll(async () => {
  other = await createOtherSalon();
  frontDesk = await signIn("frontdesk@mapleandash.test");
  stylist = await signIn("bridget@mapleandash.test");
});

afterAll(async () => {
  await admin.from("booking_links").delete().in("code", made);
  await other.cleanup();
});

describe("booking links", () => {
  it("the front desk makes one for their salon and reads it back", async () => {
    const r = row(SEED.staff.bridget);
    expect((await frontDesk.from("booking_links").insert(r)).error).toBeNull();
    const { data } = await frontDesk.from("booking_links").select("code, staff_id").eq("code", r.code);
    expect(data).toEqual([{ code: r.code, staff_id: SEED.staff.bridget }]);
  });

  it("not as someone else, nor for another salon's stylist", async () => {
    expect((await frontDesk.from("booking_links").insert(row(SEED.staff.gil, { created_by: SEED.staff.owner }))).error).not.toBeNull();
    expect((await frontDesk.from("booking_links").insert(row(other.staffId))).error).not.toBeNull();
  });

  it("stylists and other salons can't make or see them", async () => {
    const r = row(SEED.staff.hannah);
    expect((await admin.from("booking_links").insert(r)).error).toBeNull();
    expect((await stylist.from("booking_links").insert(row(SEED.staff.nola, { created_by: SEED.staff.bridget }))).error).not.toBeNull();
    expect((await stylist.from("booking_links").select("code").eq("code", r.code)).data).toEqual([]);
    expect((await (await signIn(other.email)).from("booking_links").select("code").eq("code", r.code)).data).toEqual([]);
  });
});
