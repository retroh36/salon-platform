// Sending automated messages, with the service role (the hourly job, and
// "Send due messages now" for owners). For each salon with automations on,
// during sending hours: who's due (lib/automations.ts), by a channel they've
// said yes to, in the salon's own words, with an opt-out link. Each message
// is recorded once per client per occasion (marketing_messages), then put
// in the outbox (texts and email aren't connected yet).

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { siteUrl } from "@/lib/branding";
import type { ClientInsight } from "@/lib/insights/clients";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { toLocal } from "@/lib/scheduling/time";
import {
  automationProblems,
  canSendAt,
  channelFor,
  dueFor,
  renderTemplate,
  reviewDue,
  reviewLinks,
  withOptOut,
  type Automation,
  type AutomationKind,
  type AutomationSettings,
  type ClientFacts,
} from "./automations";

type Admin = SupabaseClient<Database>;

export type RunSummary = Record<AutomationKind, number> & { salons: number; skippedQuietHours: number };

const REVIEW_EVERY_DAYS = 30;

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

export async function runAutomations(admin: Admin, options: { businessId?: string; now?: Date } = {}): Promise<RunSummary> {
  const now = options.now ?? new Date();
  const summary: RunSummary = { rebook: 0, win_back: 0, birthday: 0, review: 0, salons: 0, skippedQuietHours: 0 };
  let query = admin.from("marketing_automations").select("business_id, kind, enabled, subject, body, settings").eq("enabled", true);
  if (options.businessId) query = query.eq("business_id", options.businessId);
  const { data: rows, error } = await query;
  if (error) throw error;
  const byBusiness = new Map<string, Automation[]>();
  for (const r of rows) byBusiness.set(r.business_id, [...(byBusiness.get(r.business_id) ?? []), { kind: r.kind as AutomationKind, enabled: r.enabled, subject: r.subject, body: r.body, settings: r.settings as AutomationSettings }]);

  for (const [businessId, automations] of byBusiness) {
    const { data: b, error: bError } = await admin
      .from("businesses")
      .select("name, slug, google_review_url, yelp_url, online_booking_settings(enabled), locations(timezone, created_at)")
      .eq("id", businessId)
      .single();
    if (bError) throw bError;
    const tz = [...b.locations].sort((x, y) => x.created_at.localeCompare(y.created_at))[0]?.timezone ?? "America/Chicago";
    const local = toLocal(now, tz);
    if (!canSendAt(local.minute)) {
      summary.skippedQuietHours += 1;
      continue;
    }
    summary.salons += 1;
    const salon = { bookingLive: Boolean(b.slug && b.online_booking_settings?.enabled), googleUrl: b.google_review_url, yelpUrl: b.yelp_url };
    // Never send one that isn't set up right (it couldn't be turned on, but
    // settings can change under it: online booking turned off, say).
    const live = automations.filter((a) => automationProblems(a, salon).length === 0);
    if (!live.length) continue;
    const bookingUrl = `${siteUrl()}/book/${b.slug}`;

    // Clients who've said yes to texts or marketing email.
    const clients = await paged<{ id: string; first_name: string; phone: string | null; email: string | null; sms_opt_in: boolean; email_opt_in: boolean; sms_stopped_at: string | null; birth_month: number | null; birth_day: number | null }>((from, to) =>
      admin
        .from("clients")
        .select("id, first_name, phone, email, sms_opt_in, email_opt_in, sms_stopped_at, birth_month, birth_day")
        .eq("business_id", businessId)
        .or("sms_opt_in.eq.true,email_opt_in.eq.true")
        .order("id")
        .range(from, to),
    );
    if (!clients.length) continue;
    const reachable = new Set(clients.map((c) => c.id));
    const [insights, upcoming, recent, staff] = await Promise.all([
      paged<{ key: string; data: unknown }>((from, to) => admin.from("insights").select("key, data").eq("business_id", businessId).eq("kind", "client").order("key").range(from, to)),
      paged<{ client_id: string | null }>((from, to) =>
        admin
          .from("appointments")
          .select("client_id")
          .eq("business_id", businessId)
          .in("status", ["booked", "confirmed", "checked_in"])
          .gte("starts_at", startOfLocalDay(local.date, tz).toISOString())
          .order("id")
          .range(from, to),
      ),
      paged<{ client_id: string; kind: string; sent_at: string }>((from, to) =>
        admin
          .from("marketing_messages")
          .select("client_id, kind, sent_at")
          .eq("business_id", businessId)
          .gte("sent_at", new Date(now.getTime() - REVIEW_EVERY_DAYS * 86_400_000).toISOString())
          .order("id")
          .range(from, to),
      ),
      admin.from("staff").select("id, first_name").eq("business_id", businessId),
    ]);
    const habits = new Map(insights.map((r) => [r.key, r.data as ClientInsight]));
    const booked = new Set(upcoming.flatMap((a) => (a.client_id ? [a.client_id] : [])));
    const lastMessaged = new Map<string, string>();
    const lastReview = new Map<string, string>();
    for (const m of recent) {
      const map = m.kind === "review" ? lastReview : lastMessaged;
      if ((map.get(m.client_id) ?? "") < m.sent_at) map.set(m.client_id, m.sent_at);
    }
    const stylist = new Map((staff.data ?? []).map((s) => [s.id, s.first_name]));

    const send = async (a: Automation, c: (typeof clients)[number], cycleKey: string, appointmentId: string | null, preferredStaffId: string | null) => {
      const to = channelFor({ phone: c.phone, email: c.email, smsOptIn: c.sms_opt_in && !c.sms_stopped_at, emailOptIn: c.email_opt_in }, a.settings.prefer ?? "sms");
      if (!to) return false;
      const values = {
        first_name: c.first_name,
        salon: b.name,
        booking_link: `${bookingUrl}?src=${a.kind}`,
        stylist: (preferredStaffId && stylist.get(preferredStaffId)) || "us",
        offer: a.kind === "birthday" ? (a.settings.offer ?? "") : "",
        review_links: reviewLinks(salon.googleUrl, salon.yelpUrl),
      };
      const token = randomBytes(24).toString("base64url");
      const body = withOptOut(renderTemplate(a.body, values), to.channel, `${siteUrl()}/unsubscribe/${token}`);
      const subject = to.channel === "email" ? renderTemplate(a.subject, values) : null;
      // Recorded first: a second run (or a second server) finds it there.
      const { data: inserted, error: insertError } = await admin
        .from("marketing_messages")
        .upsert(
          { business_id: businessId, kind: a.kind, client_id: c.id, cycle_key: cycleKey, channel: to.channel, to_address: to.to, subject, body, appointment_id: appointmentId, opt_out_token_hash: createHash("sha256").update(token).digest("hex"), sent_at: now.toISOString() },
          { onConflict: "client_id,kind,cycle_key", ignoreDuplicates: true },
        )
        .select("id");
      if (insertError) throw insertError;
      if (!inserted?.length) return false;
      const { data: outbox, error: outboxError } = await admin.from("outbox_messages").insert({ business_id: businessId, channel: to.channel, to_address: to.to, subject, body }).select("id").single();
      if (outboxError) throw outboxError;
      await admin.from("marketing_messages").update({ outbox_message_id: outbox.id }).eq("id", inserted[0].id);
      return true;
    };

    for (const a of live) {
      if (a.kind === "review") {
        // Visits checked out a few hours ago.
        const hours = a.settings.hoursAfter ?? 3;
        const { data: visits, error: vError } = await admin
          .from("appointments")
          .select("id, client_id, checked_out_at, appointment_items(staff_id, starts_at)")
          .eq("business_id", businessId)
          .eq("status", "completed")
          .gte("checked_out_at", new Date(now.getTime() - (hours + 24) * 3_600_000).toISOString())
          .lte("checked_out_at", new Date(now.getTime() - hours * 3_600_000).toISOString());
        if (vError) throw vError;
        for (const v of visits) {
          if (!v.client_id || !reachable.has(v.client_id) || !v.checked_out_at || !reviewDue(v.checked_out_at, a.settings, now)) continue;
          if (lastReview.has(v.client_id)) continue;
          const c = clients.find((x) => x.id === v.client_id)!;
          const first = [...v.appointment_items].sort((x, y) => x.starts_at.localeCompare(y.starts_at))[0];
          if (await send(a, c, `review:${v.id}`, v.id, first?.staff_id ?? null)) {
            summary.review += 1;
            lastReview.set(c.id, now.toISOString());
          }
        }
        continue;
      }
      for (const c of clients) {
        const h = habits.get(c.id);
        const facts: ClientFacts = {
          id: c.id,
          firstName: c.first_name,
          phone: c.phone,
          email: c.email,
          smsOptIn: c.sms_opt_in,
          emailOptIn: c.email_opt_in,
          birthMonth: c.birth_month,
          birthDay: c.birth_day,
          due: h?.due ?? null,
          overdueDays: h?.overdueDays ?? 0,
          nextDue: h?.nextDue ?? null,
          lastVisit: h?.lastVisit ?? null,
          lastVisitOn: h?.lastVisit ? toLocal(new Date(h.lastVisit), tz).date : null,
          preferredStaffId: h?.preferredStaffId ?? null,
          hasUpcoming: booked.has(c.id),
          lastMessagedAt: lastMessaged.get(c.id) ?? null,
        };
        const key = dueFor(a.kind, facts, a.settings, local.date, now);
        if (key && (await send(a, c, key, null, facts.preferredStaffId))) {
          summary[a.kind] += 1;
          lastMessaged.set(c.id, now.toISOString());
        }
      }
    }
  }
  return summary;
}

