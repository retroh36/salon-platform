import type { SupabaseClient } from "@supabase/supabase-js";
import { FeeControls } from "@/components/policy-controls";
import { ShieldIcon, WalletIcon } from "@/components/ui/icons";
import type { Database } from "@/lib/database.types";
import { FEE_KIND_LABELS, graceMessageDue, type FeeStatus } from "@/lib/policy";
import { clientStanding, loadPolicy } from "@/lib/policy-load";
import { FEE_GRACE_COLUMNS, graceOf } from "@/lib/policy-visits";
import { formatDay } from "@/lib/schedule-format";
import { toLocal } from "@/lib/scheduling/time";
import { CardLinkForm } from "./card-link-form";
import { EndAuthorizationButton, FamilyCardAsk, type FamilyPayer } from "./family-card-ask";
import { RemoveCardButton } from "./remove-card";
import { CardFold, Row, SideCard } from "./side-card";

// The client and the cancellation policy (front of house), as two cards:
// the card on file (when they agreed to the policy, Remove card; or Send
// card link in the corner), then the policy (their late cancellations and
// no-shows, what they agreed to, and each fee: waive, try again).
export async function PolicyCards({ supabase, businessId, role, client, tz }: { supabase: SupabaseClient<Database>; businessId: string; role: string; client: { id: string; first_name: string; phone: string | null; email: string | null; family_id: string | null }; tz: string }) {
  const [policy, standing, card, fees, link, asked, payers] = await Promise.all([
    loadPolicy(supabase, businessId),
    clientStanding(supabase, client.id),
    supabase.from("client_cards").select("label, created_at, consent:policy_consents(policy_text, agreed_at, channel), authorization:card_authorizations!client_cards_authorization_id_fkey(id, signed_name, answered_at)").eq("client_id", client.id).is("removed_at", null).maybeSingle(),
    supabase.from("policy_fees").select(`id, kind, fee_cents, from_deposit_cents, status, card_label, failure_reason, waive_reason, created_at, appointment:appointments(starts_at), ${FEE_GRACE_COLUMNS}`).eq("client_id", client.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("card_requests").select("id").eq("client_id", client.id).eq("status", "open").gt("expires_at", new Date().toISOString()).limit(1),
    // A family member asked to approve their card for this client.
    supabase
      .from("card_authorizations")
      .select("id, payer:clients!card_authorizations_payer_client_id_business_id_fkey(first_name)")
      .eq("client_id", client.id)
      .eq("status", "open")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
    familyPayers(supabase, client),
  ]);
  if (fees.error) throw fees.error;
  const day = (iso: string) => formatDay(toLocal(new Date(iso), tz).date, true);
  const strikes =
    standing.strikes > 0
      ? `${standing.strikes} late cancellation${standing.strikes === 1 ? "" : "s"} or no-show${standing.strikes === 1 ? "" : "s"} in the last ${standing.months} months${standing.action === "deposit" ? ": they pay a deposit to book." : standing.action === "prepay" ? ": they pay for the visit up front." : "."}`
      : null;
  if (!card.data && !fees.data.length && !strikes && !payers.length && policy.settings.cardRequired === "off") return null;
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
              {card.data.authorization ? (
                <Row label="Approved by" testId="card-authorized-by">
                  {card.data.authorization.signed_name} · {day(card.data.authorization.answered_at!)}
                </Row>
              ) : (
                <Row label="Agreed">
                  {card.data.consent.channel === "online" ? "Online" : "By link"} · {day(card.data.consent.agreed_at)}
                </Row>
              )}
            </dl>
            <div className="-ml-3">
              {card.data.authorization ? (
                <EndAuthorizationButton id={card.data.authorization.id} clientId={client.id} label="Stop using this card" />
              ) : (
                <RemoveCardButton clientId={client.id} label={card.data.label} />
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-ink-muted" data-testid="no-card">
              No card on file.{sent ? " A card link is out." : ""}
            </p>
            {asked.data ? (
              <div className="flex flex-col gap-1" data-testid="authorization-waiting">
                <p className="text-13 text-ink-muted">{`Waiting for ${asked.data.payer.first_name} to approve their card.`}</p>
                <EndAuthorizationButton id={asked.data.id} clientId={client.id} label="Cancel the request" />
              </div>
            ) : (
              payers.length > 0 && <FamilyCardAsk clientId={client.id} clientFirstName={client.first_name} payers={payers} />
            )}
          </>
        )}
      </SideCard>

      <SideCard title="Cancellation policy" icon={<ShieldIcon />} testId="client-policy">
        <p className={strikes ? "text-ink" : "text-ink-muted"} data-testid="policy-standing">
          {strikes ?? "Late cancellation and no-show fees are charged to the card on file."}
        </p>
        {card.data && (
          <CardFold label={`What ${client.first_name} agreed to`} className="text-13 text-ink-muted">
            <div className="mt-2 flex flex-col gap-1 border-l-2 border-line pl-3">
              {card.data.consent.policy_text.split("\n").map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </CardFold>
        )}
        {fees.data.length > 0 && (
          <ul className="flex flex-col divide-y divide-line border-t border-line" aria-label="Fees">
            {fees.data.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 pt-3 not-last:pb-3">
                <p className="text-sm font-medium text-ink">
                  {FEE_KIND_LABELS[f.kind as "late_cancel" | "no_show"]} · visit on {day(f.appointment.starts_at)}
                </p>
                <FeeControls
                  fee={{ id: f.id, kind: f.kind as "late_cancel" | "no_show", feeCents: f.fee_cents, fromDepositCents: f.from_deposit_cents, status: f.status as FeeStatus, cardLabel: f.card_label, failureReason: f.failure_reason, waiveReason: f.waive_reason, grace: graceOf(f), graceUnsent: graceMessageDue(f) }}
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

// Family members with a card of their own on file (not one from another
// authorization), the one who usually pays first.
async function familyPayers(supabase: SupabaseClient<Database>, client: { id: string; family_id: string | null }): Promise<FamilyPayer[]> {
  if (!client.family_id) return [];
  const [{ data: family }, { data: members, error }] = await Promise.all([
    supabase.from("families").select("payer_client_id").eq("id", client.family_id).maybeSingle(),
    supabase
      .from("clients")
      .select("id, first_name, phone, email, client_cards!client_cards_client_id_business_id_fkey(label, removed_at, authorization_id)")
      .eq("family_id", client.family_id)
      .neq("id", client.id),
  ]);
  if (error) throw error;
  return (members ?? [])
    .flatMap((m) => {
      const own = m.client_cards.find((c) => c.removed_at === null && c.authorization_id === null);
      return own ? [{ id: m.id, firstName: m.first_name, cardLabel: own.label, phone: m.phone, email: m.email }] : [];
    })
    .sort((a, b) => Number(b.id === family?.payer_client_id) - Number(a.id === family?.payer_client_id));
}
