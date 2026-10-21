// A dry-run report: record counts and mapping issues only. Built from counts
// and the value-free issue log, so it can't contain client data.

import type { PhorestData } from "./fetch.ts";
import type { RequestStats } from "./http.ts";
import type { Issue, IssueLog } from "./issues.ts";
import type { ImportPlan } from "./model.ts";

export type DryRunReport = {
  fetched: Record<string, number>;
  mapped: Record<string, number>;
  notSavedYet: string[];
  issues: (Issue & { count: number })[];
  requests: RequestStats;
};

export function buildReport(data: PhorestData, plan: ImportPlan, issues: IssueLog, requests: RequestStats): DryRunReport {
  const sum = (f: (b: PhorestData["branches"][number]) => number) => data.branches.reduce((n, b) => n + f(b), 0);
  return {
    fetched: {
      branches: data.branches.length,
      staff: sum((b) => b.staff.length),
      "work timetables": sum((b) => b.timetables.length),
      "rostered dates": sum((b) => b.timetables.reduce((n, t) => n + (t.timeSlots?.length ?? 0), 0)),
      services: sum((b) => b.services.length),
      "service categories": sum((b) => b.serviceCategories.length),
      clients: data.clients.length,
      appointments: sum((b) => b.appointments.length),
      products: sum((b) => b.products.length),
      vouchers: data.vouchers.length,
    },
    mapped: {
      locations: plan.locations.length,
      staff: plan.staff.length,
      "weekly hours (shifts)": plan.weeklyHours.length,
      "one-off changes (shifts)": plan.overrides.length,
      "time off (days)": plan.timeOff.length,
      services: plan.services.length,
      "services offered (staff × service)": plan.staffServices.length,
      clients: plan.clients.length,
      "appointments (bookings)": plan.appointments.length,
      "appointment items": plan.appointments.reduce((n, a) => n + a.items.length, 0),
      products: plan.products.length,
      "gift cards": plan.giftCards.length,
    },
    notSavedYet: ["appointments", "products", "gift cards"],
    issues: issues.list(),
    requests: { ...requests },
  };
}

export function formatReport(r: DryRunReport): string {
  const lines: string[] = [];
  const table = (title: string, rows: Record<string, number>) => {
    lines.push(title);
    const width = Math.max(...Object.keys(rows).map((k) => k.length));
    for (const [k, v] of Object.entries(rows)) lines.push(`  ${k.padEnd(width)}  ${String(v).padStart(7)}`);
    lines.push("");
  };
  table("Fetched from Phorest", r.fetched);
  table("Mapped to our records", r.mapped);
  lines.push(`Not saved yet (tables come in later phases): ${r.notSavedYet.join(", ")}`, "");

  if (r.issues.length === 0) lines.push("Mapping issues: none", "");
  else {
    lines.push("Mapping issues (count · entity · field · what happened)");
    for (const i of r.issues) lines.push(`  ${String(i.count).padStart(6)} · ${i.entity} · ${i.field} · ${i.kind}: ${i.reason}`);
    lines.push("");
  }
  lines.push(`Requests: ${r.requests.requests} (retries ${r.requests.retries}, rate-limited ${r.requests.rateLimited})`);
  return lines.join("\n");
}
