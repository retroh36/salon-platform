// Packages: the ones on offer, and what each client has left. Loading,
// wording and the pro-rated refund (the database works out the same in
// cancel_package).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { StaffLevel } from "@/lib/schedule-forms";

type Supabase = SupabaseClient<Database>;

export type PackageTemplate = {
  id: string;
  name: string;
  priceCents: number;
  expiryMonths: number | null;
  levels: StaffLevel[] | null;
  isActive: boolean;
  items: { serviceId: string; serviceName: string; quantity: number }[];
};

export type ClientPackageItem = { id: string; serviceId: string; serviceName: string; total: number; used: number; useValueCents: number };

export type ClientPackage = {
  id: string;
  name: string;
  priceCents: number;
  levels: StaffLevel[] | null;
  expiresAt: string | null;
  status: "active" | "canceled" | "refunded";
  refundedCents: number;
  createdAt: string;
  items: ClientPackageItem[];
};

export async function loadTemplates(supabase: Supabase, businessId: string, activeOnly = true): Promise<PackageTemplate[]> {
  let q = supabase
    .from("package_templates")
    .select("id, name, price_cents, expiry_months, levels, is_active, package_template_items(service_id, quantity, service:services(name))")
    .eq("business_id", businessId)
    .order("name");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data.map((t) => ({
    id: t.id,
    name: t.name,
    priceCents: t.price_cents,
    expiryMonths: t.expiry_months,
    levels: t.levels,
    isActive: t.is_active,
    items: t.package_template_items.map((i) => ({ serviceId: i.service_id, serviceName: i.service.name, quantity: i.quantity })),
  }));
}

export async function loadClientPackages(supabase: Supabase, clientId: string, activeOnly = false): Promise<ClientPackage[]> {
  let q = supabase
    .from("client_packages")
    .select("id, name, price_cents, levels, expires_at, status, refunded_cents, created_at, client_package_items(id, service_id, total, used, use_value_cents, service:services(name))")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (activeOnly) q = q.eq("status", "active");
  const { data, error } = await q;
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    priceCents: p.price_cents,
    levels: p.levels,
    expiresAt: p.expires_at,
    status: p.status,
    refundedCents: p.refunded_cents,
    createdAt: p.created_at,
    items: p.client_package_items
      .map((i) => ({ id: i.id, serviceId: i.service_id, serviceName: i.service.name, total: i.total, used: i.used, useValueCents: i.use_value_cents }))
      .sort((a, b) => a.serviceName.localeCompare(b.serviceName)),
  }));
}

export function isUsable(p: ClientPackage, now = new Date()): boolean {
  return p.status === "active" && (p.expiresAt === null || new Date(p.expiresAt) > now);
}

// A use of a package for this service with this stylist, if the client has
// one: the soonest-expiring package with a use left.
export function packageFor(packages: readonly ClientPackage[], serviceId: string, level: StaffLevel | null, now = new Date()): { pkg: ClientPackage; item: ClientPackageItem } | null {
  const fits = packages
    .filter((p) => isUsable(p, now) && (p.levels === null || (level !== null && p.levels.includes(level))))
    .flatMap((p) => p.items.filter((i) => i.serviceId === serviceId && i.used < i.total).map((item) => ({ pkg: p, item })))
    .sort((a, b) => (a.pkg.expiresAt ?? "9999").localeCompare(b.pkg.expiresAt ?? "9999"));
  return fits[0] ?? null;
}

// "3 Blowouts left"
export function usesLeft(item: Pick<ClientPackageItem, "total" | "used" | "serviceName">): string {
  const n = item.total - item.used;
  return `${n} ${item.serviceName}${n === 1 ? "" : "s"} left`;
}

// What the uses not yet taken are worth: the most a cancellation refunds.
export function proRatedRefund(p: Pick<ClientPackage, "priceCents" | "refundedCents" | "items">): number {
  const unused = p.items.reduce((n, i) => n + (i.total - i.used) * i.useValueCents, 0);
  return Math.max(0, Math.min(unused, p.priceCents - p.refundedCents));
}

// For Denise's client card: what's left on usable packages.
export function packageTags(packages: readonly ClientPackage[], now = new Date()): { label: string; tone: "good" }[] {
  return packages
    .filter((p) => isUsable(p, now))
    .flatMap((p) => p.items.filter((i) => i.used < i.total))
    .map((i) => ({ label: `Package: ${usesLeft(i)}`, tone: "good" as const }));
}

// Active packages for several clients at once (e.g. a day's visits).
export async function loadPackagesByClient(supabase: Supabase, clientIds: readonly string[]): Promise<Map<string, ClientPackage[]>> {
  const out = new Map<string, ClientPackage[]>();
  if (!clientIds.length) return out;
  const { data, error } = await supabase
    .from("client_packages")
    .select("id, client_id, name, price_cents, levels, expires_at, status, refunded_cents, created_at, client_package_items(id, service_id, total, used, use_value_cents, service:services(name))")
    .in("client_id", [...new Set(clientIds)])
    .eq("status", "active");
  if (error) throw error;
  for (const p of data) {
    const list = out.get(p.client_id) ?? [];
    list.push({
      id: p.id,
      name: p.name,
      priceCents: p.price_cents,
      levels: p.levels,
      expiresAt: p.expires_at,
      status: p.status,
      refundedCents: p.refunded_cents,
      createdAt: p.created_at,
      items: p.client_package_items.map((i) => ({ id: i.id, serviceId: i.service_id, serviceName: i.service.name, total: i.total, used: i.used, useValueCents: i.use_value_cents })),
    });
    out.set(p.client_id, list);
  }
  return out;
}

// Adds what's left on a client's packages to Denise's card about them (or
// makes one, when that's all she has to say).
export function withPackages<T extends { summary: string; tags: { label: string; tone: string }[] }>(insight: T | null, packages: readonly ClientPackage[] | undefined): T | { summary: string; tags: { label: string; tone: "good" }[] } | null {
  const tags = packageTags(packages ?? []);
  if (!tags.length) return insight;
  if (!insight) return { summary: "Has a package with uses left.", tags };
  return { ...insight, tags: [...insight.tags, ...tags] };
}
