import type { SupabaseClient } from "@supabase/supabase-js";
import { CardLinkButton, FeeControls } from "@/components/policy-controls";
import { Section } from "@/components/ui/page";
import type { Database } from "@/lib/database.types";
import { FEE_KIND_LABELS, type FeeStatus } from "@/lib/policy";
import { clientStanding, loadPolicy } from "@/lib/policy-load";
import { formatDay } from "@/lib/schedule-format";
import { toLocal } from "@/lib/scheduling/time";
import { RemoveCardButton } from "./remove-card";

// The client and the cancellation policy (front of house): the card on
// file and exactly what they agreed to, a link to add one, their late
// cancellations and no-shows with each fee (waive, try again).
export async function PolicyCard({ supabase, businessId, role, client, tz }: { supabase: SupabaseClient<Database>; businessId: string; role: string; client: { id: string; first_name: string; phone: string | null; email: string | null }; tz: string }) {
  const [policy, standing, card, fees, link] = await Promise.all([
    loadPolicy(supabase, businessId),
    clientStanding(supabase, client.id),
    supabase.from("client_cards").select("label, created_at, consent:policy_consents(policy_text, agreed_at, channel)").eq("client_id", client.id).is("removed_at", null).maybeSingle(),
    supabase.from("policy_fees").select("id, kind, fee_cents, from_deposit_cents, status, card_label, failure_reason, waive_reason, created_at, appointment:appointments(starts_at)").eq("client_id", client.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("card_requests").select("id").eq("client_id", client.id).eq("status", "open").gt("expires_at", new Date().toISOString()).limit(1),
  ]);
  if (fees.error) throw fees.error;
  const day = (iso: string) => formatDay(toLocal(new Date(iso), tz).date, true);
  const strikes =
    standing.strikes > 0
      ? `${standing.strikes} late cancellation${standing.strikes === 1 ? "" : "s"} or no-show${standing.strikes === 1 ? "" : "s"} in the last ${standing.months} months${standing.action === "deposit" ? ": they pay a deposit to book." : standing.action === "prepay" ? ": they pay for the visit up front." : "."}`
      : null;
  if (!card.data && !fees.data.length && !strikes && policy.settings.cardRequired === "off") return null;
  return (
    <Section title="Cancellation policy" titleId="policy-heading" description={strikes ?? "Late cancellation and no-show fees are charged to the card on file."}>
      <div className="divide-y divide-line border-y border-line" data-testid="client-policy">
        {card.data ? (
          <div className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium text-ink" data-testid="card-on-file">
                {card.data.label} on file
              </p>
              <details className="mt-0.5 text-13 text-ink-muted">
                <summary className="cursor-pointer hover:text-ink">
                  Agreed to the policy {card.data.consent.channel === "online" ? "online" : "by link"} on {day(card.data.consent.agreed_at)}
                </summary>
                <div className="mt-2 flex max-w-2xl flex-col gap-1 border-l-2 border-line pl-3">
                  {card.data.consent.policy_text.split("\n").map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </details>
            </div>
            <RemoveCardButton clientId={client.id} label={card.data.label} />
          </div>
        ) : (
          <div className="flex flex-col gap-2 py-3">
            <p className="text-ink-muted">No card on file.</p>
            <CardLinkButton clientId={client.id} appointmentId={null} phone={client.phone} email={client.email} depositCents={0} sent={(link.data?.length ?? 0) > 0} />
          </div>
        )}
        {fees.data.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {fees.data.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 py-3">
                <p className="text-sm font-medium text-ink">
                  {FEE_KIND_LABELS[f.kind as "late_cancel" | "no_show"]} · visit on {day(f.appointment.starts_at)}
                </p>
                <FeeControls
                  fee={{ id: f.id, kind: f.kind as "late_cancel" | "no_show", feeCents: f.fee_cents, fromDepositCents: f.from_deposit_cents, status: f.status as FeeStatus, cardLabel: f.card_label, failureReason: f.failure_reason, waiveReason: f.waive_reason }}
                  canWaive={policy.waiveRoles.includes(role)}
                  canRetry
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
