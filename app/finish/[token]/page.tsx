import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingFrame } from "@/app/book/[slug]/frame";
import { pageLead, pageTitle } from "@/app/book/[slug]/styles";
import { salonLogoUrl } from "@/lib/branding";
import { isFinishToken, partToken } from "@/lib/finish-links";
import { loadFormLink } from "@/lib/form-links";
import { DEFAULT_ACCENT } from "@/lib/online-booking/settings";
import { salonProvider } from "@/lib/payments";
import { loadCardLink } from "@/lib/policy-link";
import { formatLongDay } from "@/lib/schedule-format";
import { formatMinute } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { FinishFlow, type FinishCard, type FinishForms } from "./flow";

export const metadata: Metadata = { title: { absolute: "Finish your booking" }, robots: { index: false } };

export default function FinishPage({ params }: PageProps<"/finish/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Finish params={params} />
    </Suspense>
  );
}

// The client's page from a "Finish your booking" link (lib/finish-links.ts):
// the salon's brand, their visit, then the card the policy asks for and the
// forms to sign, in one go. Each part is an ordinary card or form link, by
// the token worked out from this one. Public, with the service role.
async function Finish({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  if (!isFinishToken(token)) notFound();
  const admin = createAdminClient();
  const cardToken = partToken(token, "card");
  const formsToken = partToken(token, "forms");
  const [cardLink, formLink] = await Promise.all([loadCardLink(admin, cardToken), loadFormLink(admin, formsToken)]);
  const any = cardLink ?? formLink;
  if (!any) notFound();

  const cardOpen = cardLink && cardLink.status === "open" && !cardLink.expired;
  const formsOpen = formLink && formLink.status === "open" && !formLink.expired;
  const card: FinishCard | null = cardOpen
    ? { token: cardToken, lines: cardLink.lines, depositCents: cardLink.depositCents, cardForm: await (await salonProvider(admin, cardLink.businessId)).cardForm() }
    : null;
  const forms: FinishForms | null = formsOpen ? { token: formsToken, forms: formLink.forms } : null;
  // A part that closed without being done (expired, or replaced by a newer link).
  const lapsed = (cardLink && !cardOpen && cardLink.status !== "done") || (formLink && !formsOpen && formLink.status !== "done");
  const visit = cardLink?.visit ?? formLink?.visit ?? null;

  return (
    <BookingFrame name={any.salon.name} logoUrl={salonLogoUrl(any.salon.logoPath)} accent={any.salon.accent ?? DEFAULT_ACCENT}>
      {card || forms ? (
        <div className="flex flex-col gap-6">
          <div>
            <h1 className={pageTitle}>Hi {any.clientFirstName}</h1>
            <p className={pageLead}>A couple of things to finish your booking with {any.salon.name}.</p>
          </div>
          {visit && (
            <div className="rounded-lg border border-line bg-surface px-4 py-3">
              <p className="text-base font-semibold text-ink">{formatLongDay(visit.date, false)}</p>
              <p className="text-sm text-ink-muted">
                {formatMinute(visit.minute)} · {visit.services.join(", ")}
              </p>
            </div>
          )}
          <FinishFlow firstName={any.clientFirstName} salon={any.salon.name} card={card} forms={forms} />
        </div>
      ) : lapsed ? (
        <div data-testid="link-closed">
          <h1 className={pageTitle}>This link is no longer active</h1>
          <p className={pageLead}>Ask {any.salon.name} for a new one, or finish at the desk when you arrive.</p>
        </div>
      ) : (
        <div data-testid="finish-done">
          <h1 className={pageTitle}>You&rsquo;re all set, {any.clientFirstName}</h1>
          <p className={pageLead}>{any.salon.name} has what it needs for your booking. See you soon.</p>
        </div>
      )}
      {card && <p className="mt-8 text-center text-xs text-ink-subtle">Card details go to the payment provider; {any.salon.name} never sees or stores them.</p>}
    </BookingFrame>
  );
}
