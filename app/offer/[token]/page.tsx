import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingFrame } from "@/app/book/[slug]/frame";
import { pageLead, pageTitle } from "@/app/book/[slug]/styles";
import { salonLogoUrl } from "@/lib/branding";
import { offerTerms } from "@/lib/offer-terms";
import { DEFAULT_ACCENT } from "@/lib/online-booking/settings";
import { salonProvider } from "@/lib/payments";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOffer, offerWhen } from "@/lib/waitlist-offers";
import { OfferButtons, type OfferPay } from "./buttons";

export const metadata: Metadata = { title: { absolute: "A spot opened up" }, robots: { index: false } };

export default function OfferPage({ params }: PageProps<"/offer/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Offer params={params} />
    </Suspense>
  );
}

// The client's page from a waitlist offer: the time, and Take it or No
// thanks; when the cancellation policy needs a card (or a deposit) for it,
// the policy to agree to and the card come first, as online. Public, with the service role, by the link's token (only its
// hash is stored).
async function Offer({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const admin = createAdminClient();
  const offer = await loadOffer(admin, token);
  if (!offer) notFound();
  const tz = offer.location.timezone;
  const open = offer.status === "open" && !offer.expired;
  const terms = open ? await offerTerms(admin, offer) : null;
  const pay: OfferPay | null = terms?.cardNeeded
    ? {
        lines: terms.lines,
        depositCents: terms.depositCents,
        cardOnFile: terms.cardOnFile?.label ?? null,
        cardForm: terms.cardOnFile ? { kind: "unavailable", reason: "Card on file" } : await (await salonProvider(admin, offer.businessId)).cardForm(),
      }
    : null;
  return (
    <BookingFrame name={offer.salon.name} logoUrl={salonLogoUrl(offer.salon.logoPath)} accent={offer.salon.accent ?? DEFAULT_ACCENT}>
      {offer.status === "taken" ? (
        <div data-testid="offer-taken">
          <h1 className={pageTitle}>You&rsquo;re booked, {offer.clientFirstName}</h1>
          <p className={pageLead}>
            {offerWhen(offer.startsAt, tz)} with {offer.stylist}. See you then.
          </p>
        </div>
      ) : !open ? (
        <div data-testid="offer-closed">
          <h1 className={pageTitle}>{offer.status === "declined" ? "Thanks for letting us know" : "This offer is no longer open"}</h1>
          <p className={pageLead}>
            {offer.status === "declined" ? `You're still on ${offer.salon.name}'s waitlist.` : `Call ${offer.salon.name} if you'd still like a time.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <h1 className={pageTitle}>Hi {offer.clientFirstName}, a spot opened up</h1>
            <p className={pageLead}>
              It&rsquo;s yours if you take it by {formatMinute(toLocal(new Date(offer.expiresAt), tz).minute)}. If someone else books it first, you stay on the waitlist.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <p className="text-base font-semibold text-ink">{offerWhen(offer.startsAt, tz)}</p>
            <p className="text-sm text-ink-muted">
              {offer.services.join(", ")} with {offer.stylist}
            </p>
          </div>
          <OfferButtons token={token} salon={offer.salon.name} pay={pay} />
        </div>
      )}
    </BookingFrame>
  );
}
