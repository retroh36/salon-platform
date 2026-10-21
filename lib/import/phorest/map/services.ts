import type { IssueLog } from "../issues.ts";
import type { ServiceRecord, StaffServiceRecord } from "../model.ts";
import type { PhorestService, PhorestServiceCategory, PhorestStaff } from "../types.ts";
import { cents, text, toFiveMinutes } from "./common.ts";

const MAX_MINUTES = 8 * 60;

// Phorest gives a service's total `duration` and a `gapTime` (when the
// stylist is free) without saying where the gap falls. We treat duration as
// the total time and the gap as processing that ends the service, and flag
// each one for review: for color services the gap is usually mid-service,
// followed by a rinse and finish.
export function mapServiceTimes(duration: number, gap: number, log: IssueLog) {
  let total = toFiveMinutes(duration, "up");
  if (total !== duration) log.add("service", "duration", "adjusted", "rounded up to 5 minutes");
  if (total > MAX_MINUTES) {
    log.add("service", "duration", "adjusted", "capped at 8 hours");
    total = MAX_MINUTES;
  }
  let processing = gap > 0 ? toFiveMinutes(gap, "down") : 0;
  if (processing >= total) {
    log.add("service", "gapTime", "adjusted", "gap as long as the service; ignored");
    processing = 0;
  }
  if (processing > 0) log.add("service", "gapTime", "review", "position of the processing gap unknown; check service, processing and finishing times");
  return { active_minutes: Math.max(5, total - processing), processing_minutes: processing, finishing_minutes: 0 };
}

export function mapServices(
  services: PhorestService[],
  categories: PhorestServiceCategory[],
  staff: PhorestStaff[],
  log: IssueLog,
): { services: ServiceRecord[]; staffServices: StaffServiceRecord[] } {
  const categoryNames = new Map(categories.flatMap((c) => (c.categoryId && text(c.name) ? [[c.categoryId, text(c.name)!]] : [])));
  const activeStaff = staff.filter((s) => s.staffId && s.archived !== true);
  const records: ServiceRecord[] = [];
  const staffServices: StaffServiceRecord[] = [];
  const usedNames = new Set<string>();

  for (const s of services) {
    const externalId = text(s.serviceId);
    if (!externalId) {
      log.add("service", "serviceId", "skipped", "missing");
      continue;
    }
    let name = text(s.name);
    if (!name) {
      log.add("service", "name", "skipped", "missing");
      continue;
    }
    if (typeof s.duration !== "number" || !(s.duration > 0)) {
      log.add("service", "duration", "skipped", "missing or zero");
      continue;
    }

    const archived = s.archived === true;
    // Two active services can't share a name.
    if (!archived) {
      const base = name;
      for (let n = 2; usedNames.has(name.toLowerCase()); n++) name = `${base} (${n})`;
      if (name !== base) log.add("service", "name", "adjusted", "duplicate name; numbered");
      usedNames.add(name.toLowerCase());
    }

    let category = text(s.categoryName) ?? (s.categoryId ? categoryNames.get(s.categoryId) : undefined) ?? null;
    if (!category) {
      log.add("service", "categoryName", "adjusted", "missing; set to Uncategorized");
      category = "Uncategorized";
    }

    let price = cents(s.price);
    if (price === null || price < 0) {
      log.add("service", "price", "adjusted", "missing or negative; set to 0");
      price = 0;
    }

    if (s.isAddonOnly) log.add("service", "isAddonOnly", "review", "add-on-only service imported as a regular service");
    if (s.userDurations?.length) log.add("service", "userDurations", "dropped", "staff-specific durations not supported yet");
    if (s.userGapTimes?.length) log.add("service", "userGapTimes", "dropped", "staff-specific gap times not supported yet");

    records.push({
      externalId,
      name,
      category,
      description: text(s.internetDescription),
      ...mapServiceTimes(s.duration, typeof s.gapTime === "number" ? s.gapTime : 0, log),
      price_cents: price,
      archived,
    });
    if (archived) continue;

    // In Phorest everyone can do a service unless disqualified.
    const disqualified = new Set(s.disqualifiedStaff ?? []);
    const userPrices = new Map((s.userPrices ?? []).flatMap((p) => (p.userRef && cents(p.price) !== null ? [[p.userRef, cents(p.price)!]] : [])));
    const categoryPrices = new Map(
      (s.staffCategories?.prices ?? []).flatMap((p) => (p.id && cents(p.price) !== null ? [[p.id, cents(p.price)!]] : [])),
    );
    for (const member of activeStaff) {
      if (disqualified.has(member.staffId!) || member.disqualifiedServices?.includes(externalId)) continue;
      const custom =
        (member.userId ? userPrices.get(member.userId) : undefined) ??
        (member.staffCategoryId ? categoryPrices.get(member.staffCategoryId) : undefined) ??
        null;
      staffServices.push({ staffExternalId: member.staffId!, serviceExternalId: externalId, price_cents: custom === price ? null : custom });
    }
  }

  return { services: records, staffServices };
}
