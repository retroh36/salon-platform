// Working roles: what someone is doing in a stretch of their day ("Wash
// House" in the morning, "Beauty Bar" in the afternoon), each salon's own
// (migration …_working_roles.sql). A role says which services can be booked
// while someone works it (none listed: all of theirs), whether that time
// shows on the booking site, and how it's paid.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatPrice } from "@/lib/services";

type Supabase = SupabaseClient<Database>;

export type PayMethod = "usual" | "hourly" | "commission";

export type RolePay = { method: PayMethod; hourlyRateCents: number | null; commissionPct: number | null };

export type WorkingRole = {
  id: string;
  name: string;
  online: boolean;
  position: number;
  // None: every service the person does.
  serviceIds: string[];
  // Only for those with the `payroll` permission (RLS), else null.
  pay: RolePay | null;
  // Who works it.
  staffIds: string[];
};

export type RoleDraft = { name: string; online: boolean; serviceIds: string[] };

export const MAX_ROLE_NAME = 40;

export const PAY_METHODS: { value: PayMethod; label: string; hint: string }[] = [
  { value: "usual", label: "Their usual pay", hint: "Paid as they are the rest of the time." },
  { value: "hourly", label: "Hourly", hint: "Each hour in this role at the rate. No commission on its services." },
  { value: "commission", label: "Commission", hint: "Its services at the percent. Its hours aren't paid." },
];

export function roleProblem(draft: RoleDraft, others: readonly { name: string }[]): string | null {
  const name = draft.name.trim();
  if (!name) return "Give the role a name.";
  if (name.length > MAX_ROLE_NAME) return `Keep the name to ${MAX_ROLE_NAME} characters.`;
  if (others.some((o) => o.name.trim().toLowerCase() === name.toLowerCase())) return `There's already a role called ${name}.`;
  return null;
}

export function payProblem(pay: RolePay): string | null {
  if (pay.method === "hourly" && (pay.hourlyRateCents == null || pay.hourlyRateCents < 0 || pay.hourlyRateCents > 100_000)) return "Give an hourly rate up to $1,000.";
  if (pay.method === "commission" && (pay.commissionPct == null || pay.commissionPct < 0 || pay.commissionPct > 100)) return "Give a commission between 0 and 100%.";
  return null;
}

// "Hourly · $18.00", "Commission · 40%", "Their usual pay".
export function payText(pay: RolePay): string {
  if (pay.method === "hourly" && pay.hourlyRateCents != null) return `Hourly · ${formatPrice(pay.hourlyRateCents)}`;
  if (pay.method === "commission" && pay.commissionPct != null) return `Commission · ${pay.commissionPct}%`;
  return "Their usual pay";
}

// "All their services", "Blowout and Deep Conditioning", "5 services".
export function servicesText(serviceIds: readonly string[], names: ReadonlyMap<string, string>): string {
  if (!serviceIds.length) return "All their services";
  const known = serviceIds.map((id) => names.get(id)).filter((n): n is string => !!n);
  if (known.length > 2) return `${known.length} services`;
  return known.join(" and ");
}

// The salon's roles in use (not archived), in order, with their services,
// who works them and, when the person may read it, their pay.
export async function loadWorkingRoles(supabase: Supabase, businessId: string): Promise<WorkingRole[]> {
  const [roles, services, people, pay] = await Promise.all([
    supabase.from("working_roles").select("id, name, online, position").eq("business_id", businessId).is("archived_at", null).order("position").order("name"),
    supabase.from("working_role_services").select("role_id, service_id").eq("business_id", businessId),
    supabase.from("staff_working_roles").select("role_id, staff_id").eq("business_id", businessId),
    supabase.from("working_role_pay").select("role_id, method, hourly_rate_cents, commission_pct").eq("business_id", businessId),
  ]);
  for (const r of [roles, services, people, pay]) if (r.error) throw r.error;
  const payOf = new Map((pay.data ?? []).map((p) => [p.role_id, { method: p.method as PayMethod, hourlyRateCents: p.hourly_rate_cents, commissionPct: p.commission_pct == null ? null : Number(p.commission_pct) }]));
  return (roles.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    online: r.online,
    position: r.position,
    serviceIds: (services.data ?? []).filter((s) => s.role_id === r.id).map((s) => s.service_id),
    pay: payOf.get(r.id) ?? null,
    staffIds: (people.data ?? []).filter((p) => p.role_id === r.id).map((p) => p.staff_id),
  }));
}
