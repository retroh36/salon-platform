"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ClientPicker } from "@/app/calendar/booking-panel";
import type { ClientOption } from "@/app/calendar/actions";
import { addChatClient, bookFromChat, bookingPolicy, bookingTimes, waitlistFromChat, type BookingPolicy } from "@/app/denise/booking-actions";
import { Button, buttonClass } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert, Badge, textLinkClass } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import type { BookingCard, BookingSlot, ClientMatch } from "@/lib/denise/booking-chat";
import type { ChatMessage } from "@/lib/denise/types";
import { DEFAULT_DAYS, type PhoneRequest } from "@/lib/phone-booking";
import { reach } from "@/lib/reach";
import { LEVEL_LABELS, STAFF_LEVELS, type StaffLevel } from "@/lib/schedule-forms";
import type { PartOfDay } from "@/lib/scheduling/phone";
import { addDays, formatMinute } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { appendDenise, requestAdjust, updateDenise } from "./store";

const firstOf = (name: string) => name.split(" ")[0];
const optionOf = (c: ClientMatch): ClientOption => ({ id: c.id, name: c.name, phone: c.phone, allergies: c.allergies });

// A booking card under what Denise said (lib/denise/booking-chat.ts): the
// best times to book in one tap, a question about which client, a new
// client, or the form. What came of it (booked, on the waitlist) stays with
// the message.
export function BookingCardView({
  card,
  index,
  outcome,
  today,
  onBooked,
}: {
  card: BookingCard;
  // The message's place in the chat, to keep what came of it.
  index: number;
  outcome: ChatMessage["outcome"];
  today: string;
  onBooked?: (appointmentId: string, date: string) => void;
}) {
  if (outcome) return <Outcome outcome={outcome} />;
  switch (card.kind) {
    case "times":
      return <Times card={card} index={index} onBooked={onBooked} />;
    case "which_client":
      return <WhichClient card={card} index={index} />;
    case "new_client":
      return <NewClient card={card} index={index} />;
    case "form":
      return <BookingForm card={card} index={index} today={today} />;
  }
}

function Outcome({ outcome }: { outcome: NonNullable<ChatMessage["outcome"]> }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-denise-200 bg-surface p-3" data-testid="booking-outcome">
      <p className="font-medium text-ink">{outcome.text}</p>
      {outcome.appointmentId && outcome.date && (
        <a href={`/calendar?date=${outcome.date}&open=${outcome.appointmentId}`} className={buttonClass("secondary", "sm")}>
          Open booking
        </a>
      )}
    </div>
  );
}

const cardClass = "flex animate-fade-in flex-col gap-3 rounded-lg border border-denise-200 bg-surface p-3";

// The next reply, after staff answer a card's question.
function useNext(index: number) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const next = (request: PhoneRequest, client: ClientMatch | ClientOption | null, picked: string) =>
    start(async () => {
      setError(null);
      const r = await reach(bookingTimes(request, client?.id ?? null));
      if (!r.ok) return setError(r.message);
      updateDenise(index, { outcome: { text: picked } });
      appendDenise({ role: "denise", text: r.reply.text, booking: r.reply.card });
    });
  return { pending, error, setError, next };
}

