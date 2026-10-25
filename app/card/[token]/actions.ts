"use server";

import { loadCardLink } from "@/lib/policy-link";
import { requestInfo } from "@/lib/online-booking/security";
import { currentProvider } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";

export type CardLinkResult = { ok: true; label: string; depositCents: number } | { ok: false; message: string };

// The client agreed to the policy and chose a card: it's saved with the
// provider, any deposit charged, then recorded with what they agreed to
// (complete_card_request). If that can't be recorded, the deposit is given
// back. Public, with the service role.
export async function completeCardLink(token: string, cardRef: string, agreed: boolean): Promise<CardLinkResult> {
  if (!agreed) return { ok: false, message: "Please read and agree to the cancellation policy." };
  const admin = createAdminClient();
  const link = await loadCardLink(admin, token);
  if (!link) return { ok: false, message: "This link doesn't work." };
  if (link.status === "done") return { ok: false, message: "Your card is already saved. Thank you!" };
  if (link.status !== "open" || link.expired) return { ok: false, message: `This link is no longer active. Ask ${link.salon.name} for a new one.` };

  const provider = currentProvider();
  const saved = await provider.saveCard(cardRef);
  if (!saved.ok) return { ok: false, message: `${saved.reason}.` };
  let deposit: { amount_cents: number; provider: string; reference: string } | null = null;
  if (link.depositCents > 0) {
    const charged = await provider.charge({ amountCents: link.depositCents, paymentMethodRef: saved.card.ref, description: "Deposit", idempotencyKey: `cardlink:${link.id}:${saved.card.ref}` });
    if (!charged.ok) return { ok: false, message: `${charged.reason}. You haven't been charged; try another card.` };
    deposit = { amount_cents: link.depositCents, provider: provider.id, reference: charged.reference };
  }
  const { ipHash } = await requestInfo();
  const { error } = await admin.rpc("complete_card_request", {
    p_request_id: link.id,
    p_card: { provider: provider.id, ref: saved.card.ref, label: saved.card.label },
    p_consent: { policy_text: link.lines.join("\n"), terms: { ...link.terms, deposit_cents: link.depositCents }, ip_hash: ipHash },
    p_deposit: deposit as never,
  });
  if (error) {
    // Done at the same moment in another tab with the same card: that's
    // the deposit on record, so it stays.
    const { data: recorded } = deposit ? await admin.from("appointments").select("id").eq("deposit_reference", deposit.reference).maybeSingle() : { data: null };
    if (deposit && !recorded) await provider.refund(deposit.reference);
    if (error.hint === "used") return { ok: false, message: "Your card is already saved. Thank you!" };
    if (error.hint === "expired") return { ok: false, message: `This link has expired. Ask ${link.salon.name} for a new one.` };
    return { ok: false, message: `We couldn't save your card, and you haven't been charged. Please let ${link.salon.name} know.` };
  }
  return { ok: true, label: saved.card.label, depositCents: link.depositCents };
}
