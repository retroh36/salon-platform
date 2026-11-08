// A consultation form link (form_requests), by its token: the salon, the
// visit, and each form on it with whether it's signed yet, for the
// client's page (/form/<token>). Service role. And the fixed message that
// carries it (never AI-written).

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import type { FormField } from "./forms.ts";
import { toLocal } from "./scheduling/time.ts";

type Admin = SupabaseClient<Database>;

// Up to two weeks, and never past the visit's start.
export const FORM_LINK_HOURS = 14 * 24;

export type LinkForm = { id: string; name: string; intro: string | null; fields: FormField[]; signed: boolean };

export type FormLink = {
  id: string;
  businessId: string;
  status: "open" | "done" | "canceled";
  expired: boolean;
  salon: { name: string; logoPath: string | null; accent: string | null };
  clientFirstName: string;
  visit: { date: string; minute: number; services: string[] };
  forms: LinkForm[];
};

export const isFormToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export async function loadFormLink(admin: Admin, token: string): Promise<FormLink | null> {
  if (!isFormToken(token)) return null;
  const { data: r, error } = await admin
    .from("form_requests")
    .select(
      "id, business_id, client_id, status, expires_at, created_at, template_ids, client:clients(first_name), business:businesses(name, logo_path, online_booking_settings(accent_color)), location:locations(timezone), appointment:appointments(starts_at, appointment_items(starts_at, service:services(name)))",
    )
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  if (error) throw error;
  if (!r) return null;
  const [{ data: templates, error: tError }, { data: signed, error: sError }] = await Promise.all([
    admin.from("form_templates").select("id, name, intro, fields").in("id", r.template_ids),
    // Signed here or at the desk since the link went.
    admin.from("client_forms").select("template_id").eq("client_id", r.client_id).in("template_id", r.template_ids).gte("signed_at", r.created_at),
  ]);
  if (tError) throw tError;
  if (sError) throw sError;
  const done = new Set(signed.map((s) => s.template_id));
  const items = [...r.appointment.appointment_items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const local = toLocal(new Date(r.appointment.starts_at), r.location.timezone);
  return {
    id: r.id,
    businessId: r.business_id,
    status: r.status as FormLink["status"],
    expired: Date.parse(r.expires_at) <= Date.now(),
    salon: { name: r.business.name, logoPath: r.business.logo_path, accent: r.business.online_booking_settings?.accent_color ?? null },
    clientFirstName: r.client.first_name,
    visit: { date: local.date, minute: local.minute, services: items.map((i) => i.service.name) },
    // In the order staff sent them.
    forms: r.template_ids.flatMap((id) => {
      const t = templates.find((x) => x.id === id);
      return t ? [{ id: t.id, name: t.name, intro: t.intro, fields: t.fields as unknown as FormField[], signed: done.has(t.id) }] : [];
    }),
  };
}

// "Maple & Ash: Hi Ava, before your visit on Tue, Nov 10 please fill in
// and sign your Color consent here: …"
export function formLinkMessage(salon: string, firstName: string, day: string, forms: readonly string[], url: string, channel: "sms" | "email"): { subject: string | null; body: string } {
  const names = forms.length === 1 ? `your ${forms[0]}` : `${forms.length} short forms`;
  return {
    subject: channel === "email" ? `Before your visit to ${salon}` : null,
    body: `${salon}: Hi ${firstName}, before your visit on ${day} please fill in and sign ${names} here: ${url}`,
  };
}
