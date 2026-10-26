"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatMinute, type LocalDate } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { cancelBooking, findTimes, reschedule, type DayTimes } from "../../actions";
import { Alert, Badge } from "@/components/ui/page";
import { accentLink, dangerButton, dangerOutlineButton, pageLead, pageTitle, primaryButton, secondaryButton, sectionTitle } from "../../styles";
import { DateStrip, longDate, TimeGrid } from "../../times";

type Booking = {
  firstName: string;
  status: string;
  date: LocalDate;
  minute: number;
  endMinute: number;
  items: { name: string; stylist: string; priceCents: number }[];
  depositCents: number;
  depositPaidCents: number;
  canChange: boolean;
  // What canceling now costs under the policy.
  cancelFeeCents: number;
  cardLabel: string | null;
};

type Salon = { name: string; location: string; address: string | null; phone: string | null; cutoffHours: number; policy: string[] };

// The client's booking: what, when, with whom, and (until the salon's
// cutoff) cancel or move it. Nothing internal is shown.
export function ManageView({ slug, token, justBooked, today, booking, salon }: { slug: string; token: string; justBooked: boolean; today: LocalDate; booking: Booking; salon: Salon }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "cancel" | "move">("view");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const canceled = booking.status === "canceled";
  const total = booking.items.reduce((sum, i) => sum + i.priceCents, 0);

  const cancel = () =>
    start(async () => {
      const result = await cancelBooking(slug, token);
      if (!result.ok) return setMessage({ tone: "error", text: result.message });
      setMode("view");
      setMessage({ tone: "ok", text: "Your booking is canceled." });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-5 animate-step-in" data-testid="manage-booking">
      <div>
        {justBooked && !canceled ? (
          <>
            <p aria-hidden className="mb-4 inline-flex size-10 items-center justify-center rounded-full bg-(--accent) text-xl text-white">✓</p>
            <h1 className={pageTitle}>You&rsquo;re booked{booking.firstName && `, ${booking.firstName}`}</h1>
            <p className={pageLead}>We&rsquo;ve sent you the details with a link back to this page, where you can change or cancel.</p>
          </>
        ) : (
          <h1 className={pageTitle}>{canceled ? "Booking canceled" : "Your booking"}</h1>
        )}
      </div>

      {message && (
        <Alert tone={message.tone === "error" ? "error" : "success"}>{message.text}</Alert>
      )}

      <div className={`overflow-hidden rounded-lg border border-line bg-surface ${canceled ? "opacity-70" : ""}`}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className={`text-base font-semibold ${canceled ? "line-through" : ""}`} data-testid="booking-when">
              {longDate(booking.date)}
            </p>
            <p className="text-sm text-ink-muted">
              {formatMinute(booking.minute)}–{formatMinute(booking.endMinute)} · {salon.location}
            </p>
          </div>
          {canceled && <Badge tone="neutral">Canceled</Badge>}
        </div>
        <ul className="divide-y divide-line">
          {booking.items.map((i, n) => (
            <li key={n} className="flex items-baseline justify-between gap-3 px-4 py-3">
              <span>
                <span className="block font-medium">{i.name}</span>
                <span className="text-sm text-ink-muted">with {i.stylist}</span>
              </span>
              <span className="text-sm font-medium tabular-nums">{formatPrice(i.priceCents)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-line px-4 py-3 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(total)}</span>
        </div>
        {booking.depositPaidCents > 0 && (
          <p className="border-t border-line px-4 py-3 text-sm text-ink-muted" data-testid="deposit-paid">
            Deposit paid: {formatPrice(booking.depositPaidCents)}. It comes off your bill at the visit.
          </p>
        )}
      </div>

      {salon.address && (
        <p className="text-sm text-ink-muted">
          {salon.name}, {salon.address}
          {salon.phone && ` · ${salon.phone}`}
        </p>
      )}

      {!canceled && booking.canChange && mode === "view" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className={primaryButton} onClick={() => (setMode("move"), setMessage(null))}>
            Reschedule
          </button>
          <button type="button" className={dangerOutlineButton} onClick={() => (setMode("cancel"), setMessage(null))}>
            Cancel booking
          </button>
        </div>
      )}

      {!canceled && !booking.canChange && (
        <Alert tone="info">
          It&rsquo;s less than {salon.cutoffHours} hours to your visit, so changes are by phone{salon.phone ? `: ${salon.phone}` : ""}.
        </Alert>
      )}

      {mode === "cancel" && (
        <div role="dialog" aria-label="Cancel booking" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 animate-pop-in">
          <p className="text-base font-semibold">Cancel this booking?</p>
          {booking.cancelFeeCents > 0 ? (
            <p className="text-sm font-medium text-ink" data-testid="cancel-fee">
              It&rsquo;s inside the cancellation window, so canceling now costs {formatPrice(booking.cancelFeeCents)}
              {booking.depositPaidCents > 0
                ? booking.cancelFeeCents > booking.depositPaidCents
                  ? `: your ${formatPrice(booking.depositPaidCents)} deposit, and the rest charged to ${booking.cardLabel ?? "your card on file"}.`
                  : ", kept from your deposit."
                : ` (charged to ${booking.cardLabel ?? "your card on file"}).`}
            </p>
          ) : (
            booking.depositPaidCents > 0 && <p className="text-sm text-ink-muted">Your {formatPrice(booking.depositPaidCents)} deposit will be refunded to your card.</p>
          )}
          <div className="flex flex-col gap-1 text-sm text-ink-muted">
            {salon.policy.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className={dangerButton} onClick={cancel} disabled={pending}>
              {pending ? "Canceling…" : "Yes, cancel it"}
            </button>
            <button type="button" className={secondaryButton} onClick={() => setMode("view")}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {mode === "move" && (
        <Reschedule
          slug={slug}
          token={token}
          today={today}
          onDone={(text) => {
            setMode("view");
            setMessage({ tone: "ok", text });
            router.refresh();
          }}
          onCancel={() => setMode("view")}
        />
      )}

      <Link href={`/book/${slug}`} className={`self-center text-sm ${accentLink}`}>
        Book another visit
      </Link>
    </div>
  );
}

function Reschedule({ slug, token, today, onDone, onCancel }: { slug: string; token: string; today: LocalDate; onDone: (text: string) => void; onCancel: () => void }) {
  const [days, setDays] = useState<DayTimes[] | null>(null);
  const [date, setDate] = useState<LocalDate | null>(null);
  const [minute, setMinute] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Bumped to load the times again after a time is taken.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    start(async () => {
      const result = await findTimes(slug, [], null, today, token);
      if (!result.ok) return setError(result.message);
      setDays(result.days);
      setDate((d) => (d && result.days.some((x) => x.date === d) ? d : result.days.find((x) => x.times.length)?.date ?? result.days[0]?.date ?? null));
    });
  }, [slug, today, token, reload]);
  const day = days?.find((d) => d.date === date);

  const save = () =>
    start(async () => {
      const result = await reschedule(slug, token, date!, minute!);
      if (!result.ok) {
        setError(result.message);
        setMinute(null);
        setReload((n) => n + 1);
        return;
      }
      onDone(`Moved to ${longDate(date!)} at ${formatMinute(minute!)}.`);
    });

  return (
    <section aria-label="Reschedule" className="flex flex-col gap-4 animate-pop-in">
      <h2 className={sectionTitle}>Pick a new time</h2>
      {error && <Alert>{error}</Alert>}
      {!days ? (
        <p className="text-ink-muted" aria-busy="true">Finding times…</p>
      ) : (
        <>
          <DateStrip days={days} selected={date} onSelect={(d) => (setDate(d), setMinute(null))} onMore={null} loading={pending} />
          {day &&
            (day.times.length ? (
              <TimeGrid times={day.times} selected={minute} onPick={(t) => setMinute(t.minute)} />
            ) : (
              <p className="py-8 text-center text-ink-muted">No times this day. Try another date.</p>
            ))}
        </>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className={primaryButton} disabled={minute === null || pending} onClick={save}>
          {pending && minute !== null ? "Moving…" : "Move my booking"}
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Keep the current time
        </button>
      </div>
    </section>
  );
}
