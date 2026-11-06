// Safe tasks Denise prepares for someone to confirm ("change Hannah's
// blowout to 30 minutes", "copy Bridget's times to Shae"): our code works
// out exactly what would change, each line before and after; it's recorded
// in the AI action log (feature `task`) and nothing changes until someone
// allowed to make the change taps Confirm (apply_task_action), which checks
// nothing changed since and keeps what it was, so Undo puts it back.
// Pure: no database.

import { formatDuration } from "../duration.ts";
import { copyTimings, ownOrMenu, sameTiming, timingProblem, totalOf, type Timing, type TimingRow } from "../stylist-timings.ts";

export const TASK_FEATURE = "task";

// One service's time for the stylist: their own, or null for the menu's.
export type TaskChange = { serviceId: string; service: string; menu: Timing; before: Timing | null; after: Timing | null };

export type TaskProposal = { kind: "service_times"; staffId: string; staffName: string; changes: TaskChange[] };

// A time made `minutes` long the way the booking rules stretch one: longer
// adds to finishing after processing (else active), shorter takes from
// finishing, then active (never below 5).
export function stretched(t: Timing, minutes: number): Timing {
  const target = Math.max(5, Math.round(minutes / 5) * 5);
  const diff = target - totalOf(t);
  if (diff >= 0) return t.processing > 0 ? { ...t, finishing: t.finishing + diff } : { ...t, active: t.active + diff };
  const fromFinishing = Math.min(t.finishing, -diff);
  return { active: Math.max(5, t.active - (-diff - fromFinishing)), processing: t.processing, finishing: t.finishing - fromFinishing };
}

const timeOf = (row: Pick<TaskChange, "menu">, t: Timing | null) => t ?? row.menu;

// "Change Hannah's blowout to 30 minutes": that service's time, as long as
// asked. A problem in words when it can't be.
export function serviceTimeTask(staff: { id: string; firstName: string }, row: TimingRow, minutes: number): { task: TaskProposal } | { problem: string } {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) return { problem: "Give a length from 5 minutes to 8 hours." };
  if (minutes % 5 !== 0) return { problem: "Lengths go in steps of 5 minutes." };
  const now = timeOf(row, row.own);
  const next = stretched(now, minutes);
  if (totalOf(next) !== minutes) return { problem: `${row.name} has ${formatDuration(now.processing)} of processing, so it can't be shorter than ${formatDuration(totalOf(next))} without changing the menu.` };
  const problem = timingProblem(next);
  if (problem) return { problem };
  const after = ownOrMenu(row, next);
  if (sameTiming(after, row.own)) return { problem: `${staff.firstName}'s ${row.name} is already ${formatDuration(minutes)}.` };
  return { task: { kind: "service_times", staffId: staff.id, staffName: staff.firstName, changes: [{ serviceId: row.serviceId, service: row.name, menu: row.menu, before: row.own, after }] } };
}

// "Copy Bridget's times to Shae": for every service both do, the source's
// time (their own, or the menu's); services only the stylist does stay.
export function copyTimesTask(staff: { id: string; firstName: string }, rows: TimingRow[], source: { firstName: string; times: Record<string, Timing | null> }): { task: TaskProposal } | { problem: string } {
  const { rows: next } = copyTimings(rows, source.times);
  const changes = next.flatMap((r, i) => (sameTiming(rows[i].own, r.own) ? [] : [{ serviceId: r.serviceId, service: r.name, menu: r.menu, before: rows[i].own, after: r.own }]));
  if (!rows.some((r) => r.serviceId in source.times)) return { problem: `${staff.firstName} and ${source.firstName} don't do any of the same services.` };
  if (!changes.length) return { problem: `${staff.firstName}'s times already match ${source.firstName}'s.` };
  return { task: { kind: "service_times", staffId: staff.id, staffName: staff.firstName, changes } };
}

// One line per service: "Blowout: 45 min → 30 min (the menu's)".
export function changeLine(c: TaskChange): string {
  const before = formatDuration(totalOf(timeOf(c, c.before)));
  const after = formatDuration(totalOf(timeOf(c, c.after)));
  const same = before === after ? ` (${partsText(timeOf(c, c.after))})` : "";
  return `${c.service}: ${before} → ${after}${c.after === null ? " (the menu's)" : ""}${same}`;
}

// "20 min, then 30 min processing, then 10 min", when only the parts change.
function partsText(t: Timing): string {
  return [formatDuration(t.active), t.processing ? `${formatDuration(t.processing)} processing` : null, t.finishing ? formatDuration(t.finishing) : null].filter(Boolean).join(", then ");
}

export function taskSummary(t: TaskProposal, from?: string): { summary: string; reason: string } {
  const n = t.changes.length;
  if (from) return { summary: `Copy ${from}'s service times to ${t.staffName}`, reason: `${n} ${n === 1 ? "service changes" : "services change"} for ${t.staffName}. New bookings with them use these; visits already booked keep their own.` };
  const c = t.changes[0];
  return { summary: `${t.staffName}'s ${c.service}: ${formatDuration(totalOf(timeOf(c, c.after)))}`, reason: `New bookings with ${t.staffName} use this; visits already booked keep their own.` };
}

const json = (t: Timing | null) => (t ? { active: t.active, processing: t.processing, finishing: t.finishing } : null);

// As stored in the AI action log: each service's time as it was when it was
// prepared (`from`, checked again on Confirm) and what it becomes (`to`).
export function taskToJson(t: TaskProposal) {
  return { kind: t.kind, staff_id: t.staffId, changes: t.changes.map((c) => ({ service_id: c.serviceId, from: json(c.before), to: json(c.after) })) };
}
