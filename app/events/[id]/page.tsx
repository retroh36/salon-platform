import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadEvent, loadEventTeam } from "@/lib/events/load";
import { EVENT_STATUS_LABELS, PARTY_ROLE_LABELS } from "@/lib/events/types";
import { isUuid } from "@/lib/ids";
import { laneSpans } from "@/lib/scheduling/events";
import { formatMinute } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { isFrontOfHouse } from "@/lib/staff";
import { formatEventDay } from "../format";

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
  const [event, team, photos] = await Promise.all([
    loadEvent(supabase, id, tz),
    loadEventTeam(supabase, me.location.id),
    supabase.from("event_photos").select("id, kind, storage_path").eq("event_id", id).order("created_at"),
  ]);
  if (!event) notFound();
  const desk = isFrontOfHouse(me.role);
  const nameOf = new Map(event.members.map((m) => [m.id, m.name]));
  const staffName = (sid: string | null) => team.find((t) => t.id === sid)?.firstName ?? null;
  const spans = laneSpans(event.tasks);
  const signed = photos.data?.length
    ? ((await supabase.storage.from("event-photos").createSignedUrls(photos.data.map((p) => p.storage_path), 3600)).data ?? [])
    : [];

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
          </>
        }
      />
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
          {(event.notes || signed.length > 0) && (
            <Card title="Notes and inspiration" titleId="notes">
              {event.notes && <p className="whitespace-pre-line">{event.notes}</p>}
              {signed.length > 0 && (
                <ul className="mt-3 grid grid-cols-3 gap-2" aria-label="Inspiration photos">
                  {signed.map((p) =>
                    p.signedUrl ? (
                      <li key={p.signedUrl}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link */}
                        <img src={p.signedUrl} alt="Inspiration" className="aspect-square w-full rounded-lg object-cover" />
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
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
                <Row label="Deposit to book" cents={event.depositCents} />
              </dl>
            </Card>
          </aside>
        )}
      </div>
    </AppShell>
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
