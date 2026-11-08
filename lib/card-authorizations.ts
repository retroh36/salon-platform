// Card authorization (migration …_card_authorizations.sql): a family
// member's visits held by another member's card on file, with the card
// owner's consent given by link. The message and what the payer agrees
// to are fixed wording, filled in by our code.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { policyText, visitTerms, type VisitTerms } from "./policy.ts";
import { loadPolicy } from "./policy-load.ts";

type Admin = SupabaseClient<Database>;

// How long the payer's link works.
export const AUTHORIZATION_HOURS = 72;

export type AuthorizationStatus = "open" | "approved" | "declined" | "canceled" | "ended";

// The message to the card's owner (a fixed template).
export function authorizationMessage(salon: string, payerFirst: string, clientFirst: string, cardLabel: string, url: string, channel: "sms" | "email"): { subject: string | null; body: string } {
  return {
    subject: channel === "email" ? `Use your card for ${clientFirst}'s visits at ${salon}?` : null,
    body: `${salon}: Hi ${payerFirst}, ${clientFirst}'s bookings can be held by your card on file (${cardLabel}). Approve or decline here: ${url} (the link works for ${AUTHORIZATION_HOURS / 24} days).`,
  };
}

// What the payer agrees to: who allows what, then the policy as it applies
// to the client's visits. Kept word for word as the client's consent.
export function authorizationText(salon: string, signedName: string, cardLabel: string, clientFirst: string, policyLines: readonly string[]): string {
  return [
    `I, ${signedName.trim()}, allow ${salon} to use my card on file (${cardLabel}) to hold ${clientFirst}'s bookings and to charge it under the cancellation policy below for ${clientFirst}'s visits, until I ask ${salon} to stop.`,
    `The cancellation policy for ${clientFirst}'s visits:`,
    ...policyLines,
  ].join("\n");
}

export type AuthorizationLink = {
  id: string;
  businessId: string;
  status: AuthorizationStatus;
  expired: boolean;
  // The payer's card was removed or replaced since it was asked.
  cardGone: boolean;
  salon: { name: string; logoPath: string | null; accent: string | null };
  payerFirstName: string;
  clientFirstName: string;
  cardLabel: string;
  policyLines: string[];
  terms: VisitTerms;
};

export const isAuthorizationToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export async function loadAuthorizationLink(admin: Admin, token: string): Promise<AuthorizationLink | null> {
  if (!isAuthorizationToken(token)) return null;
  const { data: a, error } = await admin
    .from("card_authorizations")
    .select(
      "id, business_id, status, expires_at, payer:clients!card_authorizations_payer_client_id_business_id_fkey(first_name), client:clients!card_authorizations_client_id_business_id_fkey(first_name), card:client_cards!card_authorizations_card_id_fkey(label, removed_at), business:businesses(name, logo_path, online_booking_settings(accent_color))",
    )
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  if (error) throw error;
  if (!a) return null;
  const policy = await loadPolicy(admin, a.business_id);
  return {
    id: a.id,
    businessId: a.business_id,
    status: a.status as AuthorizationStatus,
    expired: Date.parse(a.expires_at) <= Date.now(),
    cardGone: a.card.removed_at !== null,
    salon: { name: a.business.name, logoPath: a.business.logo_path, accent: a.business.online_booking_settings?.accent_color ?? null },
    payerFirstName: a.payer.first_name,
    clientFirstName: a.client.first_name,
    cardLabel: a.card.label,
    policyLines: policyText(policy.settings, { extra: policy.extra, salon: a.business.name }),
    terms: visitTerms(policy.settings, [], 0),
  };
}

// Why create_card_authorization or answer_card_authorization refused.
export function authorizationProblem(error: { message: string; hint?: string | null; code?: string }, salon = "the salon"): string {
  if (error.hint === "family") return "They need to be in the same family first.";
  if (error.hint === "has_card" || error.hint === "no_card") return `${error.message}.`;
  if (error.hint === "used") return "This has already been answered. Thank you.";
  if (error.hint === "expired") return `This link has expired. Ask ${salon} for a new one.`;
  if (error.hint === "card_changed") return `The card on file has changed since this was sent. Ask ${salon} for a new link.`;
  if (error.hint === "name") return "Type your full name to approve.";
  if (error.code === "42501") return "Only owners, managers and front desk can ask for a card.";
  if (error.code === "P0002") return "That client no longer exists.";
  return "That didn't go through. Try again.";
}
