import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingFrame } from "@/app/book/[slug]/frame";
import { salonLogoUrl } from "@/lib/branding";
import { DEFAULT_ACCENT } from "@/lib/online-booking/settings";
import { currentProvider } from "@/lib/payments";
import { loadCardLink } from "@/lib/policy-link";
import { formatLongDay } from "@/lib/schedule-format";
import { formatMinute } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { CardForm } from "./card-form";

export const metadata: Metadata = { title: { absolute: "Add your card" }, robots: { index: false } };

export default function CardPage({ params }: PageProps<"/card/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Card params={params} />
    </Suspense>
  );
}

// The client's secure page from a card link: the salon's brand, their
// visit, the cancellation policy in plain language, a deposit if one is
// needed, and their card. Public, with the service role, by the link's
// token (only its hash is stored).
async function Card({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const link = await loadCardLink(createAdminClient(), token);
  if (!link) notFound();
  const provider = currentProvider();
  return (
    <BookingFrame name={link.salon.name} logoUrl={salonLogoUrl(link.salon.logoPath)} accent={link.salon.accent ?? DEFAULT_ACCENT}>
      {link.status === "done" ? (
        <div className="flex flex-col gap-2" data-testid="card-saved">
          <h1 className="font-serif text-3xl font-semibold text-ink">Your card is saved</h1>
          <p className="text-ink-muted">Thank you. {link.salon.name} has what it needs for your booking.</p>
        </div>
      ) : link.status === "canceled" || link.expired ? (
        <div className="flex flex-col gap-2" data-testid="link-closed">
          <h1 className="font-serif text-3xl font-semibold text-ink">{link.expired ? "This link has expired" : "This link is no longer active"}</h1>
          <p className="text-ink-muted">Ask {link.salon.name} for a new one.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-serif text-3xl font-semibold text-ink">Hi {link.clientFirstName}</h1>
            <p className="text-ink-muted">
              {link.depositCents > 0 ? `${link.salon.name} asks for a deposit and a card to hold your booking.` : `${link.salon.name} asks for a card to hold your booking.`}
            </p>
          </div>
          {link.visit && (
            <div className="rounded-xl border border-line bg-surface px-4 py-4">
              <p className="font-serif text-xl font-semibold text-ink">{formatLongDay(link.visit.date, false)}</p>
              <p className="text-ink-muted">
                {formatMinute(link.visit.minute)} · {link.visit.services.join(", ")}
              </p>
            </div>
          )}
          <CardForm
            token={token}
            lines={link.lines}
            depositCents={link.depositCents}
            testMode={provider.testMode}
            cards={provider.testCards.map((c) => ({ ref: c.ref, label: c.label, outcome: c.outcome }))}
          />
        </div>
      )}
      <p className="mt-8 text-center text-xs text-ink-subtle">Card details go to the payment provider; {link.salon.name} never sees or stores them.</p>
    </BookingFrame>
  );
}
