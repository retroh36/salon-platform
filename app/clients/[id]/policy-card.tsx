import type { SupabaseClient } from "@supabase/supabase-js";
import { FeeControls } from "@/components/policy-controls";
import { ShieldIcon, WalletIcon } from "@/components/ui/icons";
import type { Database } from "@/lib/database.types";
import { FEE_KIND_LABELS, type FeeStatus } from "@/lib/policy";
import { clientStanding, loadPolicy } from "@/lib/policy-load";
import { formatDay } from "@/lib/schedule-format";
import { toLocal } from "@/lib/scheduling/time";
import { CardLinkForm } from "./card-link-form";
import { RemoveCardButton } from "./remove-card";
import { Row, SideCard } from "./side-card";

// The client and the cancellation policy (front of house), as two cards:
// the card on file (when they agreed to the policy, Remove card; or Send
// card link in the corner), then the policy (their late cancellations and
// no-shows, what they agreed to, and each fee: waive, try again).
export async function PolicyCards({ supabase, businessId, role, client, tz }: { supabase: SupabaseClient<Database>; businessId: string; role: string; client: { id: string; first_name: string; phone: string | null; email: string | null }; tz: string }) {
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
  const sent = (link.data?.length ?? 0) > 0;
  return (
    <>
      <SideCard
        title="Card on file"
        icon={<WalletIcon />}
        testId="client-card"
        opens={card.data ? undefined : { label: sent ? "Send again" : "Send card link", form: <CardLinkForm clientId={client.id} phone={client.phone} email={client.email} sent={sent} /> }}
      >
        {card.data ? (
          <>
            <dl className="flex flex-col gap-2.5">
              <Row label="Card">
                <span className="font-medium" data-testid="card-on-file">
                  {card.data.label}
                </span>
              </Row>
              <Row label="Agreed to the policy">
                {card.data.consent.channel === "online" ? "Online" : "By link"}, {day(card.data.consent.agreed_at)}
              </Row>
            </dl>
            <div className="-ml-3">
              <RemoveCardButton clientId={client.id} label={card.data.label} />
            </div>
          </>
        ) : (
          <p className="text-ink-muted" data-testid="no-card">
            No card on file.{sent ? " A card link is out." : ""}
          </p>
        )}
      </SideCard>

      <SideCard title="Cancellation policy" icon={<ShieldIcon />} testId="client-policy">
        <p className={strikes ? "text-ink" : "text-ink-muted"} data-testid="policy-standing">
          {strikes ?? "Late cancellation and no-show fees are charged to the card on file."}
        </p>
        {card.data && (
          <details className="text-13 text-ink-muted">
            <summary className="cursor-pointer hover:text-ink">What {client.first_name} agreed to</summary>
            <div className="mt-2 flex flex-col gap-1 border-l-2 border-line pl-3">
              {card.data.consent.policy_text.split("\n").map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </details>
        )}
        {fees.data.length > 0 && (
          <ul className="flex flex-col divide-y divide-line border-t border-line" aria-label="Fees">
            {fees.data.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 pt-3 not-last:pb-3">
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
      </SideCard>
    </>
  );
}
