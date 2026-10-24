// The full-screen checkout: starting one (a draft ticket from a visit, or a
// new sale) and loading everything the screen needs. Server side.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { describeClient } from "@/lib/insights/describe";
import { loadClientInsights } from "@/lib/insights/read";
import { memberPrices, type MemberPrices } from "@/lib/memberships";
import { creditFor, loadClientMemberships, loadPlans, type ClientMembership, type MembershipPlan } from "@/lib/memberships-load";
import { isUsable, loadClientPackages, loadTemplates, packageFor, withPackages, type ClientPackage, type PackageTemplate } from "@/lib/packages";
import { currentProvider } from "@/lib/payments";
import { DEPOSIT_REFERENCE } from "@/lib/policy";
import { suggestRebook, weeksUntilNext, type RebookSuggestion } from "@/lib/rebook";
import { loadCheckoutSettings, loadRetailProducts, type CheckoutProduct, type CheckoutSettings } from "@/lib/sales";
import { formatDay } from "@/lib/schedule-format";
import type { StaffLevel } from "@/lib/schedule-forms";
import { loadBookingContext, loadOffers, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, formatMinute, todayIn, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { levelPricesFrom, stylistPrice } from "@/lib/services";
import { fullName, sortStaff, type StaffRole } from "@/lib/staff";
import { EMPTY_TICKET, parseTicket, type ServiceLine, type Ticket } from "@/lib/ticket";

type Supabase = SupabaseClient<Database>;
type Me = { id: string; business_id: string; role: StaffRole; permissions: readonly string[]; location: { id: string; timezone: string } };

const key = () => crypto.randomUUID();

// Only paths inside the app, to go back to.
export function safeReturn(path: string | null | undefined): string | null {
  return path && /^\/[^/\\]/.test(path) && path.length <= 300 ? path : null;
}

// A checkout for a visit (its open one if there is, else a new ticket with
// the visit's services, using the client's package or what their
// membership includes where one covers it),
// or a new sale (optionally with a product on it). Returns the draft's id.
export async function startCheckout(supabase: Supabase, me: Me, options: { appointmentId?: string | null; productId?: string | null; returnTo?: string | null }): Promise<string | null> {
  const returnTo = safeReturn(options.returnTo);
  if (options.appointmentId) {
    const { data: open } = await supabase.from("sale_drafts").select("id").eq("appointment_id", options.appointmentId).eq("status", "open").maybeSingle();
    if (open) return open.id;
    const { data: a } = await supabase
      .from("appointments")
      .select("id, status, client_id, location_id, deposit_paid_cents, deposit_outcome, appointment_items(id, starts_at, service_id, staff_id, price_cents, service:services(name), staff:staff(level))")
      .eq("id", options.appointmentId)
      .maybeSingle();
    if (!a || a.location_id !== me.location.id || !["booked", "confirmed", "checked_in"].includes(a.status)) return null;
    const packages = a.client_id ? (await loadClientPackages(supabase, a.client_id, true)).filter((p) => isUsable(p)) : [];
    const memberships = a.client_id ? await loadClientMemberships(supabase, a.client_id, true) : [];
    const used = new Map<string, number>();
    const creditsUsed = new Map<string, number>();
    const lines: ServiceLine[] = [...a.appointment_items]
      .sort((x, y) => x.starts_at.localeCompare(y.starts_at))
      .map((i) => {
        // A use of their package, if one covers it (and has a use left
        // after the lines before).
        const offer = packageFor(
          packages.map((p) => ({ ...p, items: p.items.map((it) => ({ ...it, used: it.used + (used.get(it.id) ?? 0) })) })),
          i.service_id,
          i.staff?.level ?? null,
        );
        if (offer) used.set(offer.item.id, (used.get(offer.item.id) ?? 0) + 1);
        const included = offer ? null : creditFor(memberships, i.service_id, creditsUsed);
        if (included) creditsUsed.set(included.credit.id, (creditsUsed.get(included.credit.id) ?? 0) + 1);
        return {
          key: key(),
          kind: "service",
          appointmentItemId: i.id,
          serviceId: i.service_id,
          name: i.service.name,
          staffId: i.staff_id,
          unitPriceCents: i.price_cents,
          basePriceCents: i.price_cents,
          priceReason: "",
          quantity: 1,
          discount: null,
          packageItemId: offer?.item.id ?? null,
          membershipCreditId: included?.credit.id ?? null,
        };
      });
    const { data, error } = await supabase
      .from("sale_drafts")
      .insert({ business_id: me.business_id, location_id: me.location.id, appointment_id: a.id, client_id: a.client_id, ticket: { ...EMPTY_TICKET, lines, payments: depositPayment(a) } as never, return_to: returnTo, created_by: me.id })
      .select("id")
      .single();
    // Someone else just opened it: use theirs.
    if (error?.code === "23505") return (await supabase.from("sale_drafts").select("id").eq("appointment_id", a.id).eq("status", "open").single()).data!.id;
    if (error) throw error;
    return data.id;
  }

  let ticket: Ticket = EMPTY_TICKET;
  if (options.productId) {
    const { data: p } = await supabase.from("products").select("id, brand, line, name, price_cents, type").eq("id", options.productId).maybeSingle();
    if (p?.type === "retail") ticket = { ...EMPTY_TICKET, lines: [{ key: key(), kind: "product", productId: p.id, name: [p.brand, p.line, p.name].filter(Boolean).join(" "), staffId: null, unitPriceCents: p.price_cents ?? 0, quantity: 1, discount: null }] };
  }
  const { data, error } = await supabase
    .from("sale_drafts")
    .insert({ business_id: me.business_id, location_id: me.location.id, ticket: ticket as never, return_to: returnTo, created_by: me.id })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// A deposit the client paid ahead, taken off the bill.
function depositPayment(a: { deposit_paid_cents: number; deposit_outcome: string | null }): Ticket["payments"] {
  return a.deposit_paid_cents > 0 && a.deposit_outcome === null ? [{ key: "deposit", method: "card", amountCents: a.deposit_paid_cents, reference: DEPOSIT_REFERENCE }] : [];
}

export type ScreenStaff = { id: string; firstName: string; name: string; level: StaffLevel | null; color: string | null };
export type ScreenService = { id: string; name: string; category: string; priceFor: Record<string, number> };

export type CheckoutScreenData = {
  draft: { id: string; status: "open" | "completed"; saleId: string | null; returnTo: string; appointmentId: string | null };
  ticket: Ticket;
  client: { id: string; name: string; firstName: string; email: string | null; phone: string | null } | null;
  // The latest payment link sent for this checkout (text-to-pay).
  link: { id: string; status: "open" | "paid" | "canceled"; channel: "sms" | "email"; sentTo: string; expiresAt: string; createdAt: string; amountCents: number; tipCents: number | null } | null;
  insight: { summary: string; tags: { label: string; tone: string }[] } | null;
  packages: ClientPackage[];
  // Live memberships: what they include this period, and member prices.
  memberships: ClientMembership[];
  member: MemberPrices | null;
  // Memberships for sale, and the provider renewals are charged through.
  plans: MembershipPlan[];
  provider: { id: string; label: string; testMode: boolean; testCards: { ref: string; label: string; outcome: string }[] };
  giftCards: { code: string; balanceCents: number; kind: "purchased" | "promotional" }[];
  staff: ScreenStaff[];
  services: ScreenService[];
  products: (CheckoutProduct & { brand: string })[];
  bestSellers: string[];
  recommended: { staffId: string; productIds: string[] } | null;
  // Who products are credited to unless changed: the visit's stylist.
  defaultStaffId: string | null;
  templates: PackageTemplate[];
  settings: CheckoutSettings;
  role: StaffRole;
  permissions: readonly string[];
  canOverride: boolean;
  overrides: string[];
  rebook: RebookSuggestion | null;
  nextClient: { appointmentId: string; name: string; time: string } | null;
};

export async function loadCheckoutScreen(supabase: Supabase, me: Me, draftId: string, now = new Date()): Promise<CheckoutScreenData | null> {
  const { data: draft, error } = await supabase.from("sale_drafts").select("id, status, sale_id, return_to, appointment_id, client_id, ticket").eq("id", draftId).maybeSingle();
  if (error) throw error;
  if (!draft) return null;
  const tz = me.location.timezone;
  const today = todayIn(tz, now);

  const [staffRows, settings, products, templates, servicesRows, clientRow, overrides, plans] = await Promise.all([
    supabase.from("staff").select("id, first_name, last_name, role, level, color, is_active, location_id").eq("location_id", me.location.id).eq("is_active", true),
    loadCheckoutSettings(supabase, me.business_id),
    loadRetailProducts(supabase, me.business_id, me.location.id),
    loadTemplates(supabase, me.business_id),
    supabase.from("services").select("id, name, category, price_cents, archived_at, service_level_prices(level, price_cents)").eq("business_id", me.business_id).is("archived_at", null).order("name"),
    draft.client_id ? supabase.from("clients").select("id, first_name, last_name, email, phone").eq("id", draft.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("stock_overrides").select("product_id").eq("draft_id", draft.id),
    loadPlans(supabase, me.business_id),
  ]);
  if (staffRows.error) throw staffRows.error;
  if (servicesRows.error) throw servicesRows.error;
  const offers = await loadOffers(supabase, staffRows.data.map((s) => s.id));
  const stylists = sortStaff(staffRows.data).filter((s) => (offers.get(s.id)?.size ?? 0) > 0);
  const staff: ScreenStaff[] = stylists.map((s) => ({ id: s.id, firstName: s.first_name, name: fullName(s), level: s.level, color: s.color }));
  const services: ScreenService[] = servicesRows.data.map((sv) => ({
    id: sv.id,
    name: sv.name,
    category: sv.category,
    priceFor: Object.fromEntries(
      stylists.flatMap((s) =>
        offers.get(s.id)?.has(sv.id) ? [[s.id, stylistPrice({ price_cents: sv.price_cents, levelPrices: levelPricesFrom(sv.service_level_prices) }, { level: s.level, customCents: offers.get(s.id)!.get(sv.id) ?? null })]] : [],
      ),
    ),
  }));

  // Brands for searching by brand.
  const { data: brands } = await supabase.from("products").select("id, brand").eq("business_id", me.business_id).eq("type", "retail");
  const brandOf = new Map((brands ?? []).map((b) => [b.id, b.brand]));

  // Best sellers (last 90 days), and the visit stylist's favorites.
  const since = startOfLocalDay(addDays(today, -90), tz).toISOString();
  const { data: sold } = await supabase.from("sale_items").select("product_id, quantity, staff_id, sale:sales!inner(status, created_at)").eq("kind", "product").neq("sale.status", "voided").gte("sale.created_at", since);
  const rank = (rows: { product_id: string | null; quantity: number }[]) => {
    const totals = new Map<string, number>();
    for (const r of rows) if (r.product_id) totals.set(r.product_id, (totals.get(r.product_id) ?? 0) + r.quantity);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => products.some((p) => p.id === id));
  };

  const client = clientRow.data ? { id: clientRow.data.id, name: fullName(clientRow.data), firstName: clientRow.data.first_name, email: clientRow.data.email, phone: clientRow.data.phone } : null;
  const { data: link } = await supabase
    .from("payment_links")
    .select("id, status, channel, sent_to, expires_at, created_at, amount_cents, tip_cents")
    .eq("draft_id", draft.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ticket = parseTicket(draft.ticket);
  const visitStaff = ticket.lines.find((l) => l.kind === "service")?.kind === "service" ? (ticket.lines.find((l) => l.kind === "service") as ServiceLine).staffId : null;

  // The client: what Denise knows, packages and gift cards.
  let insight: CheckoutScreenData["insight"] = null;
  let packages: ClientPackage[] = [];
  let memberships: ClientMembership[] = [];
  let giftCards: CheckoutScreenData["giftCards"] = [];
  let rebook: RebookSuggestion | null = null;
  if (client) {
    const [insights, pkgs, cards, live] = await Promise.all([
      loadClientInsights(supabase, me.business_id, [client.id]),
      loadClientPackages(supabase, client.id, true),
      supabase.from("gift_cards").select("code, balance_cents, kind, expires_at").eq("client_id", client.id).eq("status", "active").gt("balance_cents", 0),
      loadClientMemberships(supabase, client.id, true),
    ]);
    packages = pkgs.filter((p) => isUsable(p, now));
    memberships = live;
    giftCards = (cards.data ?? []).filter((c) => !c.expires_at || new Date(c.expires_at) > now).map((c) => ({ code: c.code, balanceCents: c.balance_cents, kind: c.kind }));
    const names = new Map(staff.map((s) => [s.id, s.firstName]));
    const known = insights.get(client.id);
    insight = withPackages(known ? describeClient(known.habits, known.spend, { staff: (id) => names.get(id) ?? null, dayOf: (iso) => formatDay(iso.slice(0, 10)) }, now) : null, packages);

    // Their next visit: today's services with their usual stylist.
    if (draft.appointment_id && draft.status === "open") {
      const { data: items } = await supabase.from("appointment_items").select("service_id, staff_id, starts_at, price_cents").eq("appointment_id", draft.appointment_id).order("starts_at");
      // The visit's main service (the priciest) and its stylist's services.
      const main = [...(items ?? [])].sort((a, b) => b.price_cents - a.price_cents)[0];
      const first = items?.find((i) => i.staff_id === main?.staff_id);
      if (main && first) {
        const stylistId = known?.habits.preferredStaffId && names.has(known.habits.preferredStaffId) ? known.habits.preferredStaffId : main.staff_id;
        const serviceIds = items!.filter((i) => i.staff_id === main.staff_id).map((i) => i.service_id);
        const from = addDays(today, 1);
        const to = addDays(today, weeksUntilNext(known?.habits.intervalDays ?? null) * 7 + 7);
        const ctx = await loadBookingContext(supabase, me.location, from, to);
        rebook = suggestRebook(ctx, {
          today,
          clientFirstName: client.firstName,
          intervalDays: known?.habits.intervalDays ?? null,
          staffId: stylistId,
          staffFirstName: names.get(stylistId) ?? "their stylist",
          serviceIds,
          aroundMinute: toLocal(new Date(first.starts_at), tz).minute,
          formatDate: (d: LocalDate) => formatDay(d),
        });
      }
    }
  }

  // The next person waiting to check out: checked in today, not this visit.
  const { data: waiting } = await supabase
    .from("appointments")
    .select("id, starts_at, client:clients(first_name, last_name)")
    .eq("location_id", me.location.id)
    .eq("status", "checked_in")
    .gte("starts_at", startOfLocalDay(today, tz).toISOString())
    .lt("starts_at", startOfLocalDay(addDays(today, 1), tz).toISOString())
    .order("starts_at")
    .limit(5);
  const next = (waiting ?? []).find((w) => w.id !== draft.appointment_id);

  return {
    draft: { id: draft.id, status: draft.status as "open" | "completed", saleId: draft.sale_id, returnTo: draft.return_to ?? "/calendar", appointmentId: draft.appointment_id },
    ticket,
    client,
    link: link
      ? {
          id: link.id,
          status: link.status as "open" | "paid" | "canceled",
          channel: link.channel as "sms" | "email",
          sentTo: link.sent_to,
          expiresAt: link.expires_at,
          createdAt: link.created_at,
          amountCents: link.amount_cents,
          tipCents: link.tip_cents,
        }
      : null,
    insight,
    packages,
    memberships,
    member: memberPrices(memberships),
    plans,
    provider: (({ id, label, testMode, testCards }) => ({ id, label, testMode, testCards: testCards.map((c) => ({ ...c })) }))(currentProvider()),
    giftCards,
    staff,
    services,
    products: products.map((p) => ({ ...p, brand: brandOf.get(p.id) ?? "" })),
    bestSellers: rank(sold ?? []).slice(0, 6),
    recommended: visitStaff ? { staffId: visitStaff, productIds: rank((sold ?? []).filter((r) => r.staff_id === visitStaff)).slice(0, 4) } : null,
    defaultStaffId: visitStaff,
    templates,
    settings,
    role: me.role,
    permissions: me.permissions,
    canOverride: me.role === "owner" || me.role === "manager",
    overrides: (overrides.data ?? []).map((o) => o.product_id),
    rebook,
    nextClient: next ? { appointmentId: next.id, name: next.client ? fullName(next.client) : "Walk-in", time: formatMinute(toLocal(new Date(next.starts_at), tz).minute) } : null,
  };
}
