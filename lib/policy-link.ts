// A secure card link (card_requests), by its token: what the page shows
// (the salon, the visit, the policy in plain language with this visit's
// amounts, the deposit) and so what the client agrees to. Service role.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { policyText, visitTerms, type VisitTerms } from "./policy.ts";
import { loadPolicy } from "./policy-load.ts";
import { toLocal } from "./scheduling/time.ts";

type Admin = SupabaseClient<Database>;

export type CardLink = {
  id: string;
  status: "open" | "done" | "canceled";
  expired: boolean;
  salon: { name: string; logoPath: string | null; accent: string | null };
  clientFirstName: string;
  visit: { date: string; minute: number; services: string[] } | null;
  depositCents: number;
  lines: string[];
  terms: VisitTerms;
};

export const isCardToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export async function loadCardLink(admin: Admin, token: string): Promise<CardLink | null> {
  if (!isCardToken(token)) return null;
  const { data: r, error } = await admin
    .from("card_requests")
    .select(
      "id, business_id, status, expires_at, deposit_cents, client:clients(first_name), business:businesses(name, logo_path, online_booking_settings(accent_color)), location:locations(timezone), appointment:appointments(starts_at, deposit_paid_cents, appointment_items(staff_id, price_cents, starts_at, service:services(name)))",
    )
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  if (error) throw error;
  if (!r) return null;
  const policy = await loadPolicy(admin, r.business_id);
  const items = [...(r.appointment?.appointment_items ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const staffIds = new Set(items.map((i) => i.staff_id));
  const stylists = policy.stylists.filter((p) => staffIds.has(p.staffId));
  const visitCents = r.appointment ? items.reduce((sum, i) => sum + i.price_cents, 0) : null;
  const local = r.appointment ? toLocal(new Date(r.appointment.starts_at), r.location.timezone) : null;
  return {
    id: r.id,
    status: r.status as CardLink["status"],
    expired: Date.parse(r.expires_at) <= Date.now(),
    salon: { name: r.business.name, logoPath: r.business.logo_path, accent: r.business.online_booking_settings?.accent_color ?? null },
    clientFirstName: r.client.first_name,
    visit: local ? { date: local.date, minute: local.minute, services: items.map((i) => i.service.name) } : null,
    depositCents: r.deposit_cents,
    lines: policyText(policy.settings, { stylists, visitCents, depositCents: r.deposit_cents, extra: policy.extra, salon: r.business.name }),
    terms: visitTerms(policy.settings, stylists, visitCents ?? 0, r.deposit_cents),
  };
}
