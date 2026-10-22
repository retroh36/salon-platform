"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatMinute, type LocalDate } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { cancelBooking, findTimes, reschedule, type DayTimes } from "../../actions";
import { choiceClass, primaryButton } from "../../booking-flow";
import { DateStrip, longDate, TimeGrid } from "../../times";

type Booking = {
  firstName: string;
  status: string;
  date: LocalDate;
  minute: number;
  endMinute: number;
  items: { name: string; stylist: string; priceCents: number }[];
  depositCents: number;
  canChange: boolean;
};

type Salon = { name: string; location: string; address: string | null; phone: string | null; cutoffHours: number; policy: string };

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
            <p aria-hidden className="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-(--accent) text-2xl text-white">✓</p>
            <h1 className="font-serif text-3xl font-semibold tracking-tight">You&rsquo;re booked{booking.firstName && `, ${booking.firstName}`}</h1>
            <p className="mt-2 text-ink-muted">We&rsquo;ve sent you the details with a link back to this page, where you can change or cancel.</p>
          </>
        ) : (
          <h1 className="font-serif text-3xl font-semibold tracking-tight">{canceled ? "Booking canceled" : "Your booking"}</h1>
        )}
      </div>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ${message.tone === "error" ? "border border-danger/25 bg-danger-soft text-danger" : "bg-(--accent-soft) text-ink"}`}>
          {message.text}
        </p>
      )}

      <div className={`overflow-hidden rounded-xl border border-line bg-surface shadow-card ${canceled ? "opacity-70" : ""}`}>
        <div className="border-b border-line bg-(--accent-soft) px-4 py-4">
          <p className={`font-serif text-xl font-semibold ${canceled ? "line-through" : ""}`} data-testid="booking-when">
            {longDate(booking.date)}
          </p>
          <p className="text-ink-muted">
            {formatMinute(booking.minute)}–{formatMinute(booking.endMinute)} · {salon.location}
          </p>
        </div>
        <ul className="divide-y divide-line">
          {booking.items.map((i, n) => (
            <li key={n} className="flex items-baseline justify-between gap-3 px-4 py-3">
              <span>
                <span className="block font-semibold">{i.name}</span>
                <span className="text-sm text-ink-muted">with {i.stylist}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums">{formatPrice(i.priceCents)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-line px-4 py-3 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(total)}</span>
        </div>
        {booking.depositCents > 0 && (
          <p className="border-t border-line px-4 py-3 text-sm text-ink-muted">
            Deposit {formatPrice(booking.depositCents)}: payments are coming soon, so the salon will take it.
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
          <button type="button" className={`${choiceClass} justify-center border-line font-semibold text-danger`} onClick={() => (setMode("cancel"), setMessage(null))}>
            Cancel booking
          </button>
        </div>
      )}

      {!canceled && !booking.canChange && (
        <p className="rounded-xl bg-sunken px-4 py-3 text-sm text-ink">
          It&rsquo;s less than {salon.cutoffHours} hours to your visit, so changes are by phone{salon.phone ? `: ${salon.phone}` : ""}.
        </p>
      )}

      {mode === "cancel" && (
        <div role="dialog" aria-label="Cancel booking" className="flex flex-col gap-3 rounded-xl border border-danger/25 bg-surface p-4 animate-pop-in">
          <p className="font-semibold">Cancel this booking?</p>
          {salon.policy && <p className="text-sm whitespace-pre-line text-ink-muted">{salon.policy}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className={`${primaryButton} bg-danger!`} onClick={cancel} disabled={pending}>
              {pending ? "Canceling…" : "Yes, cancel it"}
            </button>
            <button type="button" className={`${choiceClass} justify-center border-line font-semibold`} onClick={() => setMode("view")}>
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

      <Link href={`/book/${slug}`} className="text-center text-sm font-semibold text-link hover:text-link-hover">
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
    <section aria-label="Reschedule" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 animate-pop-in">
      <h2 className="font-serif text-xl font-semibold">Pick a new time</h2>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!days ? (
        <p className="text-ink-muted" aria-busy="true">Finding times…</p>
      ) : (
        <>
          <DateStrip days={days} selected={date} onSelect={(d) => (setDate(d), setMinute(null))} onMore={null} loading={pending} />
          {day &&
            (day.times.length ? (
              <TimeGrid times={day.times} selected={minute} onPick={(t) => setMinute(t.minute)} />
            ) : (
              <p className="rounded-xl bg-sunken px-4 py-6 text-center text-ink-muted">No times this day. Try another date.</p>
            ))}
        </>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className={primaryButton} disabled={minute === null || pending} onClick={save}>
          {pending && minute !== null ? "Moving…" : "Move my booking"}
        </button>
        <button type="button" className={`${choiceClass} justify-center border-line font-semibold`} onClick={onCancel}>
          Keep the current time
        </button>
      </div>
    </section>
  );
}
