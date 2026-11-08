import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingFrame } from "@/app/book/[slug]/frame";
import { pageLead, pageTitle } from "@/app/book/[slug]/styles";
import { salonLogoUrl } from "@/lib/branding";
import { loadAuthorizationLink } from "@/lib/card-authorizations";
import { DEFAULT_ACCENT } from "@/lib/online-booking/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthorizeForm } from "./authorize-form";

export const metadata: Metadata = { title: { absolute: "Use your card" }, robots: { index: false } };

export default function AuthorizePage({ params }: PageProps<"/authorize/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Authorize params={params} />
    </Suspense>
  );
}

// The card owner's page from their link: the salon's brand, whose visits
// and which card, the policy as it applies to those visits, and Approve
// or Decline. Public, with the service role, by the link's token (only
// its hash is stored).
async function Authorize({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const link = await loadAuthorizationLink(createAdminClient(), token);
  if (!link) notFound();
  const closed = link.status !== "open" || link.expired || link.cardGone;
  return (
    <BookingFrame name={link.salon.name} logoUrl={salonLogoUrl(link.salon.logoPath)} accent={link.salon.accent ?? DEFAULT_ACCENT}>
      {link.status === "approved" ? (
        <div data-testid="authorize-done">
          <h1 className={pageTitle}>Thank you</h1>
          <p className={pageLead}>{`${link.clientFirstName}'s bookings use your card on file. Ask ${link.salon.name} any time to stop.`}</p>
        </div>
      ) : link.status === "declined" ? (
        <div data-testid="authorize-done">
          <h1 className={pageTitle}>Declined</h1>
          <p className={pageLead}>{`Your card won't be used for ${link.clientFirstName}'s visits.`}</p>
        </div>
      ) : closed ? (
        <div data-testid="link-closed">
          <h1 className={pageTitle}>{link.expired ? "This link has expired" : "This link is no longer active"}</h1>
          <p className={pageLead}>Ask {link.salon.name} for a new one.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <h1 className={pageTitle}>Hi {link.payerFirstName}</h1>
            <p className={pageLead}>{`${link.salon.name} asks whether ${link.clientFirstName}'s bookings can be held by your card on file.`}</p>
          </div>
          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <p className="text-base font-semibold text-ink" data-testid="authorize-card">
              {link.cardLabel}
            </p>
            <p className="text-sm text-ink-muted">{`For ${link.clientFirstName}'s visits`}</p>
          </div>
          <AuthorizeForm token={token} clientFirstName={link.clientFirstName} lines={link.policyLines} />
        </div>
      )}
      <p className="mt-8 text-center text-xs text-ink-subtle">Card details stay with the payment provider; {link.salon.name} never sees or stores them.</p>
    </BookingFrame>
  );
}
