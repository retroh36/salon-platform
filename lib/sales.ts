// Loading checkouts and sales, and the receipt. Server side; the
// arithmetic is in ./checkout.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { productName } from "@/lib/inventory";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPrice } from "@/lib/services";
import { fullName, type StaffRole } from "@/lib/staff";
import { METHOD_LABELS, type PaymentMethod } from "./checkout";

type Supabase = SupabaseClient<Database>;

export type CheckoutSettings = {
  taxServicesBp: number;
  taxRetailBp: number;
  discountRoles: StaffRole[];
  discountMaxPercent: number;
};

export type CheckoutProduct = { id: string; name: string; priceCents: number; onHand: number; sku: string | null; barcode: string | null };

export type CheckoutData = {
  appointmentId: string | null;
  client: { id: string; name: string; email: string | null } | null;
  services: { itemId: string; name: string; staffId: string; staffName: string; priceCents: number }[];
  // Who can be tipped: the stylists on the visit.
  stylists: { id: string; firstName: string }[];
  products: CheckoutProduct[];
  settings: CheckoutSettings;
  role: StaffRole;
};

export function canTakePayments(role: StaffRole): boolean {
  return role === "owner" || role === "manager" || role === "front_desk";
}

export function canRefund(role: StaffRole): boolean {
  return role === "owner" || role === "manager";
}

export async function loadCheckoutSettings(supabase: Supabase, businessId: string): Promise<CheckoutSettings> {
  const { data, error } = await supabase
    .from("businesses")
    .select("tax_rate_services_bp, tax_rate_retail_bp, discount_roles, discount_max_percent")
    .eq("id", businessId)
    .single();
  if (error) throw error;
  return { taxServicesBp: data.tax_rate_services_bp, taxRetailBp: data.tax_rate_retail_bp, discountRoles: data.discount_roles, discountMaxPercent: data.discount_max_percent };
}

export async function loadRetailProducts(supabase: Supabase, businessId: string, locationId: string): Promise<CheckoutProduct[]> {
  const [{ data, error }, { data: levels, error: levelError }] = await Promise.all([
    supabase.from("products").select("id, brand, line, name, sku, barcode, price_cents").eq("business_id", businessId).eq("type", "retail").eq("is_active", true).order("brand").order("name"),
    supabase.from("stock_levels").select("product_id, on_hand").eq("location_id", locationId),
  ]);
  if (error) throw error;
  if (levelError) throw levelError;
  const onHand = new Map(levels.map((l) => [l.product_id, Number(l.on_hand)]));
  return data.map((p) => ({ id: p.id, name: productName(p), priceCents: p.price_cents ?? 0, onHand: onHand.get(p.id) ?? 0, sku: p.sku, barcode: p.barcode }));
}

// Everything the checkout panel needs for a visit (or for a retail sale
// without one, when appointmentId is null).
export async function loadCheckout(
  supabase: Supabase,
  me: { business_id: string; role: StaffRole; location: { id: string } },
  appointmentId: string | null,
): Promise<CheckoutData | null> {
  const [settings, products] = await Promise.all([loadCheckoutSettings(supabase, me.business_id), loadRetailProducts(supabase, me.business_id, me.location.id)]);
  if (!appointmentId) return { appointmentId: null, client: null, services: [], stylists: [], products, settings, role: me.role };

  const { data: a, error } = await supabase
    .from("appointments")
    .select("id, status, client:clients(id, first_name, last_name, email), appointment_items(id, starts_at, price_cents, staff_id, service:services(name), staff:staff(first_name, last_name))")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw error;
  if (!a) return null;
  const items = [...a.appointment_items].sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  const stylists = [...new Map(items.map((i) => [i.staff_id, { id: i.staff_id, firstName: i.staff?.first_name ?? "Stylist" }])).values()];
  return {
    appointmentId: a.id,
    client: a.client ? { id: a.client.id, name: fullName(a.client), email: a.client.email } : null,
    services: items.map((i) => ({ itemId: i.id, name: i.service.name, staffId: i.staff_id, staffName: i.staff ? fullName(i.staff) : "Former staff", priceCents: i.price_cents })),
    stylists,
    products,
    settings,
    role: me.role,
  };
}

