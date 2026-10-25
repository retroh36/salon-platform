"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { parseDollars } from "@/lib/checkout";
import { PARTY_ROLES } from "@/lib/events/types";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { parseTime } from "@/lib/scheduling/time";

export type Result = { ok: true; message: string } | { ok: false; message: string };

const minutes = (v: string) => {
  const n = Number(v || 0);
  return Number.isInteger(n) && n >= 0 && n <= 480 && n % 5 === 0 ? n : null;
};

export type EventPackageInput = { id: string | null; name: string; partyRole: string; hairMinutes: string; makeupMinutes: string; price: string; isTrial: boolean; isActive: boolean };

export async function saveEventPackage(input: EventPackageInput): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers can set up event packages." };
  const name = input.name.trim();
  if (!name || name.length > 120) return { ok: false, message: "Give the package a name." };
  const hair = minutes(input.hairMinutes);
  const makeup = minutes(input.makeupMinutes);
  if (hair === null || makeup === null) return { ok: false, message: "Enter minutes in steps of 5 (up to 8 hours)." };
  if (hair + makeup === 0) return { ok: false, message: "Add how long the hair or the makeup takes." };
  const price = parseDollars(input.price);
  if (price === null || price < 0) return { ok: false, message: "Enter the price." };
  const role = (PARTY_ROLES as readonly string[]).includes(input.partyRole) ? input.partyRole : null;
  const { error } = await supabase.rpc("save_event_package", {
    p_package_id: input.id && isUuid(input.id) ? input.id : null!,
    p_input: { name, party_role: role, hair_minutes: hair, makeup_minutes: makeup, price_cents: price, is_trial: input.isTrial, is_active: input.isActive },
  });
  if (error) return { ok: false, message: ["42501", "P0002"].includes(error.code ?? "") ? `${error.message}.` : "That didn't save. Try again." };
  revalidatePath("/settings/events");
  return { ok: true, message: "Saved." };
}

export type EventSettingsInput = Record<
  | "depositPct"
  | "serviceChargePct"
  | "serviceChargeTeamPct"
  | "travelFee"
  | "travelFreeMiles"
  | "travelPerMile"
  | "travelTeamPct"
  | "travelMinutes"
  | "earlyStart"
  | "earlyStartFee"
  | "headcountCutoffDays"
  | "secondPaymentPct"
  | "secondPaymentDays"
  | "finalPaymentDays"
  | "bufferMinutes"
  | "touchUpMinutes"
  | "trialServiceId"
  | "terms",
  string
> & { depositRefundable: boolean; inquiriesEnabled: boolean };

const whole = (v: string, min: number, max: number, step = 1) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= min && n <= max && n % step === 0 ? n : null;
};

export async function saveEventSettings(input: EventSettingsInput): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers can change bridal settings." };
  const fields = {
    deposit_pct: whole(input.depositPct, 0, 100),
    service_charge_pct: whole(input.serviceChargePct, 0, 50),
    service_charge_team_pct: whole(input.serviceChargeTeamPct, 0, 100),
    travel_fee_cents: parseDollars(input.travelFee),
    travel_free_miles: whole(input.travelFreeMiles, 0, 500),
    travel_per_mile_cents: parseDollars(input.travelPerMile),
    travel_team_pct: whole(input.travelTeamPct, 0, 100),
    travel_minutes: whole(input.travelMinutes, 0, 240, 5),
    early_start_minute: parseTime(input.earlyStart),
    early_start_fee_cents: parseDollars(input.earlyStartFee),
    headcount_cutoff_days: whole(input.headcountCutoffDays, 0, 365),
    second_payment_pct: whole(input.secondPaymentPct, 0, 100),
    second_payment_days: whole(input.secondPaymentDays, 1, 365),
    final_payment_days: whole(input.finalPaymentDays, 0, 365),
    buffer_minutes: whole(input.bufferMinutes, 0, 60, 5),
    touch_up_minutes: whole(input.touchUpMinutes, 0, 60, 5),
  };
  const bad = Object.entries(fields).find(([, v]) => v === null || v === undefined);
  if (bad) return { ok: false, message: `Check ${LABELS[bad[0]] ?? "the numbers"}.` };
  if (fields.early_start_minute! % 5 !== 0) return { ok: false, message: "Choose the early-start time in steps of 5 minutes." };
  if (fields.deposit_pct! + fields.second_payment_pct! > 100) return { ok: false, message: "The deposit and second payment can't add up to more than 100%." };
  if (fields.second_payment_pct! > 0 && fields.second_payment_days! <= fields.final_payment_days!) return { ok: false, message: "The second payment comes before the balance: give it more days before the event." };
  const terms = input.terms.trim();
  if (terms.length < 20) return { ok: false, message: "Add your contract terms." };
  const { error } = await supabase.rpc("save_event_settings", {
    p_input: { ...fields, deposit_refundable: input.depositRefundable, inquiries_enabled: input.inquiriesEnabled, trial_service_id: input.trialServiceId && isUuid(input.trialServiceId) ? input.trialServiceId : null, terms },
  });
  if (error) return { ok: false, message: ["42501", "P0002", "23514"].includes(error.code ?? "") ? "Those settings don't add up. Check the numbers." : "That didn't save. Try again." };
  revalidatePath("/settings/events");
  return { ok: true, message: "Saved." };
}

const LABELS: Record<string, string> = {
  deposit_pct: "the deposit",
  service_charge_pct: "the service charge",
  service_charge_team_pct: "the team's share of the service charge",
  travel_fee_cents: "the travel fee",
  travel_free_miles: "the free miles",
  travel_per_mile_cents: "the fee per mile",
  travel_team_pct: "the team's share of travel",
  travel_minutes: "the travel time",
  early_start_minute: "the early-start time",
  early_start_fee_cents: "the early-start fee",
  headcount_cutoff_days: "the headcount cutoff",
  second_payment_pct: "the second payment",
  second_payment_days: "when the second payment is due",
  final_payment_days: "when the balance is due",
  buffer_minutes: "the buffer",
  touch_up_minutes: "the touch-up time",
};
