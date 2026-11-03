// The booking page's own details (migration …_booking_page.sql): a cover
// photo, stylists' specialty, bio and up to three portfolio photos, and a
// photo per service category, which only those with Settings change and
// only their own salon sees.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSite } from "@/lib/online-booking/site";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const BRIDGET = SEED.staff.bridget;
const CATEGORY = "Treatments";
let owner: Client;
let frontDesk: Client;
let stranger: Client;
let before: { specialty: string | null; bio: string | null; portfolio_paths: string[]; photo_path: string | null };
let coverBefore: string | null;
let photoBefore: Record<string, unknown> | null;

beforeAll(async () => {
  [owner, frontDesk, stranger] = await Promise.all([signIn("owner@mapleandash.test"), signIn("frontdesk@mapleandash.test"), signIn("owner@harborvine.test")]);
  before = (await admin.from("staff").select("specialty, bio, portfolio_paths, photo_path").eq("id", BRIDGET).single()).data!;
  coverBefore = (await admin.from("online_booking_settings").select("cover_path").eq("business_id", B).single()).data!.cover_path;
  photoBefore = (await admin.from("service_category_photos").select("*").eq("business_id", B).eq("category", CATEGORY).maybeSingle()).data;
});

afterAll(async () => {
  await admin.from("staff").update(before).eq("id", BRIDGET);
  await admin.from("online_booking_settings").update({ cover_path: coverBefore }).eq("business_id", B);
  if (photoBefore) await admin.from("service_category_photos").upsert(photoBefore as never);
  else await admin.from("service_category_photos").delete().eq("business_id", B).eq("category", CATEGORY);
});

describe("the booking page", () => {
  it("keeps a stylist to a short specialty and bio and three photos", async () => {
    const work = (n: number) => Array.from({ length: n }, (_, i) => `${B}/work-test-${i}.jpg`);
    expect((await owner.from("staff").update({ specialty: "Soft blondes", bio: "Hello.", portfolio_paths: work(3) }).eq("id", BRIDGET).select("id")).data).toHaveLength(1);
    expect((await owner.from("staff").update({ portfolio_paths: work(4) }).eq("id", BRIDGET)).error?.code).toBe("23514");
    expect((await owner.from("staff").update({ specialty: "x".repeat(61) }).eq("id", BRIDGET)).error?.code).toBe("23514");
    expect((await owner.from("staff").update({ bio: "x".repeat(401) }).eq("id", BRIDGET)).error?.code).toBe("23514");
    // The front desk can't change them.
    expect((await frontDesk.from("staff").update({ specialty: "Changed" }).eq("id", BRIDGET).select("id")).data).toEqual([]);
  });

  it("lets only Settings change category photos, and only the salon's own", async () => {
    const row = { business_id: B, category: CATEGORY, photo_path: `${B}/category-test.jpg` };
    expect((await frontDesk.from("service_category_photos").upsert(row)).error?.code).toBe("42501");
    expect((await stranger.from("service_category_photos").upsert(row)).error?.code).toBe("42501");
    expect((await owner.from("service_category_photos").upsert(row)).error).toBeNull();
    expect((await frontDesk.from("service_category_photos").select("category").eq("category", CATEGORY)).data).toEqual([{ category: CATEGORY }]);
    expect((await stranger.from("service_category_photos").select("category").eq("business_id", B)).data).toEqual([]);
  });

  it("shows the cover, profiles and category photos on the booking site", async () => {
    await admin.from("online_booking_settings").update({ cover_path: `${B}/cover-test.jpg` }).eq("business_id", B);
    const found = await loadSite(admin, "maple-and-ash");
    if (found.status !== "open") throw new Error("The booking site should be open.");
    const { site } = found;
    expect(site.business.coverUrl).toMatch(/\/storage\/v1\/object\/public\/salon-logos\/.+\/cover-test\.jpg$/);
    const bridget = site.stylists.find((s) => s.id === BRIDGET)!;
    expect(bridget).toMatchObject({ displayName: "Bridget Callahan", specialty: "Soft blondes", bio: "Hello." });
    expect(bridget.portfolio).toHaveLength(3);
    expect(site.categoryPhotos[CATEGORY]).toMatch(/\/category-test\.jpg$/);
    expect(site.location.hours.length).toBeGreaterThan(0);
  });

  it("takes a portrait that ships with the app, and nothing else outside the salon's folder", async () => {
    // migration …_demo_photos.sql
    expect((await owner.from("staff").update({ photo_path: "/demo/team/bridget.jpg" }).eq("id", BRIDGET).select("id")).data).toHaveLength(1);
    expect((await owner.from("staff").update({ photo_path: `${B}/staff-test.jpg` }).eq("id", BRIDGET).select("id")).data).toHaveLength(1);
    for (const path of ["/demo/../x.jpg", "/settings", "https://evil.test/a.jpg", "/demo/team/bridget.svg"]) {
      expect((await owner.from("staff").update({ photo_path: path }).eq("id", BRIDGET)).error?.code, path).toBe("23514");
    }
  });

  it("seeds the demo's photos for both salons", async () => {
    const [maple, harbor] = await Promise.all([loadSite(admin, "maple-and-ash"), loadSite(admin, "harbor-and-vine")]);
    if (maple.status !== "open" || harbor.status !== "open") throw new Error("Both booking sites should be open.");
    expect(harbor.site.business.coverUrl).toBe("/demo/covers/harbor-and-vine.jpg");
    expect(harbor.site.categoryPhotos.Nails).toBe("/demo/categories/nails.jpg");
    const { data: team } = await admin.from("staff").select("first_name, photo_path").eq("business_id", B).eq("role", "stylist");
    expect(team!.filter((s) => s.first_name !== "Bridget").every((s) => s.photo_path?.startsWith("/demo/team/"))).toBe(true);
  });
});