export type SaleView = {
  id: string;
  number: number;
  status: Database["public"]["Enums"]["sale_status"];
  createdAt: string;
  client: { id: string; name: string; email: string | null } | null;
  appointmentId: string | null;
  items: { id: string; kind: string; description: string; staffName: string | null; quantity: number; unitPriceCents: number; bookedPriceCents: number | null; priceReason: string | null; discountCents: number; taxCents: number; totalCents: number; returnedQuantity: number }[];
  tips: { staffName: string; amountCents: number }[];
  payments: { id: string; method: PaymentMethod; amountCents: number; tenderedCents: number | null; changeCents: number | null; reference: string | null; reason: string | null; createdAt: string }[];
  events: { kind: string; amountCents: number | null; detail: string | null; staffName: string | null; createdAt: string }[];
  subtotalCents: number;
  discountCents: number;
  discountReason: string | null;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  refundedCents: number;
  voidReason: string | null;
  receiptEmail: string | null;
  soldBy: string | null;
};

export async function loadSale(supabase: Supabase, saleId: string): Promise<SaleView | null> {
  const { data: s, error } = await supabase
    .from("sales")
    .select(
      "id, number, status, created_at, appointment_id, subtotal_cents, discount_cents, discount_reason, tax_cents, tip_cents, total_cents, refunded_cents, void_reason, receipt_email, client:clients(id, first_name, last_name, email), seller:staff!sales_created_by_business_id_fkey(first_name), sale_items(id, position, kind, description, quantity, unit_price_cents, booked_price_cents, price_reason, discount_cents, tax_cents, total_cents, returned_quantity, staff:staff(first_name)), sale_tips(amount_cents, staff:staff(first_name)), payments(id, method, amount_cents, tendered_cents, change_cents, reference, reason, created_at), sale_events(kind, amount_cents, detail, created_at, staff:staff(first_name))",
    )
    .eq("id", saleId)
    .maybeSingle();
  if (error) throw error;
  if (!s) return null;
  return {
    id: s.id,
    number: s.number,
    status: s.status,
    createdAt: s.created_at,
    client: s.client ? { id: s.client.id, name: fullName(s.client), email: s.client.email } : null,
    appointmentId: s.appointment_id,
    items: [...s.sale_items]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        description: i.description,
        staffName: i.staff?.first_name ?? null,
        quantity: i.quantity,
        unitPriceCents: i.unit_price_cents,
        bookedPriceCents: i.booked_price_cents,
        priceReason: i.price_reason,
        discountCents: i.discount_cents,
        taxCents: i.tax_cents,
        totalCents: i.total_cents,
        returnedQuantity: i.returned_quantity,
      })),
    tips: s.sale_tips.map((t) => ({ staffName: t.staff?.first_name ?? "Stylist", amountCents: t.amount_cents })),
    payments: [...s.payments]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((p) => ({ id: p.id, method: p.method, amountCents: p.amount_cents, tenderedCents: p.tendered_cents, changeCents: p.change_cents, reference: p.reference, reason: p.reason, createdAt: p.created_at })),
    events: [...s.sale_events]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((e) => ({ kind: e.kind, amountCents: e.amount_cents, detail: e.detail, staffName: e.staff?.first_name ?? null, createdAt: e.created_at })),
    subtotalCents: s.subtotal_cents,
    discountCents: s.discount_cents,
    discountReason: s.discount_reason,
    taxCents: s.tax_cents,
    tipCents: s.tip_cents,
    totalCents: s.total_cents,
    refundedCents: s.refunded_cents,
    voidReason: s.void_reason,
    receiptEmail: s.receipt_email,
    soldBy: s.seller?.first_name ?? null,
  };
}

