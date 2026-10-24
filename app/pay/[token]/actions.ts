"use server";

import { createHash } from "node:crypto";
import { after } from "next/server";
import { recomputeForVisit } from "@/lib/insights/compute";
import { linkTotal, parseTips, type LinkSnapshot } from "@/lib/payment-links";
import { currentProvider } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";

export type PayResult = { ok: true; totalCents: number; tipCents: number } | { ok: false; message: string };

// The client pays: the link must still be open and in date; their tips are
// checked; the card is charged through the payment provider; then the sale
// completes (complete_payment_link). If the sale can't be completed, the
// charge is given back. Public, with the service role.
export async function payLink(token: string, tips: Record<string, number>, cardRef: string): Promise<PayResult> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, message: "This link doesn't work." };
  const admin = createAdminClient();
  const { data: link } = await admin.from("payment_links").select("id, status, expires_at, snapshot").eq("token_hash", createHash("sha256").update(token).digest("hex")).maybeSingle();
  if (!link) return { ok: false, message: "This link doesn't work." };
  if (link.status !== "open") return { ok: false, message: link.status === "paid" ? "This has already been paid. Thank you!" : "This link is no longer active. Ask the salon for a new one." };
  if (Date.parse(link.expires_at) <= Date.now()) return { ok: false, message: "This link has expired. Ask the salon for a new one." };
  const snapshot = link.snapshot as unknown as LinkSnapshot;
  const chosen = parseTips(tips, snapshot);
  if (!chosen) return { ok: false, message: "Check the tip amounts." };
  const total = linkTotal(snapshot, chosen);
  const provider = currentProvider();
  if (provider.testMode && !provider.testCards.some((c) => c.ref === cardRef)) return { ok: false, message: "Choose a card." };

  const charge = await provider.charge({ amountCents: total, paymentMethodRef: cardRef, description: "Salon visit", idempotencyKey: `link:${link.id}:${total}:${cardRef}` });
  if (!charge.ok) return { ok: false, message: `${charge.reason}. You haven't been charged; try another card.` };
  const { error } = await admin.rpc("complete_payment_link", { p_link_id: link.id, p_tips: chosen as never, p_total_cents: total, p_provider: provider.id, p_reference: charge.reference });
  if (error) {
    await provider.refund(charge.reference);
    if (error.hint === "used") return { ok: false, message: "This has already been paid. Thank you!" };
    if (error.hint === "expired") return { ok: false, message: "This link has expired. Ask the salon for a new one." };
    return { ok: false, message: "We couldn't take this payment, and you haven't been charged. Please let the salon know." };
  }
  // What Denise learns from the visit, as after any checkout.
  const appointmentId = snapshot.input.appointment_id;
  if (appointmentId) after(() => recomputeForVisit(createAdminClient(), appointmentId));
  return { ok: true, totalCents: total, tipCents: chosen.reduce((n, t) => n + t.amount_cents, 0) };
}
