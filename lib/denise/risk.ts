// The risk check: visits likely to run over, from how long each stylist
// really takes (lib/insights/), before they happen. Pure. Each becomes a
// "likely_overrun" for the resolver, which finds fixes only where the
// overrun would push into another client.

import type { BookingContext } from "@/lib/scheduling/booking";
import { durationMinutes } from "@/lib/scheduling/booking";
import type { Disruption } from "@/lib/scheduling/resolve";
import type { AppointmentStatus } from "@/lib/appointments";

// Only when the stylist usually takes at least this much longer.
export const LIKELY_OVERRUN_MINUTES = 10;

export type LearnedTime = { medianMinutes: number; trusted: boolean };

export function likelyOverruns(
  ctx: BookingContext,
  statuses: ReadonlyMap<string, AppointmentStatus>,
  learned: ReadonlyMap<string, LearnedTime>,
  now: Date,
  reported: readonly Disruption[] = [],
): Disruption[] {
  const already = new Set(reported.flatMap((d) => (d.kind === "overrun" ? [d.itemId] : [])));
  return ctx.booked.flatMap((item): Disruption[] => {
    if (!item.id || already.has(item.id)) return [];
    const status = statuses.get(item.appointmentId ?? "");
    if (status !== "booked" && status !== "confirmed") return [];
    if (item.start < now) return [];
    const usual = learned.get(`${item.staffId}:${item.serviceId}`);
    if (!usual?.trusted) return [];
    const over = usual.medianMinutes - durationMinutes(item);
    if (over < LIKELY_OVERRUN_MINUTES) return [];
    return [{ id: item.id, kind: "likely_overrun", itemId: item.id, minutes: Math.ceil(over / 5) * 5 }];
  });
}
