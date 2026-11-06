// Sending appointment reminders, with the service role (every 15 minutes at
// /api/cron/reminders). For each salon with reminders on, during its
// sending hours: each visit due one (./reminders.ts), by the channel the
// client allows for messages about their visits, in fixed words with a link
// to change or cancel it when the salon books online. Each is recorded once
// per visit and start time (appointment_reminders; a moved visit gets one
// for its new time), then put in the outbox, which holds it until the salon
// goes live with texts and email.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { canSendAt } from "@/lib/automations";
import { siteUrl } from "@/lib/branding";
import { appointmentChannel } from "@/lib/messaging/send";
import { withStopLine } from "@/lib/messaging/templates";
import { newSecret, sha256 } from "@/lib/online-booking/security";
import { todayIn, toLocal } from "@/lib/scheduling/time";
import { LAST_CALL_MINUTES, reminderDue, reminderMessage, reminderWhen, stylistsText } from "./reminders";

type Admin = SupabaseClient<Database>;

export type ReminderSummary = { salons: number; sent: number; noChannel: number; quietHours: number };

export async function runReminders(admin: Admin, options: { businessId?: string; now?: Date } = {}): Promise<ReminderSummary> {
  const now = options.now ?? new Date();
  const summary: ReminderSummary = { salons: 0, sent: 0, noChannel: 0, quietHours: 0 };
  let query = admin.from("businesses").select("id, name, slug, reminder_hours, online_booking_settings(enabled), locations(id, timezone, phone)").eq("reminders_on", true);
  if (options.businessId) query = query.eq("id", options.businessId);
  const { data: salons, error } = await query;
  if (error) throw error;

  for (const salon of salons) {
    summary.salons++;
    const online = Boolean(salon.online_booking_settings?.enabled && salon.slug);
    for (const location of salon.locations) {
      if (!canSendAt(toLocal(now, location.timezone).minute)) {
        summary.quietHours++;
        continue;
      }
      const { data: visits, error: visitError } = await admin
        .from("appointments")
        .select("id, client_id, status, starts_at, created_at, client:clients(first_name), appointment_items(starts_at, staff:staff(first_name))")
        .eq("location_id", location.id)
        .in("status", ["booked", "confirmed"])
        .not("client_id", "is", null)
        .gte("starts_at", new Date(now.getTime() + LAST_CALL_MINUTES * 60_000).toISOString())
        .lte("starts_at", new Date(now.getTime() + salon.reminder_hours * 3_600_000).toISOString());
      if (visitError) throw visitError;
      if (!visits.length) continue;
      const { data: done, error: doneError } = await admin
        .from("appointment_reminders")
        .select("appointment_id, starts_at")
        .in(
          "appointment_id",
          visits.map((v) => v.id),
        );
      if (doneError) throw doneError;
      const sent = new Set(done.map((d) => `${d.appointment_id}|${Date.parse(d.starts_at)}`));

      for (const v of visits) {
        const startsAt = new Date(v.starts_at);
        if (sent.has(`${v.id}|${startsAt.getTime()}`)) continue;
        if (!reminderDue({ status: v.status, startsAt, createdAt: new Date(v.created_at) }, salon.reminder_hours, now)) continue;
        const to = await appointmentChannel(admin, v.client_id!);
        if (!to) {
          summary.noChannel++;
          continue;
        }
        // Claimed first, so two runs never send it twice.
        const { data: claimed, error: claimError } = await admin
          .from("appointment_reminders")
          .upsert({ business_id: salon.id, appointment_id: v.id, starts_at: v.starts_at, channel: to.channel }, { onConflict: "appointment_id,starts_at", ignoreDuplicates: true })
          .select("id");
        if (claimError) throw claimError;
        if (!claimed.length) continue;

        let manageUrl: string | null = null;
        if (online) {
          const token = newSecret();
          const { error: linkError } = await admin.rpc("add_manage_link", { p_appointment_id: v.id, p_client_id: v.client_id!, p_business_id: salon.id, p_token_hash: sha256(token) });
          if (linkError) throw linkError;
          manageUrl = `${siteUrl()}/book/${salon.slug}/manage/${token}`;
        }
        const local = toLocal(startsAt, location.timezone);
        const first = [...v.appointment_items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        const message = reminderMessage({
          salon: salon.name,
          firstName: v.client?.first_name ?? "",
          when: reminderWhen(local.date, local.minute, todayIn(location.timezone, now)),
          stylists: stylistsText(first.map((i) => i.staff?.first_name ?? "")),
          manageUrl,
          phone: location.phone,
        });
        const { data: outbox, error: outboxError } = await admin
          .from("outbox_messages")
          .insert({
            business_id: salon.id,
            channel: to.channel,
            to_address: to.to,
            subject: to.channel === "email" ? message.subject : null,
            body: to.channel === "sms" ? withStopLine(message.body) : message.body,
          })
          .select("id, status")
          .single();
        if (outboxError) throw outboxError;
        await admin.from("appointment_reminders").update({ outbox_id: outbox.id, held: outbox.status === "held" }).eq("id", claimed[0].id);
        summary.sent++;
      }
    }
  }
  return summary;
}
