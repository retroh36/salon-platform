// Saving a mapped Phorest import (from fixture data) into a fresh business.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapPhorestData } from "@/lib/import/phorest/map/index";
import type { ImportPlan } from "@/lib/import/phorest/model";
import { savePhorestImport } from "@/lib/import/phorest/save";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { BRANCH, makeDataset } from "../unit/phorest/fixtures";
import { admin, SEED, signIn } from "./helpers";

const today = todayIn("America/Chicago");
let businessId: string;
let plan: ImportPlan;

function freshPlan(): ImportPlan {
  const dataset = makeDataset(today);
  return mapPhorestData(
    {
      branches: dataset.branches.map((branch) => ({
        branch,
        staff: dataset.staff[branch.branchId!],
        timetables: dataset.timetables[branch.branchId!],
        services: dataset.services[branch.branchId!],
        serviceCategories: dataset.categories[branch.branchId!],
        appointments: dataset.appointments[branch.branchId!],
        products: dataset.products[branch.branchId!],
      })),
      clients: dataset.clients,
      vouchers: dataset.vouchers,
    },
    { today, timetableFrom: today, timetableTo: addDays(today, 34) },
  ).plan;
}

async function count(table: "locations" | "staff" | "services" | "staff_services" | "clients" | "staff_working_hours" | "staff_schedule_overrides" | "staff_time_off" | "import_external_ids", business = businessId) {
  const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq("business_id", business);
  return count;
}

// The demo salon's counts before any import, to check it's left alone.
let before: { clients: number | null; services: number | null; staff: number | null };

beforeAll(async () => {
  before = { clients: await count("clients", SEED.business), services: await count("services", SEED.business), staff: await count("staff", SEED.business) };
  const { data } = await admin.from("businesses").insert({ name: "Imported Salon" }).select("id").single();
  businessId = data!.id;
  plan = freshPlan();
});

afterAll(async () => {
  if (businessId) await admin.from("businesses").delete().eq("id", businessId);
});

