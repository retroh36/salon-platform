// Saves a mapped import into our database, for one business.
//
// Runs as a trusted server-side job with the service role key, which
// bypasses RLS, so every write here is scoped to `businessId` explicitly.
// Idempotent: import_external_ids remembers which of our rows each Phorest
// record became, so running it again (e.g. during the switch-over week)
// updates those rows instead of adding new ones. Mappings are saved after
// each step, so if a run fails part-way, the next run picks up the rows it
// already wrote rather than duplicating them.
//
// Saves what we have tables for: locations, staff, working hours, one-off
// changes, time off, services, who offers them, and clients. Appointments,
// products and gift cards wait for their tables (see model.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types.ts";
import { IssueLog } from "./issues.ts";
import type { ImportPlan } from "./model.ts";

type Db = SupabaseClient<Database>;
type Entity = "location" | "staff" | "service" | "client" | "time_off";

export type SaveSummary = Record<string, { created: number; updated: number }>;

const BATCH = 500;
const SOURCE = "phorest";

function chunks<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function check<T extends { error: { message: string; code?: string } | null }>(result: T, what: string): T {
  // Database errors can quote row values, so name the step and code only.
  if (result.error) throw new Error(`Import failed saving ${what} (database error ${result.error.code ?? "unknown"})`);
  return result;
}