export type ReceiptSalon = { name: string; locationName: string; address: string | null; footer: string | null; showStylists: boolean; accentColor: string | null };

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The receipt as plain text and as a simple HTML email.
export function receiptText(sale: SaleView, salon: ReceiptSalon, when: string): { subject: string; text: string; html: string } {
  const lines: [string, string][] = [];
  for (const i of sale.items) {
    const who = salon.showStylists && i.staffName ? ` (${i.staffName})` : "";
    lines.push([`${i.quantity > 1 ? `${i.quantity} × ` : ""}${i.description}${who}`, formatPrice(i.unitPriceCents * i.quantity)]);
  }
  const totals: [string, string][] = [["Subtotal", formatPrice(sale.subtotalCents)]];
  if (sale.discountCents) totals.push([`Discount${sale.discountReason ? ` (${sale.discountReason})` : ""}`, `−${formatPrice(sale.discountCents)}`]);
  if (sale.taxCents) totals.push(["Tax", formatPrice(sale.taxCents)]);
  for (const t of sale.tips) totals.push([`Tip for ${t.staffName}`, formatPrice(t.amountCents)]);
  totals.push(["Total", formatPrice(sale.totalCents)]);
  const paid: [string, string][] = sale.payments.map((p) => [
    `${p.amountCents < 0 ? "Refund" : "Paid"} by ${METHOD_LABELS[p.method].toLowerCase()}${p.reference ? ` (${p.reference})` : ""}`,
    formatPrice(p.amountCents),
  ]);
  const change = sale.payments.reduce((n, p) => n + (p.changeCents ?? 0), 0);
  if (change) paid.push(["Change", formatPrice(change)]);

  const subject = `Your receipt from ${salon.name}`;
  const text = [
    salon.name,
    salon.locationName,
    `Receipt #${sale.number} · ${when}`,
    sale.client ? `For ${sale.client.name}` : "",
    "",
    ...lines.map(([a, b]) => `${a}  ${b}`),
    "",
    ...totals.map(([a, b]) => `${a}  ${b}`),
    ...paid.map(([a, b]) => `${a}  ${b}`),
    sale.status === "voided" ? "\nThis sale was voided." : "",
    salon.footer ? `\n${salon.footer}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const row = ([a, b]: [string, string], bold = false) =>
    `<tr><td style="padding:4px 0;${bold ? "font-weight:600;" : ""}">${escape(a)}</td><td style="padding:4px 0;text-align:right;${bold ? "font-weight:600;" : ""}">${escape(b)}</td></tr>`;
  const accent = salon.accentColor ?? "#17273B";
  const html = `<!doctype html><html><body style="margin:0;background:#FBF8F5;font-family:Inter,Arial,sans-serif;color:#1D2532">
<div style="max-width:420px;margin:24px auto;background:#fff;border:1px solid #EBE4DD;border-radius:12px;overflow:hidden">
<div style="background:${escape(accent)};color:#fff;padding:20px 24px"><div style="font-size:20px;font-weight:600">${escape(salon.name)}</div><div style="opacity:.85;font-size:14px">${escape(salon.locationName)}</div></div>
<div style="padding:20px 24px;font-size:14px">
<p style="margin:0 0 12px;color:#565E6B">Receipt #${sale.number} · ${escape(when)}${sale.client ? `<br>For ${escape(sale.client.name)}` : ""}</p>
<table style="width:100%;border-collapse:collapse">${lines.map((l) => row(l)).join("")}</table>
<hr style="border:0;border-top:1px solid #EBE4DD;margin:12px 0">
<table style="width:100%;border-collapse:collapse">${totals.map((l) => row(l, l[0] === "Total")).join("")}${paid.map((l) => row(l)).join("")}</table>
${sale.status === "voided" ? '<p style="color:#B42318">This sale was voided.</p>' : ""}
${salon.footer ? `<p style="margin:16px 0 0;color:#565E6B">${escape(salon.footer)}</p>` : ""}
</div></div>
<p style="text-align:center;font-size:12px;color:#666E7C">Powered by Maestra</p>
</body></html>`;
  return { subject, text, html };
}

// The salon's details for a receipt (its name, location, footer and color).
export async function receiptSalon(businessId: string, locationId: string): Promise<ReceiptSalon> {
  const admin = createAdminClient();
  const [{ data: b }, { data: l }, { data: o }] = await Promise.all([
    admin.from("businesses").select("name, receipt_footer, receipt_show_stylists").eq("id", businessId).single(),
    admin.from("locations").select("name, address_line1, city").eq("id", locationId).single(),
    admin.from("online_booking_settings").select("accent_color").eq("business_id", businessId).maybeSingle(),
  ]);
  return {
    name: b?.name ?? "Your salon",
    locationName: l?.name ?? "",
    address: [l?.address_line1, l?.city].filter(Boolean).join(", ") || null,
    footer: b?.receipt_footer ?? null,
    showStylists: b?.receipt_show_stylists ?? true,
    accentColor: o?.accent_color ?? null,
  };
}
