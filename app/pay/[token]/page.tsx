import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingFrame } from "@/app/book/[slug]/frame";
import { salonLogoUrl } from "@/lib/branding";
import { DEFAULT_ACCENT } from "@/lib/online-booking/settings";
import type { LinkSnapshot } from "@/lib/payment-links";
import { currentProvider } from "@/lib/payments";
import { formatPrice } from "@/lib/services";
import { createAdminClient } from "@/lib/supabase/admin";
import { PayForm } from "./pay-form";

export const metadata: Metadata = { title: { absolute: "Pay" }, robots: { index: false } };

const hasPassed = (iso: string) => Date.parse(iso) <= Date.now();

export default function PayPage({ params }: PageProps<"/pay/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Pay params={params} />
    </Suspense>
  );
}

// The client's payment page from a text: the salon's brand, the receipt,
// a tip for each stylist, and pay. Public, with the service role, by the
// link's token (only its hash is stored).
async function Pay({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const { data: link } = await createAdminClient()
    .from("payment_links")
    .select("status, expires_at, snapshot, amount_cents, tip_cents, business:businesses(name, logo_path, online_booking_settings(accent_color))")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  if (!link) notFound();
  const snapshot = link.snapshot as unknown as LinkSnapshot;
  const salon = link.business.name;
  const expired = link.status === "open" && hasPassed(link.expires_at);
  const provider = currentProvider();
  return (
    <BookingFrame name={salon} logoUrl={salonLogoUrl(link.business.logo_path)} accent={link.business.online_booking_settings?.accent_color ?? DEFAULT_ACCENT}>
      {link.status === "paid" ? (
        <Done salon={salon} totalCents={link.amount_cents + (link.tip_cents ?? 0)} tipCents={link.tip_cents ?? 0} />
      ) : link.status === "canceled" || expired ? (
        <div className="flex flex-col gap-2" data-testid="link-closed">
          <h1 className="font-serif text-3xl font-semibold text-ink">{expired ? "This link has expired" : "This link is no longer active"}</h1>
          <p className="text-ink-muted">Ask {salon} for a new one, or pay at the desk.</p>
        </div>
      ) : (
        <PayForm
          token={token}
          salon={salon}
          snapshot={snapshot}
          testMode={provider.testMode}
          cards={provider.testCards.map((c) => ({ ref: c.ref, label: c.label, outcome: c.outcome }))}
        />
      )}
      <p className="mt-8 text-center text-xs text-ink-subtle">Card details go to the payment provider; {salon} never sees or stores them.</p>
    </BookingFrame>
  );
}

function Done({ salon, totalCents, tipCents }: { salon: string; totalCents: number; tipCents: number }) {
  return (
    <div className="flex flex-col gap-2" data-testid="link-paid">
      <h1 className="font-serif text-3xl font-semibold text-ink">Paid. Thank you.</h1>
      <p className="text-lg tabular-nums">
        {formatPrice(totalCents)}
        {tipCents > 0 ? `, including ${formatPrice(tipCents)} in tips` : ""}
      </p>
      <p className="text-ink-muted">{salon} has your payment. See you next time.</p>
    </div>
  );
}
