import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge, Section } from "@/components/ui/page";
import type { Database } from "@/lib/database.types";
import { consentEventText, consentOf, noTextsFlag, type Channel, type Purpose, type SOURCE_LABELS } from "@/lib/messaging/consent";
import { CONSENT_COLUMNS } from "@/lib/messaging/send";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { templateLabel } from "@/lib/messaging/templates";
import { VisitMessageSwitches } from "./visit-message-switches";

// Messages (front of house): whether texts and emails about visits reach
// the client (a STOP shows here, and only the client texting START undoes
// it), offers (from Details), every consent and opt-out with when and
// where it came from, and the messages staff sent, with who sent them.
export async function MessagesCard({ supabase, clientId, firstName, tz }: { supabase: SupabaseClient<Database>; clientId: string; firstName: string; tz: string }) {
  const [{ data: c, error }, { data: events }, { data: sent }] = await Promise.all([
    supabase.from("clients").select(CONSENT_COLUMNS).eq("id", clientId).single(),
    supabase.from("client_consent_events").select("id, purpose, channel, granted, source, detail, created_at, staff:staff(first_name)").eq("client_id", clientId).order("created_at", { ascending: false }).limit(20),
    supabase.from("client_messages").select("id, purpose, template, channel, body, created_at, sender:staff!client_messages_sent_by_fkey(first_name)").eq("client_id", clientId).order("created_at", { ascending: false }).limit(10),
  ]);
  if (error) throw error;
  const consent = consentOf(c);
  const flag = noTextsFlag(consent);
  const when = (iso: string) => {
    const l = toLocal(new Date(iso), tz);
    return `${formatDay(l.date, true)}, ${formatMinute(l.minute)}`;
  };
  const offers = [consent.smsOptIn && !consent.smsStoppedAt && "texts", consent.emailOptIn && "emails"].filter(Boolean).join(" and ");
  return (
    <Section title="Messages" titleId="messages-heading" description="Messages about visits are separate from offers: turning off offers never stops reminders.">
      <div className="divide-y divide-line border-y border-line" data-testid="client-messages">
        {flag && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-3" data-testid="no-texts">
            <Badge tone="warning">{flag}</Badge>
            {consent.smsStoppedAt && (
              <span className="text-13 text-ink-muted">
                Replied STOP on {formatDay(toLocal(new Date(consent.smsStoppedAt), tz).date, true)}. Texts start again only if {firstName} texts START.
              </span>
            )}
          </div>
        )}
        <div className="py-3">
          <VisitMessageSwitches
            clientId={clientId}
            sms={{ on: consent.appointmentSmsOk, possible: Boolean(consent.phone) && !consent.smsStoppedAt }}
            email={{ on: consent.appointmentEmailOk, possible: Boolean(consent.email) }}
          />
        </div>
        <p className="py-3 text-sm text-ink-muted">Offers: {offers ? `yes to ${offers}` : "no"} (change it in Edit details).</p>
        {Boolean(events?.length) && (
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">Consent history</summary>
            <ul className="mt-2 flex flex-col gap-1.5 text-13" data-testid="consent-history">
              {events!.map((e) => (
                <li key={e.id}>
                  <span className="text-ink">{consentEventText({ purpose: e.purpose as Purpose, channel: e.channel as Channel, granted: e.granted, source: e.source as keyof typeof SOURCE_LABELS, detail: e.detail })}</span>
                  <span className="text-ink-subtle">
                    {" "}
                    · {when(e.created_at)}
                    {e.staff ? ` · ${e.staff.first_name}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {Boolean(sent?.length) && (
          <div className="py-3">
            <p className="text-sm font-medium text-ink">Sent by staff</p>
            <ul className="mt-2 flex flex-col gap-3 text-13" data-testid="sent-messages">
              {sent!.map((m) => (
                <li key={m.id}>
                  <p className="text-ink-subtle">
                    {m.template === "custom" ? (m.purpose === "marketing" ? "Offer" : "Written") : templateLabel(m.template)} by{" "}
                    {m.channel === "sms" ? "text" : "email"} · {when(m.created_at)} · {m.sender?.first_name ?? "Former staff"}
                  </p>
                  <p className="mt-0.5 line-clamp-3 text-ink whitespace-pre-line">{m.body}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
