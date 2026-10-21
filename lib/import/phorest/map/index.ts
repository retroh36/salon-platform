import type { LocalDate } from "../../../scheduling/time.ts";
import type { PhorestData } from "../fetch.ts";
import { IssueLog } from "../issues.ts";
import type { ImportPlan, StaffRecord } from "../model.ts";
import { mapAppointments } from "./appointments.ts";
import { mapBranch } from "./branches.ts";
import { mapClient } from "./clients.ts";
import { mapProduct, mapVoucher } from "./products.ts";
import { mapServices } from "./services.ts";
import { mapStaff } from "./staff.ts";
import { mapTimetables } from "./timetables.ts";

export type MapOptions = { today: LocalDate; timetableFrom: LocalDate; timetableTo: LocalDate };

// Turns everything fetched from Phorest into records for our tables, plus a
// log of anything that didn't map cleanly. Pure: no I/O.
export function mapPhorestData(data: PhorestData, options: MapOptions): { plan: ImportPlan; issues: IssueLog } {
  const log = new IssueLog();
  const plan: ImportPlan = {
    locations: [],
    staff: [],
    weeklyHours: [],
    overrides: [],
    timeOff: [],
    services: [],
    staffServices: [],
    clients: [],
    appointments: [],
    products: [],
    giftCards: [],
  };

  const staffById = new Map<string, StaffRecord>();
  const serviceIds = new Set<string>();
  const branchContexts: { locationExternalId: string; timeZone: string; data: PhorestData["branches"][number] }[] = [];

  for (const branchData of data.branches) {
    const location = mapBranch(branchData.branch, log);
    if (!location) continue;
    plan.locations.push(location);
    branchContexts.push({ locationExternalId: location.externalId, timeZone: location.timezone, data: branchData });

    const branchStaff: StaffRecord[] = [];
    for (const s of branchData.staff) {
      const record = mapStaff(s, location.externalId, log);
      if (!record) continue;
      // Staff working at several branches appear in each; keep the first.
      if (staffById.has(record.externalId)) {
        log.add("staff", "branchId", "review", "works at several branches; imported at the first");
        continue;
      }
      staffById.set(record.externalId, record);
      branchStaff.push(record);
      plan.staff.push(record);
    }

    const hours = mapTimetables(
      branchData.timetables,
      { staffIds: new Set(branchStaff.map((s) => s.externalId)), from: options.timetableFrom, to: options.timetableTo, today: options.today },
      log,
    );
    plan.weeklyHours.push(...hours.weeklyHours);
    plan.overrides.push(...hours.overrides);
    plan.timeOff.push(...hours.timeOff);

    const branchStaffIds = new Set(branchStaff.map((s) => s.externalId));
    const services = mapServices(
      branchData.services,
      branchData.serviceCategories,
      branchData.staff.filter((s) => s.staffId && branchStaffIds.has(s.staffId)),
      log,
    );
    // Services are per branch in Phorest and per business here; the first
    // branch's version wins.
    for (const s of services.services) {
      if (serviceIds.has(s.externalId)) continue;
      serviceIds.add(s.externalId);
      plan.services.push(s);
    }
    plan.staffServices.push(...services.staffServices);

    for (const p of branchData.products) {
      const record = mapProduct(p, location.externalId, log);
      if (record) plan.products.push(record);
    }
  }

  const staffIds = new Set(staffById.keys());
  for (const c of data.clients) {
    const record = mapClient(c, staffIds, log);
    if (record) plan.clients.push(record);
  }
  const clientIds = new Set(plan.clients.map((c) => c.externalId));

  for (const { locationExternalId, timeZone, data: branchData } of branchContexts) {
    plan.appointments.push(
      ...mapAppointments(branchData.appointments, { locationExternalId, timeZone, staffIds, serviceIds, clientIds }, log),
    );
  }
  for (const v of data.vouchers) {
    const record = mapVoucher(v, clientIds, log);
    if (record) plan.giftCards.push(record);
  }

  return { plan, issues: log };
}
