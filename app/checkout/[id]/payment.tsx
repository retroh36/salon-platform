"use client";

import { useState, useTransition } from "react";
import { DeniseFace } from "@/components/denise";
import { Button, IconButton } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { CalendarIcon, CloseIcon } from "@/components/ui/icons";
import { parseDollars, tipFor, TIP_PERCENTS } from "@/lib/checkout";
import type { CheckoutScreenData } from "@/lib/checkout-screen";
import { creditFor } from "@/lib/memberships-load";
import { packageFor } from "@/lib/packages";
import { formatPrice } from "@/lib/services";
import { formatMinute } from "@/lib/scheduling/time";
import { servicesFor, totalsOf, type Rates, type Ticket } from "@/lib/ticket";
import { bookRebook, rebookTimes, undoRebook } from "../actions";
import type { DialogState } from "./dialogs";

type Totals = ReturnType<typeof totalsOf>;

const METHOD = { card: "Card", cash: "Cash", gift_card: "Gift card" } as const;

export function PaymentPanel({
  data,
  ticket,
  rates,
  totals,
  problems,
  message,
  pending,
  onChange,
  onDialog,
  onRemovePayment,
  onComplete,
}: {
  data: CheckoutScreenData;
  ticket: Ticket;
  rates: Rates;
  totals: Totals;
  problems: string[];
  message: string | null;
  pending: boolean;
  onChange: (t: Ticket | ((t: Ticket) => Ticket)) => void;
  onDialog: (d: DialogState) => void;
  onRemovePayment: (key: string) => void;
  onComplete: () => void;
}) {
  // Stylists with services on the ticket, for tips.
  const stylists = data.staff.filter((s) => servicesFor(ticket, s.id, rates) > 0 || (ticket.tips[s.id] ?? 0) > 0);
  const packageUsable = ticket.lines.some((l) => l.kind === "service" && !l.packageItemId && packageFor(data.packages, l.serviceId, data.staff.find((s) => s.id === l.staffId)?.level ?? null));
  const membershipUsable = ticket.lines.some((l) => l.kind === "service" && !l.packageItemId && !l.membershipCreditId && l.quantity === 1 && creditFor(data.memberships, l.serviceId));
  const blocking = message ?? problems[0] ?? null;
  return (
    <aside aria-label="Payment" className="flex min-h-0 flex-col border-t border-line bg-surface md:border-t-0 md:border-l">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        <dl className="flex flex-col gap-1 tabular-nums" data-testid="checkout-totals">
          <Row label="Subtotal" value={formatPrice(totals.subtotalCents)} />
          {totals.discountCents > 0 && <Row label="Discounts" value={`−${formatPrice(totals.discountCents)}`} testId="total-discounts" />}
          <Row label="Tax" value={formatPrice(totals.taxCents)} />
          <Row label="Tips" value={formatPrice(totals.tipCents)} />
          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
            <dt className="text-lg font-semibold">Total</dt>
            <dd className="font-serif text-4xl font-semibold text-navy-900" data-testid="checkout-total">
              {formatPrice(totals.totalCents)}
            </dd>
          </div>
          {totals.coveredCents > 0 && <Row label={coveredLabel(ticket)} value={`−${formatPrice(totals.coveredCents)}`} />}
        </dl>

        {stylists.length > 0 && (
          <section aria-label="Tips" className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Tips · on each stylist&rsquo;s services</h2>
            {stylists.map((s) => (
              <TipPicker
                key={s.id}
                name={s.firstName}
                servicesCents={servicesFor(ticket, s.id, rates)}
                cents={ticket.tips[s.id] ?? 0}
                onChange={(cents) => onChange((t) => ({ ...t, tips: { ...t.tips, [s.id]: cents } }))}
              />
            ))}
          </section>
        )}

        <section aria-label="Payments" className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Payment</h2>
          <div className="grid grid-cols-2 gap-2">
            <PayButton label="Card" onClick={() => onDialog({ kind: "card" })} />
            <PayButton label="Cash" onClick={() => onDialog({ kind: "cash" })} />
            <PayButton label="Gift card" onClick={() => onDialog({ kind: "gift-card" })} />
            <PayButton label="Package" disabled={!packageUsable} onClick={() => onDialog({ kind: "package" })} />
            {data.memberships.length > 0 && <PayButton label="Membership" disabled={!membershipUsable} onClick={() => onDialog({ kind: "membership" })} />}
          </div>
          {(ticket.payments.length > 0 || totals.coveredCents > 0) && (
            <ul aria-label="Payments taken" className="flex flex-col divide-y divide-line rounded-xl border border-line">
              {totals.coveredCents > 0 && (
                <li className="flex items-center justify-between px-3 py-2.5">
                  <span>{coveredLabel(ticket).replace(/^Paid with /, "").replace(/^./, (c) => c.toUpperCase())}</span>
                  <span className="font-semibold tabular-nums">{formatPrice(totals.coveredCents)}</span>
                </li>
              )}
              {ticket.payments.map((p, i) => (
                <li key={p.key} className="flex items-center gap-2 px-3 py-2" data-testid="payment-line">
                  <span className="min-w-0 flex-1">
                    {METHOD[p.method]}
                    <span className="block text-xs text-ink-muted">
                      {p.method === "cash" && p.tenderedCents > p.amountCents ? `${formatPrice(p.tenderedCents)} given · ${formatPrice(p.tenderedCents - p.amountCents)} change` : ""}
                      {p.method === "card" && p.reference ? `…${p.reference}` : ""}
                      {p.method === "gift_card" ? `…${p.code.slice(-4)} · ${formatPrice(p.balanceCents - p.amountCents)} left on it` : ""}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatPrice(p.amountCents)}</span>
                  <IconButton label={`Remove payment ${i + 1}`} size="sm" onClick={() => onRemovePayment(p.key)}>
                    <CloseIcon className="size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <p
            aria-live="polite"
            data-testid="remaining"
            className={`rounded-xl px-4 py-3 text-lg font-semibold tabular-nums ${totals.dueCents === 0 ? "bg-status-confirmed-bg text-status-confirmed-ink" : "bg-sunken text-ink"}`}
          >
            {totals.dueCents > 0 ? `${formatPrice(totals.dueCents)} remaining to pay` : totals.dueCents < 0 ? `${formatPrice(-totals.dueCents)} more than the total` : "Paid in full"}
            {totals.changeCents > 0 && <span className="block text-base">Change to give: {formatPrice(totals.changeCents)}</span>}
          </p>
        </section>

        {data.client && data.draft.appointmentId && <Rebook data={data} ticket={ticket} onChange={onChange} />}
      </div>

      <div className="shrink-0 space-y-2 border-t border-line bg-surface px-4 py-3 sm:px-5">
        {blocking && (
          <p role={message ? "alert" : "status"} className={`text-sm ${message ? "font-medium text-danger" : "text-ink-muted"}`} data-testid="checkout-blocked">
            {blocking}
          </p>
        )}
        <Button variant="primary" size="lg" className="h-14 w-full text-lg" disabled={pending || problems.length > 0} onClick={onComplete}>
          {pending ? "Completing…" : `Complete sale · ${formatPrice(totals.totalCents - totals.coveredCents)}`}
        </Button>
      </div>
    </aside>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between text-base">
      <dt className="text-ink-muted">{label}</dt>
      <dd data-testid={testId}>{value}</dd>
    </div>
  );
}

function PayButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-14 items-center justify-center rounded-xl border border-line-strong bg-surface text-lg font-semibold text-navy-900 shadow-card transition-[transform,background-color] duration-(--motion-fast) hover:bg-sunken active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45"
    >
      {label}
    </button>
  );
}

// One-tap tip presets on the stylist's services, or a custom amount.
function TipPicker({ name, servicesCents, cents, onChange }: { name: string; servicesCents: number; cents: number; onChange: (cents: number) => void }) {
  const presets = TIP_PERCENTS.map((p) => ({ percent: p, cents: tipFor(servicesCents, p) }));
  const custom = cents > 0 && !presets.some((p) => p.cents === cents);
  const [typing, setTyping] = useState(custom);
  return (
    <div role="group" aria-label={`Tip for ${name}`} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{name}</span>
        <span className="shrink-0 text-sm text-ink-muted tabular-nums" data-testid="tip-amount">
          {formatPrice(cents)} on {formatPrice(servicesCents)}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        <TipButton selected={cents === 0 && !typing} onClick={() => (setTyping(false), onChange(0))}>
          None
        </TipButton>
        {presets.map((p) => (
          <TipButton key={p.percent} selected={!typing && cents === p.cents && cents > 0} onClick={() => (setTyping(false), onChange(p.cents))}>
            {p.percent}%
          </TipButton>
        ))}
        <TipButton selected={typing} onClick={() => setTyping(true)}>
          Custom
        </TipButton>
      </div>
      {typing && (
        <input
          aria-label={`Custom tip for ${name} ($)`}
          inputMode="decimal"
          defaultValue={cents ? (cents / 100).toFixed(2) : ""}
          onChange={(e) => onChange(parseDollars(e.target.value) ?? 0)}
          className={`${fieldClass} h-12`}
          placeholder="$"
          autoFocus
        />
      )}
    </div>
  );
}

function TipButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-11 min-w-0 rounded-lg border px-1 text-sm font-semibold transition-[background-color,color,transform] duration-(--motion-fast) active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-focus ${
        selected ? "border-navy-900 bg-navy-900 text-white" : "border-line-strong bg-surface text-ink hover:bg-sunken"
      }`}
    >
      {children}
    </button>
  );
}

// Rebook before they leave: Denise's suggestion from their rhythm and
// stylist, booked in one tap, or another time that day or a different one.
function Rebook({ data, ticket, onChange }: { data: CheckoutScreenData; ticket: Ticket; onChange: (t: Ticket) => void }) {
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(data.rebook?.date ?? "");
  const [times, setTimes] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const s = data.rebook;

  if (ticket.rebook) {
    return (
      <section aria-label="Rebook" className="flex items-center gap-3 rounded-xl border border-status-confirmed-ink/25 bg-status-confirmed-bg px-4 py-3 text-status-confirmed-ink" data-testid="rebooked">
        <CalendarIcon className="size-5" />
        <span className="flex-1 font-medium">Rebooked for {ticket.rebook.label}</span>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
          const r = await undoRebook(data.draft.id, ticket);
          if (r.ok) onChange(r.ticket);
          else setError(r.message);
        })}>
          Undo
        </Button>
      </section>
    );
  }
  if (!s) return null;

  const book = (when: { date: string; startMinute: number }) =>
    start(async () => {
      setError(null);
      const r = await bookRebook(data.draft.id, ticket, { date: when.date, staffId: s.staffId, startMinute: when.startMinute, serviceIds: s.serviceIds });
      if (r.ok) onChange(r.ticket);
      else setError(r.message);
    });

  return (
    <section aria-label="Rebook" className="flex flex-col gap-3 rounded-xl border border-denise-200 bg-denise-50 px-4 py-3" data-testid="rebook">
      <div className="flex gap-2.5">
        <DeniseFace size={28} className="mt-0.5" />
        <p className="text-denise-900">
          {s.why} <strong className="font-semibold">Book {s.when}?</strong>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending} onClick={() => book({ date: s.date, startMinute: s.startMinute })}>
          Book it
        </Button>
        <Button disabled={pending} onClick={() => setPicking(!picking)}>
          Pick another time
        </Button>
      </div>
      {picking && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            Day
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setTimes(null);
                start(async () => {
                  const r = await rebookTimes(data.draft.id, { date: e.target.value, staffId: s.staffId, serviceIds: s.serviceIds, aroundMinute: s.startMinute });
                  if (r.ok) setTimes(r.starts);
                  else setError(r.message);
                });
              }}
              className={`${fieldClass} h-11`}
            />
          </label>
          {times && times.length === 0 && <p className="text-sm text-ink-muted">Nothing free that day with this stylist.</p>}
          {times && times.length > 0 && (
            <ul aria-label="Free times" className="flex flex-wrap gap-1.5">
              {times.slice(0, 12).map((m) => (
                <li key={m}>
                  <Button size="sm" disabled={pending} onClick={() => book({ date, startMinute: m })}>
                    {formatMinute(m)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}

// What packages and memberships pay for, in words.
function coveredLabel(ticket: Ticket): string {
  const pkg = ticket.lines.some((l) => l.kind === "service" && l.packageItemId);
  const membership = ticket.lines.some((l) => l.kind === "service" && l.membershipCreditId);
  return pkg && membership ? "Paid with package and membership" : membership ? "Paid with membership" : "Paid with package";
}
