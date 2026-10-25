import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { eventClashes } from "@/lib/events/clashes";
import { loadEvent, loadEventSettings, loadEventTeam, loadTaxBp } from "@/lib/events/load";
import { PAYMENT_LABELS } from "@/lib/events/messages";
import { memberShare, paymentSchedule } from "@/lib/events/pricing";
import { EVENT_STATUS_LABELS, PARTY_ROLE_LABELS } from "@/lib/events/types";
import { formatLongDay } from "@/lib/schedule-format";
import { isUuid } from "@/lib/ids";
import { laneSpans } from "@/lib/scheduling/events";
import { formatMinute, toLocal, todayIn } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { isFrontOfHouse } from "@/lib/staff";
import { formatEventDay } from "../format";
import { CompleteEvent, LookNotes, LookPhotoUpload, TrialBooker } from "./day";
import { CardLinkSender, MemberLinkSender, ProposalSender, RetryPayment, StatusControls } from "./money";

export const metadata: Metadata = { title: "Event" };

export default function EventPage({ params }: PageProps<"/events/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <EventView params={params} />
    </Suspense>
  );
}

const KIND = { hair: "Hair", makeup: "Makeup", touch_up: "Touch-ups" } as const;

async function EventView({ params }: Pick<PageProps<"/events/[id]">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isUuid(id)) notFound();
  const tz = me.location.timezone;
  const desk = isFrontOfHouse(me.role);
  const [event, team, photos, links, agreements, payments, settings, taxBp] = await Promise.all([
    loadEvent(supabase, id, tz),
    loadEventTeam(supabase, me.location.id),
    supabase.from("event_photos").select("id, kind, storage_path").eq("event_id", id).order("created_at"),
    supabase.from("event_links").select("id, kind, member_id, status, sent_to, expires_at, created_at").eq("event_id", id).order("created_at", { ascending: false }),
    supabase.from("event_agreements").select("typed_name, agreed_at, terms_version, terms_text").eq("event_id", id).order("agreed_at", { ascending: false }).limit(1),
    supabase.from("event_payments").select("id, kind, member_id, member_name, amount_cents, status, due_on, paid_at, card_label, failure_reason").eq("event_id", id).neq("status", "canceled").order("due_on").order("created_at"),
    loadEventSettings(supabase, me.business_id),
    loadTaxBp(supabase, me.business_id),
  ]);
  if (!event) notFound();
  const holds = event.status === "booked" || event.status === "trial_done";
  const [trials, history, clashes] = await Promise.all([
    supabase.from("appointments").select("id, starts_at, status, items:appointment_items(staff_id)").eq("event_id", id).neq("status", "canceled").order("starts_at"),
    desk ? supabase.from("event_history").select("id, kind, detail, created_at, staff:staff(first_name)").eq("event_id", id).order("created_at", { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
    // Whether the team is still free, by the booking rules (the event's own
    // hold left out).
    desk && event.date >= todayIn(tz) && event.status !== "completed" && event.status !== "lost"
      ? eventClashes(supabase, me.location, { eventId: id, date: event.date, tasks: event.tasks, travelMinutes: event.onLocation ? event.travelMinutes : 0 })
      : Promise.resolve([]),
  ]);
  const nameOf = new Map(event.members.map((m) => [m.id, m.name]));
  const staffName = (sid: string | null) => team.find((t) => t.id === sid)?.firstName ?? null;
  const spans = laneSpans(event.tasks);
  const signedUrls = photos.data?.length
    ? ((await supabase.storage.from("event-photos").createSignedUrls(photos.data.map((p) => p.storage_path), 3600)).data ?? [])
    : [];
  const signed = (photos.data ?? []).map((p, i) => ({ kind: p.kind, signedUrl: signedUrls[i]?.signedUrl ?? null }));
  const inspiration = signed.filter((p) => p.kind === "inspiration");
  const look = signed.filter((p) => p.kind === "look");
  const today = todayIn(tz);
  const trialDay = (iso: string) => {
    const local = toLocal(new Date(iso), tz);
    return `${formatLongDay(local.date, false)} at ${formatMinute(local.minute)}`;
  };

  return (
    <AppShell section="events" me={me} wide>
      <BackLink href="/events">Events</BackLink>
      <PageHeader
        title={event.title}
        description={
          <span>
            {formatEventDay(event.date)}
            {event.readyBy != null && ` · ready by ${formatMinute(event.readyBy)}`}
            {event.onLocation ? ` · ${event.venueName ?? "On location"}` : " · In the salon"}
            {event.client && desk && (
              <>
                {" · "}
                <Link href={`/clients/${event.client.id}`} className="text-link underline underline-offset-2">
                  {event.client.firstName} {event.client.lastName}
                </Link>
              </>
            )}
          </span>
        }
        actions={
          <>
            <Badge tone={event.status === "lost" ? "red" : event.status === "inquiry" ? "amber" : "green"}>{EVENT_STATUS_LABELS[event.status]}</Badge>
            {desk && event.status !== "completed" && event.status !== "lost" && (
              <Link href={`/events/${id}/edit`} className={buttonClass("secondary", "md")}>
                Edit event
              </Link>
            )}
            {event.tasks.length > 0 && (
              <Link href={`/events/${id}/sheet`} className={buttonClass("secondary", "md")}>
                Day-of sheet
              </Link>
            )}
            {desk && holds && event.date <= today && <CompleteEvent eventId={id} />}
            {desk && <StatusControls eventId={id} status={event.status} />}
          </>
        }
      />
      {event.status === "lost" && event.lostReason && <p className="-mt-2 mb-4 text-ink-muted">Lost: {event.lostReason}</p>}
      {event.status === "completed" && event.saleId && desk && (
        <p className="-mt-2 mb-4 text-ink-muted">
          Completed.{" "}
          <Link href={`/sales/${event.saleId}`} className="text-link underline underline-offset-2">
            See the sale
          </Link>{" "}
          for the team&rsquo;s work and tips.
        </p>
      )}
      {clashes.length > 0 && (
        <div className="mb-4">
          <Alert>
            <span data-testid="team-clash">
              {clashes.map((c) => `${staffName(c.staffId) ?? "Someone"} ${c.text} during this event`).join(". ")}. {holds ? "Choose someone else in Edit event." : "Choose someone else before it's booked."}
            </span>
          </Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title={`Party (${event.members.length || event.inquiryPartySize || 0})`} titleId="party" flush>
            {event.members.length ? (
              <ul className="divide-y divide-line" data-testid="party">
                {event.members.map((m) => (
                  <li key={m.id} className="flex items-baseline justify-between gap-3 px-5 py-3">
                    <span className="min-w-0">
                      <span className="font-semibold">{m.name}</span> <span className="text-ink-muted">· {PARTY_ROLE_LABELS[m.partyRole]}</span>
                      <span className="block text-sm text-ink-muted">
                        {m.packageName}
                        {m.paysOwn && " · pays their own"}
                      </span>
                    </span>
                    {desk && <span className="tabular-nums">{formatPrice(m.priceCents)}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-ink-muted">
                Nobody in the party yet.{event.inquiryServices ? ` They asked for: ${event.inquiryServices}.` : ""}
              </p>
            )}
          </Card>
          <Card title="Timeline" titleId="timeline" flush>
            {event.tasks.length ? (
              <>
                <ul className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line px-5 py-3 text-sm" aria-label="Call times">
                  {spans.map((s) => (
                    <li key={`${s.role}-${s.lane}`}>
                      <span className="font-semibold">{staffName(event.tasks.find((t) => t.role === s.role && t.lane === s.lane)?.staffId ?? null) ?? `${KIND[s.role]} ${s.lane}`}</span>{" "}
                      <span className="text-ink-muted">
                        {KIND[s.role]} · call {formatMinute(s.call)}
                      </span>
                    </li>
                  ))}
                </ul>
                <ol className="divide-y divide-line text-sm" data-testid="timeline">
                  {event.tasks
                    .filter((t) => t.kind !== "touch_up")
                    .map((t) => (
                      <li key={t.id} className="flex items-baseline justify-between gap-3 px-5 py-2">
                        <span className="w-32 shrink-0 tabular-nums text-ink-muted">
                          {formatMinute(t.start)}–{formatMinute(t.end)}
                        </span>
                        <span className="min-w-0 flex-1 font-medium">
                          {nameOf.get(t.memberId!) ?? "Guest"} · {KIND[t.kind]}
                        </span>
                        <span className="text-ink-muted">{staffName(t.staffId) ?? `${KIND[t.role]} ${t.lane}`}</span>
                      </li>
                    ))}
                  {event.readyBy != null && <li className="px-5 py-2 font-semibold">Ready by {formatMinute(event.readyBy)}</li>}
                </ol>
              </>
            ) : (
              <p className="px-5 py-4 text-ink-muted">No timeline yet. Add the party and the ready-by time in Edit event.</p>
            )}
          </Card>
          {(event.status !== "inquiry" || trials.data?.length) && event.status !== "lost" ? (
            <Card title="Trial" titleId="trial">
              <div className="flex flex-col gap-3">
                {trials.data?.length ? (
                  <ul className="flex flex-col gap-1 text-sm" data-testid="trials">
                    {trials.data.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          <span className="font-medium">{trialDay(t.starts_at)}</span>
                          {staffName(t.items[0]?.staff_id ?? null) && <span className="text-ink-muted"> with {staffName(t.items[0]?.staff_id ?? null)}</span>}
                          <span className="text-ink-muted"> · {t.status === "completed" ? "Done" : t.status === "no_show" ? "Missed" : "Booked"}</span>
                        </span>
                        {desk && (
                          <Link href={`/calendar?date=${toLocal(new Date(t.starts_at), tz).date}&open=${t.id}`} className="text-link underline underline-offset-2">
                            Open on the calendar
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-muted">No trial booked yet. Checking the trial out marks the event Trial done.</p>
                )}
                {desk && holds && !trials.data?.some((t) => t.status !== "completed" && t.status !== "no_show") && (
                  <TrialBooker eventId={id} defaultDate={trialDefault(event.date, today)} minDate={today} />
                )}
              </div>
            </Card>
          ) : null}
          <Card title="The look" titleId="look">
            <div className="flex flex-col gap-4">
              <LookNotes eventId={id} initial={event.lookNotes ?? ""} />
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Photos of the look</h3>
                {look.length > 0 && <PhotoGrid photos={look} label="Photos of the look" alt="The look" />}
                {event.status !== "lost" && <LookPhotoUpload eventId={id} />}
              </div>
              {inspiration.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Their inspiration</h3>
                  <PhotoGrid photos={inspiration} label="Inspiration photos" alt="Inspiration" />
                </div>
              )}
            </div>
          </Card>
          {event.notes && (
            <Card title="Notes" titleId="notes">
              <p className="whitespace-pre-line">{event.notes}</p>
            </Card>
          )}
          {desk && (history.data?.length ?? 0) > 0 && (
            <Card title="History" titleId="history" flush>
              <ul className="divide-y divide-line text-sm" data-testid="history">
                {history.data!.map((h) => (
                  <li key={h.id} className="flex flex-wrap justify-between gap-x-3 px-5 py-2">
                    <span>
                      {HISTORY_TEXT[h.kind] ?? h.kind.replace(/_/g, " ")}
                      {h.detail && <span className="text-ink-muted"> · {h.detail}</span>}
                    </span>
                    <span className="text-ink-muted">
                      {formatLongDay(toLocal(new Date(h.created_at), tz).date, false)}
                      {h.staff?.first_name && ` · ${h.staff.first_name}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        {desk && (
          <aside className="flex flex-col gap-6" aria-label="Money">
            <Card title="Total" titleId="total">
              <dl className="flex flex-col gap-1.5 text-sm">
                <Row label="Packages" cents={event.subtotalCents} />
                {event.travelFeeCents > 0 && <Row label="Travel" cents={event.travelFeeCents} />}
                {event.earlyFeeCents > 0 && <Row label="Early start" cents={event.earlyFeeCents} />}
                {event.serviceChargeCents > 0 && <Row label="Service charge" cents={event.serviceChargeCents} />}
                {event.taxCents > 0 && <Row label="Tax" cents={event.taxCents} />}
                <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums" data-testid="event-total">
                    {formatPrice(event.totalCents)}
                  </dd>
                </div>
                {event.status === "inquiry" || event.status === "proposal_sent" ? <Row label="Deposit to book" cents={event.depositCents} /> : null}
              </dl>
            </Card>
            <Money
              eventId={id}
              event={event}
              links={links.data ?? []}
              agreement={agreements.data?.[0] ?? null}
              payments={payments.data ?? []}
              shareOf={(priceCents) => memberShare(priceCents, settings, taxBp)}
              preview={paymentSchedule({ mainCents: event.mainCents, depositCents: event.depositCents, eventDate: event.date, bookedOn: todayIn(tz) }, settings)}
              tz={tz}
            />
          </aside>
        )}
      </div>
    </AppShell>
  );
}

// A month before the event (or soon, when it's close).
function trialDefault(eventDate: string, today: string): string {
  const d = new Date(`${eventDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 30);
  const iso = d.toISOString().slice(0, 10);
  return iso > today ? iso : today;
}

const HISTORY_TEXT: Record<string, string> = {
  created: "Created",
  changed: "Changed",
  proposal_sent: "Proposal sent",
  booked: "Booked",
  member_link_sent: "Pay link sent",
  card_link_sent: "Card link sent",
  payment_paid: "Payment taken",
  payment_failed: "Payment didn't go through",
  payment_retried: "Payment tried again",
  trial_booked: "Trial booked",
  trial_done: "Trial done",
  look_saved: "Look notes changed",
  team_released: "Team changed",
  completed: "Completed",
  lost: "Lost",
  reopened: "Reopened",
};

function PhotoGrid({ photos, label, alt }: { photos: { signedUrl: string | null }[]; label: string; alt: string }) {
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={label}>
      {photos.map((p, i) =>
        p.signedUrl ? (
          <li key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link */}
            <img src={p.signedUrl} alt={alt} className="aspect-square w-full rounded-lg object-cover" />
          </li>
        ) : null,
      )}
    </ul>
  );
}

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular-nums">{formatPrice(cents)}</dd>
    </div>
  );
}

type LinkRow = { id: string; kind: string; member_id: string | null; status: string; sent_to: string; expires_at: string; created_at: string };
type PaymentRow = { id: string; kind: string; member_id: string | null; member_name: string | null; amount_cents: number; status: string; due_on: string; paid_at: string | null; card_label: string | null; failure_reason: string | null };

const PAYMENT_STATUS = { scheduled: "Scheduled", paid: "Paid", failed: "Didn't go through" } as Record<string, string>;

// The proposal, what was agreed, the payments (scheduled, paid, failed)
// and members paying their own.
function Money({
  eventId,
  event,
  links,
  agreement,
  payments,
  shareOf,
  preview,
  tz,
}: {
  eventId: string;
  event: NonNullable<Awaited<ReturnType<typeof loadEvent>>>;
  links: LinkRow[];
  agreement: { typed_name: string; agreed_at: string; terms_version: number; terms_text: string } | null;
  payments: PaymentRow[];
  shareOf: (priceCents: number) => number;
  preview: ReturnType<typeof paymentSchedule>;
  tz: string;
}) {
  const day = (iso: string) => formatLongDay(toLocal(new Date(iso), tz).date, false);
  const proposal = links.find((l) => l.kind === "proposal" && l.status === "open");
  const booked = event.status === "booked" || event.status === "trial_done" || event.status === "completed";
  const main = payments.filter((p) => p.kind !== "member");
  const paidMain = main.filter((p) => p.status === "paid").reduce((a, p) => a + p.amount_cents, 0);
  const failed = main.some((p) => p.status === "failed");
  const own = event.members.filter((m) => m.paysOwn);
  return (
    <>
      {(event.status === "inquiry" || event.status === "proposal_sent") && (
        <Card title="Proposal" titleId="proposal">
          <div className="flex flex-col gap-3 text-sm">
            {proposal ? (
              <p data-testid="proposal-status">
                Sent to {proposal.sent_to} on {day(proposal.created_at)}. The link works until {day(proposal.expires_at)}.
              </p>
            ) : (
              <p className="text-ink-muted">The client gets a link to the party, prices, payment schedule and terms, and books by agreeing and paying the deposit.</p>
            )}
            <ul className="flex flex-col gap-0.5 text-ink-muted" aria-label="Payment schedule if booked today">
              {preview.map((p) => (
                <li key={p.kind} className="flex justify-between">
                  <span>
                    {PAYMENT_LABELS[p.kind]} · {p.kind === "deposit" ? "to book" : formatLongDay(p.dueOn, false)}
                  </span>
                  <span className="tabular-nums">{formatPrice(p.amountCents)}</span>
                </li>
              ))}
            </ul>
            <ProposalSender eventId={eventId} phone={event.client?.phone ?? null} email={event.client?.email ?? null} resend={Boolean(proposal)} />
          </div>
        </Card>
      )}
      {agreement && (
        <Card title="Agreement" titleId="agreement">
          <p className="text-sm" data-testid="agreement">
            Agreed by <span className="font-semibold">{agreement.typed_name}</span> on {day(agreement.agreed_at)}, terms version {agreement.terms_version}.
          </p>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-link">What they agreed to</summary>
            <div className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto text-ink-muted">
              {agreement.terms_text.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </details>
        </Card>
      )}
      {booked && (
        <Card title="Payments" titleId="payments" flush>
          <ul className="divide-y divide-line text-sm" data-testid="payments">
            {main.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="font-medium">{PAYMENT_LABELS[p.kind as keyof typeof PAYMENT_LABELS]}</span>
                  <span className="block text-ink-muted">
                    {p.status === "paid" && p.paid_at ? `Paid ${day(p.paid_at)}${p.card_label ? ` · ${p.card_label.replace(" ", "\u00a0")}` : ""}` : p.status === "failed" ? `${PAYMENT_STATUS.failed}${p.failure_reason ? `: ${p.failure_reason}` : ""}` : `Due ${formatLongDay(p.due_on, false)}`}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className={`tabular-nums ${p.status === "failed" ? "font-semibold text-danger" : ""}`}>{formatPrice(p.amount_cents)}</span>
                  {p.status === "failed" && <RetryPayment paymentId={p.id} />}
                </span>
              </li>
            ))}
            <li className="flex justify-between px-5 py-3 font-semibold">
              <span>Left to pay</span>
              <span className="tabular-nums" data-testid="left-to-pay">
                {formatPrice(Math.max(0, event.mainCents - paidMain))}
              </span>
            </li>
          </ul>
          {failed && (
            <div className="border-t border-line px-5 py-3">
              <CardLinkSender eventId={eventId} phone={event.client?.phone ?? null} email={event.client?.email ?? null} />
            </div>
          )}
        </Card>
      )}
      {booked && own.length > 0 && (
        <Card title="Paying their own" titleId="own" flush>
          <ul className="divide-y divide-line text-sm" data-testid="paying-own">
            {own.map((m) => {
              const paid = payments.find((p) => p.member_id === m.id && p.status === "paid");
              const link = links.find((l) => l.member_id === m.id && l.status === "open");
              return (
                <li key={m.id} className="flex flex-col gap-2 px-5 py-3">
                  <span className="flex justify-between gap-3">
                    <span className="font-medium">{m.name}</span>
                    <span className="tabular-nums">{formatPrice(shareOf(m.priceCents))}</span>
                  </span>
                  {paid ? (
                    <span className="text-ink-muted">Paid {paid.paid_at ? day(paid.paid_at) : ""}</span>
                  ) : (
                    <>
                      {link && <span className="text-ink-muted">Link sent to {link.sent_to}</span>}
                      <MemberLinkSender memberId={m.id} memberName={m.name} phone={m.phone} email={m.email} resend={Boolean(link)} />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
