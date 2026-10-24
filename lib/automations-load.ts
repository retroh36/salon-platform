// Loading automations for the settings page: each one as set up (or its
// default), what it's done (sent, booked from it, revenue), and the salon's
// numbers Denise's suggestions come from. Owners and managers.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ClientInsight } from "@/lib/insights/clients";
import { AUTOMATION_KINDS, automationResults, DEFAULT_AUTOMATIONS, type Automation, type AutomationKind, type AutomationSettings, type Booking, type SalonFacts, type SentMessage } from "./automations";

type Supabase = SupabaseClient<Database>;

async function paged<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    rows.push(...data!);
    if (data!.length < 1000) break;
  }
  return rows;
}

export async function loadAutomations(supabase: Supabase, businessId: string): Promise<Automation[]> {
  const { data, error } = await supabase.from("marketing_automations").select("kind, enabled, subject, body, settings").eq("business_id", businessId);
  if (error) throw error;
  return AUTOMATION_KINDS.map((kind) => {
    const row = data.find((r) => r.kind === kind);
    return row
      ? { kind, enabled: row.enabled, subject: row.subject, body: row.body, settings: { ...DEFAULT_AUTOMATIONS[kind].settings, ...(row.settings as AutomationSettings) } }
      : { kind, enabled: false, ...DEFAULT_AUTOMATIONS[kind] };
  });
}

// The last `days` of messages and what came of them.
export async function loadAutomationResults(supabase: Supabase, businessId: string, days = 90, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const messages = await paged<{ id: string; kind: string; client_id: string; sent_at: string; opted_out_at: string | null }>((from, to) =>
    supabase.from("marketing_messages").select("id, kind, client_id, sent_at, opted_out_at").eq("business_id", businessId).gte("sent_at", since).order("id").range(from, to),
  );
  const sent: SentMessage[] = messages.map((m) => ({ id: m.id, kind: m.kind as AutomationKind, clientId: m.client_id, sentAt: m.sent_at, optedOut: m.opted_out_at !== null }));
  const clientIds = [...new Set(sent.map((m) => m.clientId))];
  const bookings: Booking[] = [];
  for (let i = 0; i < clientIds.length; i += 200) {
    const { data, error } = await supabase
      .from("appointments")
      .select("id, client_id, created_at, status, sales!sales_appointment_id_fkey(status, total_cents, tax_cents, tip_cents, refunded_cents)")
      .in("client_id", clientIds.slice(i, i + 200))
      .gte("created_at", since)
      .not("status", "in", "(canceled)");
    if (error) throw error;
    for (const a of data) {
      const revenue = a.sales.filter((s) => s.status !== "voided").reduce((n, s) => n + s.total_cents - s.tax_cents - s.tip_cents - s.refunded_cents, 0);
      bookings.push({ appointmentId: a.id, clientId: a.client_id!, createdAt: a.created_at, revenueCents: Math.max(0, revenue) });
    }
  }
  return automationResults(sent, bookings);
}

// The salon's numbers for Denise's suggestions (only clients who can be
// messaged count).
export async function loadSalonFacts(supabase: Supabase, businessId: string, hasReviewLink: boolean, now = new Date()): Promise<SalonFacts> {
  const [clients, insights, checkouts] = await Promise.all([
    paged<{ id: string; birth_month: number | null }>((from, to) =>
      supabase.from("clients").select("id, birth_month").eq("business_id", businessId).or("sms_opt_in.eq.true,email_opt_in.eq.true").order("id").range(from, to),
    ),
    paged<{ key: string; data: unknown }>((from, to) => supabase.from("insights").select("key, data").eq("business_id", businessId).eq("kind", "client").order("key").range(from, to)),
    supabase.from("appointments").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "completed").gte("checked_out_at", new Date(now.getTime() - 30 * 86_400_000).toISOString()),
  ]);
  const reachable = new Set(clients.map((c) => c.id));
  const habits = insights.filter((r) => reachable.has(r.key)).map((r) => r.data as ClientInsight);
  return {
    reachable: reachable.size,
    overdue: habits.filter((h) => h.due === "overdue").length,
    lapsed: habits.filter((h) => h.due === "lapsed").length,
    birthdays: clients.filter((c) => c.birth_month !== null).length,
    checkoutsLast30: checkouts.count ?? 0,
    hasReviewLink,
  };
}
