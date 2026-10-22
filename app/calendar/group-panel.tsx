"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { formatLongDay } from "@/lib/schedule-format";
import { MAX_GUESTS, staggered } from "@/lib/scheduling/groups";
import { formatMinute, minuteToTime, parseTime } from "@/lib/scheduling/time";
import { saveGroup, type ClientOption } from "./actions";
import { ClientPicker, type BookingStart } from "./booking-panel";
import type { BoardData } from "./types";

type Guest = { key: number; client: ClientOption | null; serviceId: string; staffId: string; startMinute: number | null };
type Timing = "together" | "staggered" | "custom";

let nextKey = 0;

// Several clients booked as one party: a shared name, each guest's service
// and stylist, all at once or staggered. Booked together or not at all.
export function GroupPanel({ data, start, onClose, onSaved }: { data: BoardData; start: BookingStart; onClose: () => void; onSaved: (appointmentId: string, message: string) => void }) {
  const offers = (staffId: string, serviceId: string) => serviceId in (data.menu.offers[staffId] ?? {});
  const services = data.menu.services.filter((s) => !s.archived);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [timing, setTiming] = useState<Timing>("together");
  const [first, setFirst] = useState<number | null>(start.startMinute);
  const [every, setEvery] = useState("30");
  const [guests, setGuests] = useState<Guest[]>(() => [
    { key: nextKey++, client: null, serviceId: "", staffId: start.staffId, startMinute: start.startMinute },
    { key: nextKey++, client: null, serviceId: "", staffId: data.columns.find((c) => c.working && c.staffId !== start.staffId)?.staffId ?? start.staffId, startMinute: start.startMinute },
  ]);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[][]>([]);
  const [pending, startTransition] = useTransition();

  // Each guest's start, from the timing.
  const starts = timing === "custom" ? guests.map((g) => g.startMinute) : first == null ? guests.map(() => null) : staggered(first, guests.length, timing === "staggered" ? Number(every) || 0 : 0);

  const update = (key: number, change: Partial<Guest>) =>
    setGuests((all) =>
      all.map((g) => {
        if (g.key !== key) return g;
        const next = { ...g, ...change };
        // A stylist who does the new service: theirs, or the first free one
        // not already with another guest.
        if (change.serviceId && !offers(next.staffId, change.serviceId)) {
          const taken = new Set(all.filter((o) => o.key !== key).map((o) => o.staffId));
          const able = data.columns.filter((c) => offers(c.staffId, change.serviceId!));
          next.staffId = (able.find((c) => c.working && !taken.has(c.staffId)) ?? able[0])?.staffId ?? next.staffId;
        }
        return next;
      }),
    );

  function addGuest() {
    const taken = new Set(guests.map((g) => g.staffId));
    const last = guests.at(-1)!;
    const staffId = data.columns.find((c) => c.working && !taken.has(c.staffId) && (!last.serviceId || offers(c.staffId, last.serviceId)))?.staffId ?? last.staffId;
    setGuests([...guests, { key: nextKey++, client: null, serviceId: last.serviceId, staffId, startMinute: last.startMinute }]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setErrors([]);
    if (guests.some((g, i) => !g.serviceId || starts[i] == null)) return setMessage("Choose a service and time for each guest.");
    startTransition(async () => {
      const r = await saveGroup({
        label,
        date: data.date,
        notes,
        guests: guests.map((g, i) => ({ clientId: g.client?.id ?? null, lines: [{ serviceId: g.serviceId, staffId: g.staffId, startMinute: starts[i]!, resource: "any" }] })),
      });
      if (r.ok) onSaved(r.appointmentId, r.message);
      else {
        setMessage(r.message);
        setErrors(r.guestErrors ?? []);
      }
    });
  }

  return (
    <form onSubmit={submit} aria-label="Group booking" className="flex flex-col gap-5 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-plum-900">Group booking</h2>
          <p className="text-ink-muted">{formatLongDay(data.date)}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {message && <Alert>{message}</Alert>}

      <label className={labelClass}>
        Group name
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="e.g. Ava's bridal party" className={fieldClass} />
      </label>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
        <legend className="px-1 font-medium text-ink">Timing</legend>
        <label className="flex items-center gap-2">
          First starts at
          <input type="time" step={300} value={first != null ? minuteToTime(first) : ""} onChange={(e) => setFirst(parseTime(e.target.value))} className={`${fieldClass} w-32!`} aria-label="First start" />
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="timing" checked={timing === "together"} onChange={() => setTiming("together")} />
          Everyone at the same time
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <input type="radio" name="timing" checked={timing === "staggered"} onChange={() => setTiming("staggered")} />
          Staggered, every
          <input
            type="number"
            min={5}
            step={5}
            value={every}
            onChange={(e) => {
              setEvery(e.target.value);
              setTiming("staggered");
            }}
            className={`${fieldClass} w-20!`}
            aria-label="Minutes between guests"
          />
          minutes
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="timing"
            checked={timing === "custom"}
            onChange={() => {
              setGuests(guests.map((g, i) => ({ ...g, startMinute: starts[i] })));
              setTiming("custom");
            }}
          />
          Set each guest&apos;s time
        </label>
      </fieldset>

      {guests.map((g, i) => (
        <fieldset key={g.key} aria-label={`Guest ${i + 1}`} className={`flex flex-col gap-3 rounded-lg border p-3 ${errors[i]?.length ? "border-danger" : "border-line"}`}>
          <legend className="flex w-full items-center justify-between px-1 font-medium text-ink">
            Guest {i + 1}
            {guests.length > 2 && (
              <button type="button" className="text-sm font-normal text-ink-muted hover:text-danger" onClick={() => setGuests(guests.filter((x) => x.key !== g.key))}>
                Remove
              </button>
            )}
          </legend>
          <ClientPicker client={g.client} onChange={(client) => update(g.key, { client })} />
          {!g.client && <p className="-mt-2 text-xs text-ink-muted">Optional: leave empty for a guest without a client record.</p>}
          <div className="grid grid-cols-2 gap-3">
            <label className={`${labelClass} col-span-2`}>
              Service
              <select value={g.serviceId} onChange={(e) => update(g.key, { serviceId: e.target.value })} className={selectClass}>
                <option value="">Choose a service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Stylist
              <select value={g.staffId} onChange={(e) => update(g.key, { staffId: e.target.value })} className={selectClass}>
                {data.columns
                  .filter((c) => !g.serviceId || offers(c.staffId, g.serviceId))
                  .map((c) => (
                    <option key={c.staffId} value={c.staffId}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            {timing === "custom" ? (
              <label className={labelClass}>
                Starts
                <input type="time" step={300} value={g.startMinute != null ? minuteToTime(g.startMinute) : ""} onChange={(e) => update(g.key, { startMinute: parseTime(e.target.value) })} className={fieldClass} />
              </label>
            ) : (
              <p className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                Starts
                <span className="py-2 font-normal text-ink-muted">{starts[i] != null ? formatMinute(starts[i]!) : "—"}</span>
              </p>
            )}
          </div>
          {errors[i]?.length > 0 && <p className="text-danger">{errors[i].join(" ")}</p>}
        </fieldset>
      ))}

      {guests.length < MAX_GUESTS && (
        <Button className="self-start" onClick={addGuest}>
          + Add a guest
        </Button>
      )}

      <label className={labelClass}>
        Notes for everyone (optional)
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={fieldClass} />
      </label>

      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? "Booking…" : `Book ${guests.length} guests`}
      </Button>
    </form>
  );
}