export async function savePhorestImport(
  db: Db,
  plan: ImportPlan,
  { businessId }: { businessId: string },
): Promise<{ summary: SaveSummary; issues: IssueLog }> {
  const issues = new IssueLog();
  const summary: SaveSummary = {};
  const count = (entity: string, created: boolean) => {
    summary[entity] ??= { created: 0, updated: 0 };
    summary[entity][created ? "created" : "updated"]++;
  };

  // Phorest id -> our id, per entity, from earlier runs.
  const ids = new Map<Entity, Map<string, string>>();
  for (const entity of ["location", "staff", "service", "client", "time_off"] as Entity[]) ids.set(entity, new Map());
  for (let from = 0; ; from += 1000) {
    const { data } = check(
      await db
        .from("import_external_ids")
        .select("entity, external_id, internal_id")
        .eq("business_id", businessId)
        .eq("source", SOURCE)
        .range(from, from + 999),
      "import ids",
    );
    for (const r of data!) ids.get(r.entity as Entity)?.set(r.external_id, r.internal_id);
    if (data!.length < 1000) break;
  }

  // Our id for a record: the one from a previous run, or a new one.
  const idFor = (entity: Entity, externalId: string) => {
    const existing = ids.get(entity)!.get(externalId);
    count(entity, !existing);
    return existing ?? crypto.randomUUID();
  };
  // Mappings for rows created in the current step, saved once its writes succeed.
  let pending: Database["public"]["Tables"]["import_external_ids"]["Insert"][] = [];
  const remember = (entity: Entity, externalId: string, internalId: string) => {
    if (!ids.get(entity)!.has(externalId)) pending.push({ business_id: businessId, source: SOURCE, entity, external_id: externalId, internal_id: internalId });
    ids.get(entity)!.set(externalId, internalId);
  };
  const saveMappings = async () => {
    for (const batch of chunks(pending)) check(await db.from("import_external_ids").insert(batch), "import ids");
    pending = [];
  };

  // Locations
  for (const l of plan.locations) {
    const id = idFor("location", l.externalId);
    const { externalId, ...row } = l;
    check(await db.from("locations").upsert({ id, business_id: businessId, ...row }), "locations");
    remember("location", externalId, id);
  }
  await saveMappings();

  // Staff
  const staffRows = plan.staff.flatMap((s) => {
    const locationId = ids.get("location")!.get(s.locationExternalId);
    if (!locationId) return [];
    const id = idFor("staff", s.externalId);
    remember("staff", s.externalId, id);
    return [
      {
        id,
        business_id: businessId,
        location_id: locationId,
        first_name: s.first_name,
        last_name: s.last_name,
        email: s.email,
        phone: s.phone,
        role: s.role,
        level: s.level,
        is_active: s.is_active,
      },
    ];
  });
  for (const batch of chunks(staffRows)) check(await db.from("staff").upsert(batch), "staff");
  await saveMappings();
  const staffId = (externalId: string) => ids.get("staff")!.get(externalId);

  // Weekly hours: replace each imported staff member's week.
  const hoursByStaff = new Map<string, { weekday: number; start_minute: number; end_minute: number }[]>();
  for (const s of plan.staff) if (staffId(s.externalId)) hoursByStaff.set(s.externalId, []);
  for (const h of plan.weeklyHours) hoursByStaff.get(h.staffExternalId)?.push({ weekday: h.weekday, start_minute: h.start_minute, end_minute: h.end_minute });
  for (const [externalId, hours] of hoursByStaff) {
    check(await db.rpc("set_staff_weekly_hours", { p_business_id: businessId, p_staff_id: staffId(externalId)!, p_hours: hours }), "working hours");
  }

  // One-off changes, per staff member and date.
  const overrides = new Map<string, { staff: string; date: string; hours: { start_minute: number; end_minute: number }[] }>();
  for (const o of plan.overrides) {
    const sid = staffId(o.staffExternalId);
    if (!sid) continue;
    const key = `${sid}:${o.on_date}`;
    const entry = overrides.get(key) ?? { staff: sid, date: o.on_date, hours: [] };
    entry.hours.push({ start_minute: o.start_minute, end_minute: o.end_minute });
    overrides.set(key, entry);
  }
  for (const o of overrides.values()) {
    check(await db.rpc("set_staff_day_override", { p_business_id: businessId, p_staff_id: o.staff, p_on_date: o.date, p_hours: o.hours }), "schedule changes");
    count("schedule_change", true);
  }

  // Time off from the roster: added once, then left alone (managers may
  // have edited it since).
  const now = new Date().toISOString();
  const timeOffRows = plan.timeOff.flatMap((t) => {
    const sid = staffId(t.staffExternalId);
    const externalId = `${t.staffExternalId}:${t.starts_on}`;
    if (!sid || ids.get("time_off")!.has(externalId)) return [];
    const id = idFor("time_off", externalId);
    remember("time_off", externalId, id);
    return [
      {
        id,
        business_id: businessId,
        staff_id: sid,
        starts_on: t.starts_on,
        ends_on: t.ends_on,
        reason: "other" as const,
        note: t.note,
        status: "approved" as const,
        requested_by: sid,
        decided_by: sid,
        decided_at: now,
      },
    ];
  });
  for (const batch of chunks(timeOffRows)) check(await db.from("staff_time_off").insert(batch), "time off");
  await saveMappings();

  // Services. An existing service (not from Phorest) with the same name
  // would clash, so the imported one is renamed.
  for (const s of plan.services) {
    const id = idFor("service", s.externalId);
    const { externalId, archived, ...rest } = s;
    const row = { id, business_id: businessId, ...rest, archived_at: archived ? now : null };
    let result = await db.from("services").upsert(row);
    if (result.error?.code === "23505") {
      issues.add("service", "name", "adjusted", "an existing service has the same name; imported with (Phorest) added");
      result = await db.from("services").upsert({ ...row, name: `${row.name} (Phorest)` });
    }
    check(result, "services");
    remember("service", externalId, id);
  }
  await saveMappings();

  // Who offers what: replaced for imported services and imported staff, so
  // assignments made by hand for other staff are kept.
  const importedStaffIds = plan.staff.map((s) => staffId(s.externalId)).filter((id): id is string => !!id);
  const importedServiceIds = plan.services.map((s) => ids.get("service")!.get(s.externalId)!);
  for (const batch of chunks(importedServiceIds, 100)) {
    if (importedStaffIds.length === 0) break;
    check(await db.from("staff_services").delete().eq("business_id", businessId).in("service_id", batch).in("staff_id", importedStaffIds), "services offered");
  }
  const offered = plan.staffServices.flatMap((ss) => {
    const sid = staffId(ss.staffExternalId);
    const svc = ids.get("service")!.get(ss.serviceExternalId);
    return sid && svc ? [{ business_id: businessId, staff_id: sid, service_id: svc, price_cents: ss.price_cents }] : [];
  });
  for (const batch of chunks(offered)) check(await db.from("staff_services").insert(batch), "services offered");
  summary.staff_service = { created: offered.length, updated: 0 };

  // Clients
  const clientRows = plan.clients.map((c) => {
    const id = idFor("client", c.externalId);
    remember("client", c.externalId, id);
    return {
      id,
      business_id: businessId,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone,
      notes: c.notes,
      sms_opt_in: c.sms_opt_in,
      email_opt_in: c.email_opt_in,
      preferred_staff_id: c.preferredStaffExternalId ? (staffId(c.preferredStaffExternalId) ?? null) : null,
      ...(c.created_at ? { created_at: c.created_at } : {}),
    };
  });
  // In a batch, columns some rows leave out would otherwise be sent as null;
  // defaultToNull: false gives them the column default (e.g. created_at).
  for (const batch of chunks(clientRows)) check(await db.from("clients").upsert(batch, { defaultToNull: false }), "clients");
  await saveMappings();

  return { summary, issues };
}
