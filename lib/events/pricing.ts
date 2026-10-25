// What an event costs and when it's paid (pure). The database works the
// price out the same way (private.price_event; tests check they agree):
// integer cents, rounding half up.

import { addDays, daysBetween, type LocalDate } from "../scheduling/time.ts";
import type { EventSettings } from "./types.ts";

const pct = (cents: number, percent: number) => Math.floor((cents * percent + 50) / 100);
const bp = (cents: number, basisPoints: number) => Math.floor((cents * basisPoints + 5000) / 10000);

export type PriceInput = {
  members: readonly { priceCents: number; paysOwn: boolean }[];
  billing: "main" | "split";
  onLocation: boolean;
  travelMiles: number;
  // Artist lanes starting before the salon's early-start time.
  earlyLanes: number;
};

export type EventPrice = {
  subtotalCents: number;
  travelFeeCents: number;
  earlyFeeCents: number;
  serviceChargeCents: number;
  taxCents: number;
  totalCents: number;
  // What members paying their own pay, and the rest (the main client's).
  ownCents: number;
  mainCents: number;
  depositCents: number;
};

export function travelFee(miles: number, s: Pick<EventSettings, "travelFeeCents" | "travelPerMileCents" | "travelFreeMiles">): number {
  return s.travelFeeCents + s.travelPerMileCents * Math.max(0, Math.ceil(miles) - s.travelFreeMiles);
}

// A member paying their own: their package, its service charge and tax.
export function memberShare(priceCents: number, s: Pick<EventSettings, "serviceChargePct">, taxBp: number): number {
  return priceCents + pct(priceCents, s.serviceChargePct) + bp(priceCents, taxBp);
}

export function priceEvent(input: PriceInput, s: EventSettings, taxBp: number): EventPrice {
  const subtotalCents = input.members.reduce((a, m) => a + m.priceCents, 0);
  const travelFeeCents = input.onLocation ? travelFee(input.travelMiles, s) : 0;
  const earlyFeeCents = s.earlyStartFeeCents * input.earlyLanes;
  const serviceChargeCents = pct(subtotalCents, s.serviceChargePct);
  const taxCents = bp(subtotalCents + travelFeeCents + earlyFeeCents, taxBp);
  const totalCents = subtotalCents + travelFeeCents + earlyFeeCents + serviceChargeCents + taxCents;
  const ownCents = input.billing === "split" ? input.members.filter((m) => m.paysOwn).reduce((a, m) => a + memberShare(m.priceCents, s, taxBp), 0) : 0;
  const mainCents = totalCents - ownCents;
  return { subtotalCents, travelFeeCents, earlyFeeCents, serviceChargeCents, taxCents, totalCents, ownCents, mainCents, depositCents: pct(mainCents, s.depositPct) };
}

export type ScheduledKind = "deposit" | "second" | "final";
export type ScheduledPayment = { kind: ScheduledKind; amountCents: number; dueOn: LocalDate };
export const SCHEDULED_LABELS: Record<ScheduledKind, string> = { deposit: "Deposit", second: "Second payment", final: "Balance" };

// When the main client pays: the deposit to book, then (if the salon uses
// one) a second payment, then the balance, a set number of days before the
// event. A payment that would fall on or before the booking day is folded
// into the next one (the balance is due at booking when the event is that
// close). The proposal shows this; once booked, remainingSchedule.
export function paymentSchedule(
  input: { mainCents: number; depositCents: number; eventDate: LocalDate; bookedOn: LocalDate },
  s: Pick<EventSettings, "secondPaymentPct" | "secondPaymentDays" | "finalPaymentDays">,
): ScheduledPayment[] {
  const out: ScheduledPayment[] = [{ kind: "deposit", amountCents: input.depositCents, dueOn: input.bookedOn }];
  const secondDue = addDays(input.eventDate, -s.secondPaymentDays);
  const second = s.secondPaymentPct > 0 && daysBetween(input.bookedOn, secondDue) > 0 ? pct(input.mainCents, s.secondPaymentPct) : 0;
  if (second > 0) out.push({ kind: "second", amountCents: second, dueOn: secondDue });
  const finalDue = addDays(input.eventDate, -s.finalPaymentDays);
  const balance = input.mainCents - input.depositCents - second;
  if (balance > 0) out.push({ kind: "final", amountCents: balance, dueOn: daysBetween(input.bookedOn, finalDue) > 0 ? finalDue : input.bookedOn });
  return out.filter((p) => p.amountCents > 0);
}

// What's left to schedule once booked (at booking, and whenever the total
// changes): the second payment if the salon uses one, it was due after
// booking and isn't paid, and the balance; each due on its day, or today
// if that's passed. Overpaid leaves nothing. The database does the same
// (private.schedule_event_payments).
export function remainingSchedule(
  input: { mainCents: number; eventDate: LocalDate; bookedOn: LocalDate; today: LocalDate; paid: readonly { kind: ScheduledKind; amountCents: number }[] },
  s: Pick<EventSettings, "secondPaymentPct" | "secondPaymentDays" | "finalPaymentDays">,
): ScheduledPayment[] {
  const paid = input.paid.reduce((a, p) => a + p.amountCents, 0);
  const later = (d: LocalDate) => (d > input.today ? d : input.today);
  const secondDue = addDays(input.eventDate, -s.secondPaymentDays);
  const second =
    s.secondPaymentPct > 0 && secondDue > input.bookedOn && !input.paid.some((p) => p.kind === "second") ? Math.min(pct(input.mainCents, s.secondPaymentPct), Math.max(0, input.mainCents - paid)) : 0;
  const balance = Math.max(0, input.mainCents - paid - second);
  const out: ScheduledPayment[] = [];
  if (second > 0) out.push({ kind: "second", amountCents: second, dueOn: later(secondDue) });
  if (balance > 0) out.push({ kind: "final", amountCents: balance, dueOn: later(addDays(input.eventDate, -s.finalPaymentDays)) });
  return out;
}

// The last day the party can change without a manager.
export function headcountCutoff(eventDate: LocalDate, s: Pick<EventSettings, "headcountCutoffDays">): LocalDate {
  return addDays(eventDate, -s.headcountCutoffDays);
}

export function pastCutoff(eventDate: LocalDate, today: LocalDate, s: Pick<EventSettings, "headcountCutoffDays">): boolean {
  return today > headcountCutoff(eventDate, s);
}