describe("saving an import", () => {
  it("saves every record we have tables for", async () => {
    const { summary } = await savePhorestImport(admin, plan, { businessId });

    expect(await count("locations")).toBe(1);
    expect(await count("staff")).toBe(5);
    expect(await count("services")).toBe(6);
    expect(await count("clients")).toBe(451);
    expect(await count("staff_services")).toBe(plan.staffServices.length);
    expect(await count("staff_working_hours")).toBe(plan.weeklyHours.length);
    expect(await count("staff_schedule_overrides")).toBe(plan.overrides.length);
    expect(await count("staff_time_off")).toBe(plan.timeOff.length);
    expect(summary.client).toEqual({ created: 451, updated: 0 });

    const { data: location } = await admin.from("locations").select("name, timezone").eq("business_id", businessId).single();
    expect(location).toEqual({ name: "Fixture Salon Downtown", timezone: "America/Chicago" });
  });

  it("links records to each other by their new ids", async () => {
    const { data: ana } = await admin.from("staff").select("id, role, level").eq("business_id", businessId).eq("first_name", "Ana").single();
    expect(ana).toMatchObject({ role: "stylist", level: "senior" });

    const { data: preferred } = await admin.from("clients").select("preferred_staff_id").eq("business_id", businessId).eq("first_name", "Avery").eq("last_name", "Fixture0").single();
    expect(preferred!.preferred_staff_id).toBe(ana!.id);

    const { data: cut } = await admin.from("services").select("id, archived_at").eq("business_id", businessId).eq("name", "Women's Cut").single();
    const { data: anaCut } = await admin.from("staff_services").select("price_cents").eq("service_id", cut!.id).eq("staff_id", ana!.id).single();
    expect(anaCut!.price_cents).toBe(8500);

    const { data: perm } = await admin.from("services").select("archived_at").eq("business_id", businessId).eq("name", "Perm").single();
    expect(perm!.archived_at).not.toBeNull();
  });

  it("re-running updates instead of duplicating", async () => {
    const before = await count("import_external_ids");
    const changed = freshPlan();
    changed.clients[0] = { ...changed.clients[0], first_name: "Renamed" };
    const { summary } = await savePhorestImport(admin, changed, { businessId });

    expect(summary.client).toEqual({ created: 0, updated: 451 });
    expect(await count("clients")).toBe(451);
    expect(await count("staff")).toBe(5);
    expect(await count("services")).toBe(6);
    expect(await count("staff_services")).toBe(plan.staffServices.length);
    expect(await count("staff_time_off")).toBe(plan.timeOff.length);
    expect(await count("import_external_ids")).toBe(before);

    const { data } = await admin.from("clients").select("first_name").eq("business_id", businessId).eq("last_name", "Fixture0").single();
    expect(data!.first_name).toBe("Renamed");
  });

  it("keeps services assigned by hand to staff who weren't imported", async () => {
    const { data: location } = await admin.from("locations").select("id").eq("business_id", businessId).single();
    const { data: newHire } = await admin
      .from("staff")
      .insert({ business_id: businessId, location_id: location!.id, first_name: "New", last_name: "Hire", role: "stylist" })
      .select("id")
      .single();
    const { data: cut } = await admin.from("services").select("id").eq("business_id", businessId).eq("name", "Women's Cut").single();
    await admin.from("staff_services").insert({ business_id: businessId, staff_id: newHire!.id, service_id: cut!.id });

    await savePhorestImport(admin, freshPlan(), { businessId });
    const { data } = await admin.from("staff_services").select("staff_id").eq("staff_id", newHire!.id);
    expect(data).toHaveLength(1);
  });

  it("renames an imported service that clashes with an existing one", async () => {
    const { data: other } = await admin.from("businesses").insert({ name: "Clash Salon" }).select("id").single();
    try {
      await admin.from("services").insert({ business_id: other!.id, name: "Women's Cut", category: "Cuts", active_minutes: 30, price_cents: 1000 });
      const { issues } = await savePhorestImport(admin, freshPlan(), { businessId: other!.id });
      const names = (await admin.from("services").select("name").eq("business_id", other!.id)).data!.map((s) => s.name);
      expect(names).toContain("Women's Cut");
      expect(names).toContain("Women's Cut (Phorest)");
      expect(issues.list()).toContainEqual(expect.objectContaining({ entity: "service", field: "name", kind: "adjusted", count: 1 }));
    } finally {
      await admin.from("businesses").delete().eq("id", other!.id);
    }
  });

  it("a run that fails part-way can be re-run without duplicating what it saved", async () => {
    const { data: other } = await admin.from("businesses").insert({ name: "Retry Salon" }).select("id").single();
    try {
      const broken = freshPlan();
      // The database rejects this email, so the run fails at the clients step.
      broken.clients[3] = { ...broken.clients[3], email: "rejected-by-database" };
      await expect(savePhorestImport(admin, broken, { businessId: other!.id })).rejects.toThrow(
        "Import failed saving clients (database error 23514)",
      );
      expect(await count("staff", other!.id)).toBe(5);

      await savePhorestImport(admin, freshPlan(), { businessId: other!.id });
      expect(await count("staff", other!.id)).toBe(5);
      expect(await count("services", other!.id)).toBe(6);
      expect(await count("clients", other!.id)).toBe(451);
    } finally {
      await admin.from("businesses").delete().eq("id", other!.id);
    }
  });

  it("touches nothing outside the target business", async () => {
    expect({ clients: await count("clients", SEED.business), services: await count("services", SEED.business), staff: await count("staff", SEED.business) }).toEqual(before);
  });

  it("keeps the id mapping out of the API", async () => {
    const owner = await signIn("owner@mapleandash.test");
    const { data } = await owner.from("import_external_ids").select("*");
    expect(data).toEqual([]);
  });

  it("only saves the location the import came from", async () => {
    const { data } = await admin.from("import_external_ids").select("external_id").eq("business_id", businessId).eq("entity", "location");
    expect(data!.map((r) => r.external_id)).toEqual([BRANCH]);
  });
});