function Times({ card, index, onBooked }: { card: Extract<BookingCard, { kind: "times" }>; index: number; onBooked?: (appointmentId: string, date: string) => void }) {
  const [client, setClient] = useState<ClientOption | null>(card.client ? optionOf(card.client) : null);
  const [confirming, setConfirming] = useState<BookingSlot | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const alerts = card.client && client?.id === card.client.id ? card.alerts : null;

  function waitlist() {
    if (!client) return setMessage("Choose the client first.");
    start(async () => {
      const r = await reach(waitlistFromChat(card.request, client.id));
      if (r.ok) updateDenise(index, { outcome: { text: r.message } });
      else setMessage(r.message);
    });
  }

  const group = (title: string | null, slots: BookingSlot[], primary: boolean) =>
    slots.length > 0 && (
      <div className="flex flex-col gap-2">
        {title && <h3 className="text-13 font-medium text-ink">{title}</h3>}
        <ol className="flex flex-col gap-2">
          {slots.map((o, n) => (
            <li key={`${o.date}-${o.lines[0].staffId}-${o.lines[0].startMinute}`} className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0" data-testid="booking-slot">
              <p className="font-medium text-ink">{o.when}</p>
              <p className="text-ink">
                {o.what} · <span className="tabular-nums">{formatPrice(o.priceCents)}</span>
              </p>
              <p className="text-denise-900">{o.reason}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button size="sm" variant={primary && n === 0 ? "primary" : "secondary"} disabled={pending || !client} title={client ? undefined : "Choose the client first"} onClick={() => setConfirming(o)}>
                  Book
                </Button>
                <AdjustButton slot={o} client={client} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    );

  return (
    <section aria-label="Booking times" className={cardClass} data-testid="booking-card">
      {client ? (
        <ClientLine client={client} alerts={alerts} onChange={card.client ? undefined : () => setClient(null)} />
      ) : (
        <ClientPicker client={null} onChange={setClient} />
      )}
      {confirming && client ? (
        <Confirm
          slot={confirming}
          client={client}
          onBack={() => setConfirming(null)}
          onBooked={(appointmentId, text) => {
            updateDenise(index, { outcome: { text, appointmentId, date: confirming.date } });
            onBooked?.(appointmentId, confirming.date);
          }}
        />
      ) : (
        <>
          {group(null, card.options, true)}
          {card.options.length === 0 && (
            <>
              {group("Another day", card.otherDays, true)}
              {group("Another stylist at the same level", card.sameLevel, false)}
              <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                <p className="text-ink-muted">Or put {client ? firstOf(client.name) : "them"} on the waitlist for those days, and I&rsquo;ll look out for an opening.</p>
                <Button size="sm" className="self-start" disabled={pending || !client} onClick={waitlist}>
                  Add to waitlist
                </Button>
              </div>
            </>
          )}
          {card.lengths && <p className="text-13 text-ink-muted">{card.lengths}</p>}
        </>
      )}
      {message && <Alert>{message}</Alert>}
    </section>
  );
}

// "Open in booking form": the calendar's booking form, filled in, to change
// anything first.
function AdjustButton({ slot, client }: { slot: BookingSlot; client: ClientOption | null }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <Button
      size="sm"
      variant="quiet"
      onClick={() => {
        requestAdjust({ date: slot.date, lines: slot.lines.map((l) => ({ serviceId: l.serviceId, staffId: l.staffId, startMinute: l.startMinute, minutes: l.minutes })), client });
        if (path !== "/calendar") router.push(`/calendar?date=${slot.date}`);
      }}
    >
      Open in booking form
    </Button>
  );
}

// The client, with what staff should know before booking.
function ClientLine({ client, alerts, onChange }: { client: ClientOption; alerts: Extract<BookingCard, { kind: "times" }>["alerts"]; onChange?: () => void }) {
  return (
    <div className="flex flex-col gap-2" data-testid="booking-client">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0">
          <span className="block font-semibold break-words text-ink">{client.name}</span>
          {client.phone && <span className="block text-13 text-ink-muted">{client.phone}</span>}
        </p>
        {onChange && (
          <Button size="xs" onClick={onChange}>
            Change client
          </Button>
        )}
      </div>
      {alerts && (
        <div className="flex flex-col gap-1.5" data-testid="booking-alerts">
          <div className="flex flex-wrap gap-1.5">
            {alerts.allergies && (
              <Badge tone="danger" wrap>
                {/^allerg/i.test(alerts.allergies) ? alerts.allergies : `Allergy: ${alerts.allergies}`}
              </Badge>
            )}
            <Badge tone={alerts.card === "on_file" ? "success" : "neutral"}>{alerts.card === "on_file" ? "Card on file" : "No card on file"}</Badge>
            {alerts.repeatNoShow && <Badge tone="danger">Repeat no-show</Badge>}
          </div>
          {alerts.policyNote && <p className="text-13 text-denise-900">{alerts.policyNote}</p>}
          {alerts.last && <p className="text-13 text-ink-muted">Last visit: {alerts.last.text}.</p>}
        </div>
      )}
    </div>
  );
}

// Booking in one step: what it is, what it costs and what the cancellation
// policy asks for, then Confirm.
function Confirm({ slot, client, onBack, onBooked }: { slot: BookingSlot; client: ClientOption; onBack: () => void; onBooked: (appointmentId: string, text: string) => void }) {
  const [policy, setPolicy] = useState<BookingPolicy | null | undefined>(undefined);
  const [cardLink, setCardLink] = useState(true);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    bookingPolicy(client.id, slot.lines).then(
      (p) => live && setPolicy(p),
      () => live && setPolicy(null),
    );
    return () => {
      live = false;
    };
  }, [client.id, slot.lines]);
  function confirm() {
    setMessage(null);
    start(async () => {
      const r = await reach(bookFromChat({ date: slot.date, clientId: client.id, lines: slot.lines, cardLink: Boolean(policy?.cardNeeded && policy.phone && cardLink) }));
      if (r.ok) onBooked(r.appointmentId, `${r.message} ${firstOf(client.name)}: ${slot.when}.`);
      else setMessage(r.message);
    });
  }
  return (
    <div className="flex flex-col gap-3" data-testid="booking-confirm">
      <p className="font-medium text-ink">{slot.when}</p>
      <ul className="flex flex-col gap-1">
        {slot.lines.map((l, n) => (
          <li key={n} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">{slot.lines.length > 1 ? `${formatMinute(l.startMinute)} · ` : ""}{lineText(slot, n)}</span>
            <span className="shrink-0 tabular-nums">{formatPrice(l.priceCents)}</span>
          </li>
        ))}
        {slot.lines.length > 1 && (
          <li className="flex justify-between gap-3 border-t border-line pt-1 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatPrice(slot.priceCents)}</span>
          </li>
        )}
      </ul>
      <div className="text-13" data-testid="booking-policy">
        {policy === undefined ? (
          <p className="text-ink-muted">Checking the cancellation policy…</p>
        ) : policy?.cardNeeded ? (
          <div className="flex flex-col gap-1.5">
            <Badge tone="warning">{policy.depositCents > 0 ? `Deposit needed: ${formatPrice(policy.depositCents)}` : "Card needed to hold this booking"}</Badge>
            {policy.phone ? (
              <label className="flex items-center gap-2 text-ink">
                <input type="checkbox" checked={cardLink} onChange={(e) => setCardLink(e.target.checked)} className={checkboxClass} />
                Text {firstOf(client.name)} a card link after booking
              </label>
            ) : (
              <p className="text-ink-muted">No mobile number on file: send the card link from the booking.</p>
            )}
          </div>
        ) : policy?.cardLabel ? (
          <p className="text-ink-muted">{policy.cardLabel} on file.</p>
        ) : (
          <p className="text-ink-muted">No card needed for this booking.</p>
        )}
      </div>
      {message && <Alert>{message}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={pending || policy === undefined} onClick={confirm}>
          {pending ? "Booking…" : "Confirm booking"}
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

// "Balayage with Bridget" for one line of a slot, from its "what".
function lineText(slot: BookingSlot, n: number): string {
  if (slot.lines.length === 1) return slot.what;
  const parts = slot.what.split(", then ");
  if (parts.length === slot.lines.length) return parts[n];
  // One stylist: "Balayage, then Women's Cut & Style with Bridget".
  const [services, stylist] = slot.what.split(" with ");
  return `${services.split(", then ")[n] ?? services} with ${stylist}`;
}

function WhichClient({ card, index }: { card: Extract<BookingCard, { kind: "which_client" }>; index: number }) {
  const { pending, error, next } = useNext(index);
  return (
    <section aria-label="Which client" className={cardClass} data-testid="booking-which">
      <ul className="flex flex-col gap-1.5">
        {card.matches.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() => next(card.request, c, `For ${c.name}.`)}
              className="flex min-h-11 w-full flex-col justify-center rounded-md border border-line px-3 py-2 text-left transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60"
            >
              <span className="font-medium text-ink">{c.name}</span>
              <span className="text-13 text-ink-muted">{[c.phone, c.lastVisit ? `last in ${c.lastVisit}` : "no visits yet"].filter(Boolean).join(" · ")}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <Alert>{error}</Alert>}
    </section>
  );
}

function NewClient({ card, index }: { card: Extract<BookingCard, { kind: "new_client" }>; index: number }) {
  const [fields, setFields] = useState({ firstName: card.firstName, lastName: card.lastName, phone: card.phone });
  const { pending, error, setError, next } = useNext(index);
  const [adding, start] = useTransition();
  const field = (key: keyof typeof fields, label: string, type = "text") => (
    <label className={labelClass}>
      {label}
      <input type={type} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} className={fieldClass} autoComplete="off" />
    </label>
  );
  return (
    <section aria-label="New client" className={cardClass} data-testid="booking-new-client">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await reach(addChatClient(fields));
            if (!r.ok) return setError(r.message);
            next(card.request, r.client, `Added ${r.client.name}.`);
          });
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          {field("firstName", "First name")}
          {field("lastName", "Last name")}
        </div>
        {field("phone", "Mobile", "tel")}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" variant="primary" size="sm" className="self-start" disabled={pending || adding}>
          Add client
        </Button>
      </form>
    </section>
  );
}

