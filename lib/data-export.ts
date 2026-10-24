// "Your data is yours": everything a salon keeps here as CSV files in one
// zip (clients, visits, formulas, sales, products, gift cards, packages,
// and the services and team they refer to). Loaded with the owner's own
// client, so RLS keeps it to their salon. Card numbers are never stored, so
// they're never in it; nor are photos (they stay in storage).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { csvTable, dollars, type Cell } from "@/lib/csv";
import { minuteToTime, toLocal } from "@/lib/scheduling/time";
import { zip } from "@/lib/zip";

type Supabase = SupabaseClient<Database>;
type Row = Record<string, unknown>;

// Every row of a table for the business, a page at a time.
async function rows(supabase: Supabase, table: keyof Database["public"]["Tables"], businessId: string, columns = "*", orderBy: string[] = ["id"]): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    // A unique order, so pages never skip or repeat a row.
    let query = supabase.from(table).select(columns).eq("business_id" as never, businessId as never);
    for (const column of orderBy) query = query.order(column as never);
    const { data, error } = await query.range(from, from + 999);
    if (error) throw error;
    out.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  return out;
}

export type ExportFile = { name: string; header: string[]; rows: Cell[][] };

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// Builds every file. `timeZone` is the salon's (times are shown in it).
export async function exportFiles(supabase: Supabase, businessId: string, timeZone: string): Promise<ExportFile[]> {
  const when = (iso: unknown) => {
    if (!iso) return null;
    const l = toLocal(new Date(String(iso)), timeZone);
    return `${l.date} ${minuteToTime(l.minute)}`;
  };
  const [clients, staff, services, appointments, items, formulas, formulaProducts, sales, saleItems, payments, tips, products, stock, suppliers, cards, cardEvents, packages, packageItems] =
    await Promise.all([
      rows(supabase, "clients", businessId),
      rows(supabase, "staff", businessId, "id, first_name, last_name, email, phone, role, level, is_active, created_at"),
      rows(supabase, "services", businessId),
      rows(supabase, "appointments", businessId, "id, client_id, starts_at, ends_at, status, source, notes, cancel_reason, checked_in_at, checked_out_at, created_at"),
      rows(supabase, "appointment_items", businessId, "id, appointment_id, service_id, staff_id, starts_at, ends_at, price_cents"),
      rows(supabase, "client_formulas", businessId),
      rows(supabase, "formula_products", businessId),
      rows(supabase, "sales", businessId),
      rows(supabase, "sale_items", businessId),
      rows(supabase, "payments", businessId, "id, sale_id, method, amount_cents, tendered_cents, change_cents, reference, reason, created_at"),
      rows(supabase, "sale_tips", businessId, "*", ["sale_id", "staff_id"]),
      rows(supabase, "products", businessId),
      rows(supabase, "stock_levels", businessId),
      rows(supabase, "suppliers", businessId),
      rows(supabase, "gift_cards", businessId),
      rows(supabase, "gift_card_events", businessId),
      rows(supabase, "client_packages", businessId),
      rows(supabase, "client_package_items", businessId),
    ]);

  const byId = (list: Row[]) => new Map(list.map((r) => [r.id as string, r]));
  const staffName = new Map(staff.map((r) => [r.id as string, `${r.first_name} ${r.last_name ?? ""}`.trim()]));
  const clientName = new Map(clients.map((r) => [r.id as string, `${r.first_name} ${r.last_name ?? ""}`.trim()]));
  const serviceName = new Map(services.map((r) => [r.id as string, r.name as string]));
  const product = byId(products);
  const productName = (id: unknown) => {
    const p = product.get(id as string);
    return p ? [p.brand, p.line, p.name].filter(Boolean).join(" ") : null;
  };
  const appointment = byId(appointments);
  const saleNumber = new Map(sales.map((r) => [r.id as string, r.number as number]));
  const cardCode = new Map(cards.map((r) => [r.id as string, r.code as string]));
  const supplierName = new Map(suppliers.map((r) => [r.id as string, r.name as string]));
  const pkg = byId(packages);
  const stockOf = new Map<string, number>();
  for (const l of stock) stockOf.set(l.product_id as string, (stockOf.get(l.product_id as string) ?? 0) + Number(l.on_hand));
  const formulaLines = new Map<string, string[]>();
  for (const fp of [...formulaProducts].sort((a, b) => Number(a.position) - Number(b.position))) {
    const p = product.get(fp.product_id as string);
    formulaLines.set(fp.formula_id as string, [...(formulaLines.get(fp.formula_id as string) ?? []), `${fp.amount}${p ? (p.unit === "unit" ? "" : p.unit) : ""} ${productName(fp.product_id) ?? ""}`.trim()]);
  }

  return [
    {
      name: "clients.csv",
      header: ["Client ID", "First name", "Last name", "Email", "Phone", "Preferred stylist", "Preferences", "Notes", "Allergies", "Consent form signed", "Texts OK", "Marketing emails OK", "Photo marketing consent", "Added"],
      rows: clients.map((c) => [
        s(c.id),
        s(c.first_name),
        s(c.last_name),
        s(c.email),
        s(c.phone),
        staffName.get(c.preferred_staff_id as string) ?? null,
        s(c.preferences),
        s(c.notes),
        s(c.allergies),
        s(c.consent_signed_on),
        c.sms_opt_in ? "yes" : "no",
        c.email_opt_in ? "yes" : "no",
        s(c.photo_consent_on),
        when(c.created_at),
      ]),
    },
    {
      name: "visits.csv",
      header: ["Visit ID", "Date and time", "Client ID", "Client", "Service", "Stylist", "Ends", "Price", "Status", "Booked by", "Checked in", "Checked out", "Cancel reason", "Visit notes"],
      rows: [...items]
        .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
        .map((i) => {
          const a = appointment.get(i.appointment_id as string) ?? {};
          return [
            s(i.appointment_id),
            when(i.starts_at),
            s(a.client_id),
            clientName.get(a.client_id as string) ?? "Walk-in",
            serviceName.get(i.service_id as string) ?? null,
            staffName.get(i.staff_id as string) ?? null,
            when(i.ends_at),
            dollars(n(i.price_cents)),
            s(a.status),
            s(a.source),
            when(a.checked_in_at),
            when(a.checked_out_at),
            s(a.cancel_reason),
            s(a.notes),
          ];
        }),
    },
    {
      name: "formulas.csv",
      header: ["Formula ID", "Visit date", "Client ID", "Client", "Recorded by", "Formula", "Products", "Notes"],
      rows: formulas.map((f) => [s(f.id), s(f.visit_date), s(f.client_id), clientName.get(f.client_id as string) ?? null, staffName.get(f.staff_id as string) ?? null, s(f.formula), (formulaLines.get(f.id as string) ?? []).join(" + "), s(f.notes)]),
    },
    {
      name: "sales.csv",
      header: ["Sale number", "Date and time", "Client ID", "Client", "Status", "Subtotal", "Discount", "Discount reason", "Tax", "Tips", "Total", "Refunded", "Void reason", "Note"],
      rows: [...sales]
        .sort((a, b) => Number(a.number) - Number(b.number))
        .map((x) => [
          n(x.number),
          when(x.created_at),
          s(x.client_id),
          clientName.get(x.client_id as string) ?? "Walk-in",
          s(x.status),
          dollars(n(x.subtotal_cents)),
          dollars(n(x.discount_cents)),
          s(x.discount_reason),
          dollars(n(x.tax_cents)),
          dollars(n(x.tip_cents)),
          dollars(n(x.total_cents)),
          dollars(n(x.refunded_cents)),
          s(x.void_reason),
          s(x.note),
        ]),
    },
    {
      name: "sale_lines.csv",
      header: ["Sale number", "Line", "Kind", "Description", "Stylist", "Quantity", "Unit price", "Booked price", "Price change reason", "Discount", "Tax", "Total", "Returned"],
      rows: [...saleItems]
        .sort((a, b) => Number(saleNumber.get(a.sale_id as string)) - Number(saleNumber.get(b.sale_id as string)) || Number(a.position) - Number(b.position))
        .map((i) => [
          saleNumber.get(i.sale_id as string) ?? null,
          n(i.position),
          s(i.kind),
          s(i.description),
          staffName.get(i.staff_id as string) ?? null,
          n(i.quantity),
          dollars(n(i.unit_price_cents)),
          dollars(n(i.booked_price_cents)),
          s(i.price_reason),
          dollars(n(i.discount_cents)),
          dollars(n(i.tax_cents)),
          dollars(n(i.total_cents)),
          n(i.returned_quantity),
        ]),
    },
    {
      name: "payments.csv",
      header: ["Sale number", "Date and time", "Method", "Amount", "Tendered", "Change", "Reference (last 4 or approval)", "Refund or void reason"],
      rows: [...payments]
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((p) => [saleNumber.get(p.sale_id as string) ?? null, when(p.created_at), s(p.method), dollars(n(p.amount_cents)), dollars(n(p.tendered_cents)), dollars(n(p.change_cents)), s(p.reference), s(p.reason)]),
    },
    {
      name: "tips.csv",
      header: ["Sale number", "Stylist", "Tip"],
      rows: tips.map((t) => [saleNumber.get(t.sale_id as string) ?? null, staffName.get(t.staff_id as string) ?? null, dollars(n(t.amount_cents))]),
    },
    {
      name: "products.csv",
      header: ["Product ID", "Brand", "Line", "Name", "SKU", "Barcode", "Type", "Unit", "Size", "Cost", "Retail price", "Supplier", "Shelf", "On hand", "Active"],
      rows: products.map((p) => [
        s(p.id),
        s(p.brand),
        s(p.line),
        s(p.name),
        s(p.sku),
        s(p.barcode),
        s(p.type),
        s(p.unit),
        n(p.size),
        dollars(n(p.cost_cents)),
        dollars(n(p.price_cents)),
        supplierName.get(p.supplier_id as string) ?? null,
        s(p.shelf),
        stockOf.get(p.id as string) ?? 0,
        p.is_active ? "yes" : "no",
      ]),
    },
    {
      name: "gift_cards.csv",
      header: ["Code", "Kind", "Status", "Initial value", "Balance", "Expires", "Client", "For", "Recipient email", "Physical card", "Imported", "Created"],
      rows: cards.map((c) => [
        s(c.code),
        s(c.kind),
        s(c.status),
        dollars(n(c.initial_cents)),
        dollars(n(c.balance_cents)),
        when(c.expires_at),
        clientName.get(c.client_id as string) ?? null,
        s(c.recipient_name),
        s(c.recipient_email),
        c.physical ? "yes" : "no",
        c.imported ? "yes" : "no",
        when(c.created_at),
      ]),
    },
    {
      name: "gift_card_history.csv",
      header: ["Code", "Date and time", "What", "Amount", "Balance after", "Sale number", "Reason", "By"],
      rows: [...cardEvents]
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((e) => [cardCode.get(e.card_id as string) ?? null, when(e.created_at), s(e.kind), dollars(n(e.amount_cents)), dollars(n(e.balance_after)), saleNumber.get(e.sale_id as string) ?? null, s(e.reason), staffName.get(e.staff_id as string) ?? null]),
    },
    {
      name: "packages.csv",
      header: ["Package ID", "Client ID", "Client", "Package", "Status", "Price", "Bought", "Expires", "Service", "Uses", "Used", "Left", "Value of one use"],
      rows: packageItems.map((i) => {
        const p = pkg.get(i.client_package_id as string) ?? {};
        return [
          s(i.client_package_id),
          s(p.client_id),
          clientName.get(p.client_id as string) ?? null,
          s(p.name),
          s(p.status),
          dollars(n(p.price_cents)),
          when(p.created_at),
          when(p.expires_at),
          serviceName.get(i.service_id as string) ?? null,
          n(i.total),
          n(i.used),
          Number(i.total) - Number(i.used),
          dollars(n(i.use_value_cents)),
        ];
      }),
    },
    {
      name: "services.csv",
      header: ["Service ID", "Name", "Category", "Minutes", "Price", "Needs a patch test", "Bookable online", "Archived"],
      rows: services.map((x) => [s(x.id), s(x.name), s(x.category), n(x.duration_minutes), dollars(n(x.price_cents)), x.requires_patch_test ? "yes" : "no", x.online_booking ? "yes" : "no", when(x.archived_at)]),
    },
    {
      name: "team.csv",
      header: ["Staff ID", "First name", "Last name", "Email", "Phone", "Role", "Level", "Active"],
      rows: staff.map((x) => [s(x.id), s(x.first_name), s(x.last_name), s(x.email), s(x.phone), s(x.role), s(x.level), x.is_active ? "yes" : "no"]),
    },
  ];
}

const README = (salon: string, at: string, files: ExportFile[]) =>
  [
    `Your data is yours: ${salon}, exported ${at}.`,
    "",
    "Every file is CSV (UTF-8, comma-separated, a header row first), ready for a spreadsheet or another system.",
    "Amounts are in dollars; times are in the salon's time zone. IDs link the files: a visit's Client ID is a row in clients.csv.",
    "Card numbers are never stored, so none are here. Photos aren't included; they stay in your salon's private storage.",
    "",
    ...files.map((f) => `${f.name}: ${f.rows.length} rows`),
    "",
  ].join("\r\n");

// The zip, and the row counts for the log.
export function exportZip(files: ExportFile[], salon: string, at: string): { zip: Buffer; counts: Record<string, number> } {
  return {
    zip: zip([{ name: "README.txt", data: README(salon, at, files) }, ...files.map((f) => ({ name: f.name, data: "﻿" + csvTable(f.header, f.rows) }))]),
    counts: Object.fromEntries(files.map((f) => [f.name.replace(/\.csv$/, ""), f.rows.length])),
  };
}
