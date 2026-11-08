import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingFrame } from "@/app/book/[slug]/frame";
import { pageLead, pageTitle } from "@/app/book/[slug]/styles";
import { salonLogoUrl } from "@/lib/branding";
import { loadFormLink } from "@/lib/form-links";
import { DEFAULT_ACCENT } from "@/lib/online-booking/settings";
import { formatLongDay } from "@/lib/schedule-format";
import { formatMinute } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { LinkForms } from "./forms";

export const metadata: Metadata = { title: { absolute: "Before your visit" }, robots: { index: false } };

export default function FormLinkPage({ params }: PageProps<"/form/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <FormLink params={params} />
    </Suspense>
  );
}

// The client's secure page from a form link: the salon's brand, their
// visit, and each consultation form to fill in and sign on their phone.
// Public, with the service role, by the link's token (only its hash is
// stored).
async function FormLink({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const link = await loadFormLink(createAdminClient(), token);
  if (!link) notFound();
  const open = link.status === "open" && !link.expired;
  return (
    <BookingFrame name={link.salon.name} logoUrl={salonLogoUrl(link.salon.logoPath)} accent={link.salon.accent ?? DEFAULT_ACCENT}>
      {link.status === "done" ? (
        <div data-testid="forms-done">
          <h1 className={pageTitle}>Thank you, {link.clientFirstName}</h1>
          <p className={pageLead}>{link.salon.name} has your forms. See you soon.</p>
        </div>
      ) : !open ? (
        <div data-testid="link-closed">
          <h1 className={pageTitle}>{link.expired ? "This link has expired" : "This link is no longer active"}</h1>
          <p className={pageLead}>Ask {link.salon.name} for a new one, or fill your forms in when you arrive.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <h1 className={pageTitle}>Hi {link.clientFirstName}</h1>
            <p className={pageLead}>Before your visit, {link.salon.name} asks you to fill in and sign {link.forms.length === 1 ? "a short form" : `${link.forms.length} short forms`}.</p>
          </div>
          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <p className="text-base font-semibold text-ink">{formatLongDay(link.visit.date, false)}</p>
            <p className="text-sm text-ink-muted">
              {formatMinute(link.visit.minute)} · {link.visit.services.join(", ")}
            </p>
          </div>
          <LinkForms token={token} firstName={link.clientFirstName} salon={link.salon.name} forms={link.forms} />
        </div>
      )}
    </BookingFrame>
  );
}