type Part = PartOfDay | "any";

// The form (without Denise, or when she needs to know more): client,
// service, stylist, day and time of day, searched the same way.
function BookingForm({ card, index, today }: { card: Extract<BookingCard, { kind: "form" }>; index: number; today: string }) {
  const [client, setClient] = useState<ClientOption | null>(card.client ? optionOf(card.client) : null);
  const [request, setRequest] = useState<PhoneRequest>(card.request);
  const singleDay = request.from === request.to;
  const { pending, error, setError, next } = useNext(index);
  const change = (patch: Partial<PhoneRequest>) => setRequest((r) => ({ ...r, ...patch }));
  const who = request.staffId ?? (request.level ? `level:${request.level}` : "anyone");
  return (
    <section aria-label="Booking form" className={cardClass} data-testid="booking-form">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!request.serviceIds.length) return setError("Choose a service.");
          next(request, client, client ? `Looking for ${firstOf(client.name)}.` : "Looking.");
        }}
      >
        <ClientPicker client={client} onChange={setClient} query={card.request.clientText ?? undefined} />
        <label className={labelClass}>
          Service
          <select value={request.serviceIds[0] ?? ""} onChange={(e) => change({ serviceIds: e.target.value ? [e.target.value, ...request.serviceIds.slice(1)] : request.serviceIds.slice(1) })} className={selectClass}>
            <option value="">Choose a service</option>
            {card.menu.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Stylist
          <select
            value={who}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "anyone") change({ staffId: null, level: null });
              else if (v.startsWith("level:")) change({ staffId: null, level: v.slice(6) as StaffLevel });
              else change({ staffId: v, level: null });
            }}
            className={selectClass}
          >
            <option value="anyone">Anyone</option>
            {STAFF_LEVELS.map((l) => (
              <option key={l} value={`level:${l}`}>
                Any {LEVEL_LABELS[l].toLowerCase()} stylist
              </option>
            ))}
            {card.menu.stylists.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Day
          <input
            type="date"
            min={today}
            value={singleDay ? request.from : ""}
            onChange={(e) => (e.target.value ? change({ from: e.target.value, to: e.target.value }) : change({ from: today, to: addDays(today, DEFAULT_DAYS - 1) }))}
            className={fieldClass}
          />
          <span className="text-xs font-normal text-ink-muted">{singleDay ? "Clear it for any day in the next two weeks." : "Any day in the next two weeks."}</span>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-13 font-medium text-ink">Time of day</span>
          <Segmented<Part>
            label="Time of day"
            value={request.part ?? "any"}
            onChange={(v) => change({ part: v === "any" ? null : v, after: null, before: null })}
            options={[
              { value: "any", label: "Any" },
              { value: "morning", label: "Morning" },
              { value: "afternoon", label: "Afternoon" },
              { value: "evening", label: "Evening" },
            ]}
          />
        </div>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" variant="primary" size="sm" className="self-start" disabled={pending}>
          {pending ? "Looking…" : "Find times"}
        </Button>
      </form>
    </section>
  );
}

// A link under her answer that opens the form on its own.
export function FormLink({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className={textLinkClass} onClick={onOpen}>
      Book with the form
    </button>
  );
}
