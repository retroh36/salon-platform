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
    <p className={`flex justify-between gap-4 ${strong ? "font-semibold text-ink" : "text-ink-muted"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatPrice(cents)}</span>
    </p>
  );
}

const box = "rounded-xl border border-line bg-surface px-4 py-4";

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
        <div className="flex flex-col gap-2" data-testid="link-closed">
          <h1 className="font-serif text-3xl font-semibold text-ink">{link.expired ? "This link has expired" : "This link is no longer active"}</h1>
          <p className="text-ink-muted">Ask {link.salon.name} for a new one.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Day link={link} />
          {link.kind === "card" && link.owed ? (
            <>
              <section className={`${box} flex flex-col gap-1`} aria-label="Your payments">
                <p className="text-ink-muted">
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
              <section className={`${box} flex flex-col gap-1`} aria-label="Your share">
                <p className="font-semibold text-ink">{link.member.name}</p>
                <Row label={link.member.packageName} cents={link.member.priceCents} />
                <Row label="Service charge and tax" cents={link.member.shareCents - link.member.priceCents} />
                <Row label="Your share" cents={link.member.shareCents} strong />
              </section>
              {link.member.paid || link.status === "done" ? (
                <p className="font-medium text-ink" data-testid="share-paid">
                  Your share is paid. Thank you.
                </p>
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
      <h1 className="font-serif text-3xl font-semibold text-ink">{link.kind === "member" && link.member ? `Hi ${link.member.name}` : `Hi ${link.clientFirstName}`}</h1>
      <p className="text-ink-muted">
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
      <section className={box} aria-label="The party">
        <h2 className="mb-2 font-semibold text-ink">The party</h2>
        <ul className="flex flex-col gap-1.5" data-testid="proposal-party">
          {link.party.map((m, i) => (
            <li key={i} className="flex justify-between gap-4 text-sm">
              <span>
                <span className="font-medium text-ink">{m.name}</span> <span className="text-ink-muted">· {m.packageName}</span>
                {m.paysOwn && <span className="text-ink-muted"> (pays their own)</span>}
              </span>
              <span className="tabular-nums text-ink-muted">{formatPrice(m.priceCents)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className={`${box} flex flex-col gap-1`} aria-label="Total" data-testid="proposal-total">
        <Row label="Services" cents={t.subtotalCents} />
        {t.travelFeeCents > 0 && <Row label="Travel" cents={t.travelFeeCents} />}
        {t.earlyFeeCents > 0 && <Row label="Early start" cents={t.earlyFeeCents} />}
        {t.serviceChargeCents > 0 && <Row label={`Service charge (${t.serviceChargePct}%)`} cents={t.serviceChargeCents} />}
        {t.taxCents > 0 && <Row label="Tax" cents={t.taxCents} />}
        <Row label="Total" cents={t.totalCents} strong />
        {own > 0 && <Row label="Paid by those paying their own" cents={-own} />}
      </section>
      {link.status === "done" ? (
        <div className={box} data-testid="event-booked">
          <h2 className="font-serif text-2xl font-semibold text-ink">You&rsquo;re booked</h2>
          <p className="text-ink-muted">Agreed{link.agreedAs ? ` by ${link.agreedAs}` : ""}. Payments are charged to your card as scheduled, with a reminder before each.</p>
        </div>
      ) : (
        <>
          <section className={`${box} flex flex-col gap-1`} aria-label="Payments" data-testid="proposal-schedule">
            <h2 className="mb-1 font-semibold text-ink">Payments</h2>
            {link.schedule.map((p) => (
              <p key={p.kind} className="flex justify-between gap-4 text-sm">
                <span>
                  {SCHEDULED_LABELS[p.kind]}
                  <span className="text-ink-muted"> · {p.kind === "deposit" ? `today${link.depositRefundable ? "" : ", non-refundable"}` : formatLongDay(p.dueOn, false)}</span>
                </span>
                <span className="tabular-nums">{formatPrice(p.amountCents)}</span>
              </p>
            ))}
            <p className="mt-1 text-xs text-ink-subtle">Later payments are charged to the card you use today, with a reminder a few days before. Changes to the party are welcome until {formatLongDay(link.cutoff, false)}.</p>
          </section>
          {link.terms && (
            <section className={box} aria-label="Terms">
              <h2 className="mb-2 font-semibold text-ink">Terms (version {link.terms.version})</h2>
              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto text-sm text-ink-muted" tabIndex={0} data-testid="proposal-terms">
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
