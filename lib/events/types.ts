// Bridal and events: the shapes and labels shared by the builder, the
// event pages and Denise. Pure.

export type PartyRole = "bride" | "bridesmaid" | "maid_of_honor" | "mother" | "flower_girl" | "groom" | "guest";
export const PARTY_ROLES: PartyRole[] = ["bride", "maid_of_honor", "bridesmaid", "mother", "flower_girl", "groom", "guest"];
export const PARTY_ROLE_LABELS: Record<PartyRole, string> = {
  bride: "Bride",
  maid_of_honor: "Maid of honor",
  bridesmaid: "Bridesmaid",
  mother: "Mother of the bride",
  flower_girl: "Flower girl",
  groom: "Groom",
  guest: "Guest",
};

export type EventStatus = "inquiry" | "proposal_sent" | "booked" | "trial_done" | "completed" | "lost";
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  inquiry: "Inquiry",
  proposal_sent: "Proposal sent",
  booked: "Booked",
  trial_done: "Trial done",
  completed: "Completed",
  lost: "Lost",
};

export type EventPackage = {
  id: string;
  name: string;
  partyRole: PartyRole | null;
  hairMinutes: number;
  makeupMinutes: number;
  priceCents: number;
  isTrial: boolean;
  isActive: boolean;
};

// Who can do a package: the work it needs.
export function packageRoles(p: Pick<EventPackage, "hairMinutes" | "makeupMinutes">): string {
  return [p.hairMinutes > 0 && "Hair", p.makeupMinutes > 0 && "Makeup"].filter(Boolean).join(" + ");
}

export function packageMinutes(p: Pick<EventPackage, "hairMinutes" | "makeupMinutes">): number {
  return p.hairMinutes + p.makeupMinutes;
}

export type EventSettings = {
  depositPct: number;
  depositRefundable: boolean;
  serviceChargePct: number;
  serviceChargeTeamPct: number;
  travelFeeCents: number;
  travelFreeMiles: number;
  travelPerMileCents: number;
  travelTeamPct: number;
  travelMinutes: number;
  earlyStartMinute: number;
  earlyStartFeeCents: number;
  headcountCutoffDays: number;
  secondPaymentPct: number;
  secondPaymentDays: number;
  finalPaymentDays: number;
  bufferMinutes: number;
  touchUpMinutes: number;
  trialServiceId: string | null;
  inquiriesEnabled: boolean;
};

// The database's defaults (event_settings), for tests and new salons.
export const DEFAULT_EVENT_SETTINGS: EventSettings = {
  depositPct: 30,
  depositRefundable: false,
  serviceChargePct: 20,
  serviceChargeTeamPct: 100,
  travelFeeCents: 7500,
  travelFreeMiles: 10,
  travelPerMileCents: 150,
  travelTeamPct: 50,
  travelMinutes: 30,
  earlyStartMinute: 420,
  earlyStartFeeCents: 5000,
  headcountCutoffDays: 14,
  secondPaymentPct: 0,
  secondPaymentDays: 30,
  finalPaymentDays: 7,
  bufferMinutes: 10,
  touchUpMinutes: 15,
  trialServiceId: null,
  inquiriesEnabled: true,
};

// A row from event_settings, as the app uses it.
export function settingsFrom(row: {
  deposit_pct: number;
  deposit_refundable: boolean;
  service_charge_pct: number;
  service_charge_team_pct: number;
  travel_fee_cents: number;
  travel_free_miles: number;
  travel_per_mile_cents: number;
  travel_team_pct: number;
  travel_minutes: number;
  early_start_minute: number;
  early_start_fee_cents: number;
  headcount_cutoff_days: number;
  second_payment_pct: number;
  second_payment_days: number;
  final_payment_days: number;
  buffer_minutes: number;
  touch_up_minutes: number;
  trial_service_id: string | null;
  inquiries_enabled: boolean;
}): EventSettings {
  return {
    depositPct: row.deposit_pct,
    depositRefundable: row.deposit_refundable,
    serviceChargePct: row.service_charge_pct,
    serviceChargeTeamPct: row.service_charge_team_pct,
    travelFeeCents: row.travel_fee_cents,
    travelFreeMiles: row.travel_free_miles,
    travelPerMileCents: row.travel_per_mile_cents,
    travelTeamPct: row.travel_team_pct,
    travelMinutes: row.travel_minutes,
    earlyStartMinute: row.early_start_minute,
    earlyStartFeeCents: row.early_start_fee_cents,
    headcountCutoffDays: row.headcount_cutoff_days,
    secondPaymentPct: row.second_payment_pct,
    secondPaymentDays: row.second_payment_days,
    finalPaymentDays: row.final_payment_days,
    bufferMinutes: row.buffer_minutes,
    touchUpMinutes: row.touch_up_minutes,
    trialServiceId: row.trial_service_id,
    inquiriesEnabled: row.inquiries_enabled,
  };
}

// One person in the party, as the builder holds them.
export type PartyMember = {
  name: string;
  partyRole: PartyRole;
  packageId: string;
  paysOwn: boolean;
  email: string;
  phone: string;
};

// The terms with the salon's name filled in.
export function termsText(body: string, salon: string): string {
  return body.replaceAll("{salon}", salon);
}
