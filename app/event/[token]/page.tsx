import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingFrame } from "@/app/book/[slug]/frame";
import { salonLogoUrl } from "@/lib/branding";
import { loadEventLink, type EventLink } from "@/lib/events/links";
import { SCHEDULED_LABELS } from "@/lib/events/pricing";
import { DEFAULT_ACCENT } from "@/lib/online-booking/settings";
import { currentProvider } from "@/lib/payments";
import { formatLongDay } from "@/lib/schedule-format";
import { formatPrice } from "@/lib/services";
import { formatMinute } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { pageLead, pageTitle, sectionTitle } from "@/app/book/[slug]/styles";
import { Alert, Badge } from "@/components/ui/page";
import { AgreeForm, NewCardForm, ShareForm } from "./forms";

export const metadata: Metadata = { title: { absolute: "Your event" }, robots: { index: false } };

export default function EventLinkPage({ params }: PageProps<"/event/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <EventPage params={params} />
    </Suspense>
  );
}

function Row({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <p className={`flex justify-between gap-4 ${strong ? "mt-1 border-t border-line pt-3 font-semibold text-ink" : "text-sm text-ink-muted"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatPrice(cents)}</span>
    </p>
  );
}

// Each part of the page is a section: a title over a thin rule (no boxes).
const box = "flex flex-col gap-2";

// The client's page from a proposal or a pay link, in the salon's brand:
// the day, the party and services, the total and payment schedule and the
// terms to agree to (or a member's own share). Public, with the service
// role, by the link's token (only its hash is stored).
async function EventPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const link = await loadEventLink(createAdminClient(), token);
  if (!link) notFound();
  const provider = currentProvider();
  const cards = provider.testCards.map((c) => ({ ref: c.ref, label: c.label, outcome: c.outcome }));
  const closed = link.status === "canceled" || (link.status === "open" && link.expired);
  return (
    <BookingFrame name={link.salon.name} logoUrl={salonLogoUrl(link.salon.logoPath)} accent={link.salon.accent ?? DEFAULT_ACCENT}>
      {closed ? (
        <div data-testid="link-closed">
          <h1 className={pageTitle}>{link.expired ? "This link has expired" : "This link is no longer active"}</h1>
          <p className={pageLead}>Ask {link.salon.name} for a new one.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          <Day link={link} />
          {link.kind === "card" && link.owed ? (
            <>
              <section className={box} aria-label="Your payments">
                <h2 className={sectionTitle}>Your payments</h2>
                {link.owed.failedCents > 0 && (
                  <Badge tone="danger" className="self-start">
                    Payment didn&rsquo;t go through
                  </Badge>
                )}
                <p className="text-sm text-ink-muted">
                  {link.owed.failedCents > 0
                    ? `A payment of ${formatPrice(link.owed.failedCents)} didn't go through on ${link.owed.cardLabel ?? "your card"}. Add another card and it's paid straight away; later payments go on it too.`
                    : "Add the card for the rest of your payments."}
                </p>
                <Row label="Left to pay in all" cents={Math.max(0, link.owed.leftCents)} strong />
              </section>
              <NewCardForm token={token} dueCents={link.owed.failedCents} testMode={provider.testMode} cards={cards} />
            </>
          ) : link.kind === "member" && link.member ? (
            <>
              <section className={box} aria-label="Your share">
                <h2 className={sectionTitle}>{link.member.name}</h2>
                <Row label={link.member.packageName} cents={link.member.priceCents} />
                <Row label="Service charge and tax" cents={link.member.shareCents - link.member.priceCents} />
                <Row label="Your share" cents={link.member.shareCents} strong />
              </section>
              {link.member.paid || link.status === "done" ? (
                <div data-testid="share-paid">
                  <Alert tone="success">Your share is paid. Thank you.</Alert>
                </div>
              ) : (
                <ShareForm token={token} shareCents={link.member.shareCents} testMode={provider.testMode} cards={cards} />
              )}
            </>
          ) : (
            <Proposal link={link} token={token} testMode={provider.testMode} cards={cards} />
          )}
        </div>
      )}
      <p className="mt-8 text-center text-xs text-ink-subtle">Card details go to the payment provider; {link.salon.name} never sees or stores them.</p>
    </BookingFrame>
  );
}

function Day({ link }: { link: EventLink }) {
  return (
    <div>
      <h1 className={pageTitle}>{link.kind === "member" && link.member ? `Hi ${link.member.name}` : `Hi ${link.clientFirstName}`}</h1>
      <p className={pageLead}>
        {link.title} · {formatLongDay(link.date)}
      </p>
      <p className="text-ink-muted">
        {[link.readyBy != null && `Ready by ${formatMinute(link.readyBy)}`, link.startsAt != null && `we start at ${formatMinute(link.startsAt)}`, link.onLocation && link.venue ? `at ${link.venue}` : "at the salon"].filter(Boolean).join(", ")}
      </p>
    </div>
  );
}

function Proposal({ link, token, testMode, cards }: { link: EventLink; token: string; testMode: boolean; cards: { ref: string; label: string; outcome: string }[] }) {
  const t = link.totals;
  const own = t.totalCents - t.mainCents;
  return (
    <>
      <section className="flex flex-col" aria-label="The party">
        <h2 className={sectionTitle}>The party</h2>
        <ul className="flex flex-col divide-y divide-line" data-testid="proposal-party">
          {link.party.map((m, i) => (
            <li key={i} className="flex justify-between gap-4 py-3 text-sm">
              <span>
                <span className="font-medium text-ink">{m.name}</span> <span className="text-ink-muted">· {m.packageName}</span>
                {m.paysOwn && <span className="text-ink-muted"> (pays their own)</span>}
              </span>
              <span className="tabular-nums text-ink-muted">{formatPrice(m.priceCents)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className={box} aria-label="Total" data-testid="proposal-total">
        <h2 className={sectionTitle}>Total</h2>
        <Row label="Services" cents={t.subtotalCents} />
        {t.travelFeeCents > 0 && <Row label="Travel" cents={t.travelFeeCents} />}
        {t.earlyFeeCents > 0 && <Row label="Early start" cents={t.earlyFeeCents} />}
        {t.serviceChargeCents > 0 && <Row label={`Service charge (${t.serviceChargePct}%)`} cents={t.serviceChargeCents} />}
        {t.taxCents > 0 && <Row label="Tax" cents={t.taxCents} />}
        <Row label="Total" cents={t.totalCents} strong />
        {own > 0 && <Row label="Paid by those paying their own" cents={-own} />}
      </section>
      {link.status === "done" ? (
        <div data-testid="event-booked">
          <h2 className="text-xl font-semibold text-ink">You&rsquo;re booked</h2>
          <p className={pageLead}>Agreed{link.agreedAs ? ` by ${link.agreedAs}` : ""}. Payments are charged to your card as scheduled, with a reminder before each.</p>
        </div>
      ) : (
        <>
          <section className={box} aria-label="Payments" data-testid="proposal-schedule">
            <h2 className={sectionTitle}>Payments</h2>
            {link.schedule.map((p) => (
              <p key={p.kind} className="flex justify-between gap-4 text-sm">
                <span>
                  {SCHEDULED_LABELS[p.kind]}
                  <span className="text-ink-muted"> · {p.kind === "deposit" ? `today${link.depositRefundable ? "" : ", non-refundable"}` : formatLongDay(p.dueOn, false)}</span>
                </span>
                <span className="font-medium tabular-nums">{formatPrice(p.amountCents)}</span>
              </p>
            ))}
            <p className="mt-1 text-xs text-ink-subtle">Later payments are charged to the card you use today, with a reminder a few days before. Changes to the party are welcome until {formatLongDay(link.cutoff, false)}.</p>
          </section>
          {link.terms && (
            <section className={box} aria-label="Terms">
              <h2 className={sectionTitle}>Terms (version {link.terms.version})</h2>
              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg border border-line bg-surface p-4 text-sm text-ink-muted focus-visible:outline-2 focus-visible:outline-focus" tabIndex={0} data-testid="proposal-terms">
                {link.terms.text.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </section>
          )}
          <AgreeForm token={token} totalCents={t.totalCents} depositCents={t.depositCents} testMode={testMode} cards={cards} />
        </>
      )}
    </>
  );
}
