"use client";

import { useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { MAX_NOTES, priceFor, visitSummary } from "@/lib/appointments";
import { parseClientSearch } from "@/lib/clients";
import { formatLongDay } from "@/lib/schedule-format";
import { formatMinute, minuteToTime, parseTime } from "@/lib/scheduling/time";
import { formatMinutes, formatPrice, sortCategories } from "@/lib/services";
import { findClients, quickAddClient, saveVisit, type ClientOption } from "./actions";
import type { AppointmentDetail, BoardData } from "./types";

export type BookingStart = { staffId: string; startMinute: number };

type Line = {
  key: number;
  id?: string;
  serviceId: string;
  staffId: string;
  startMinute: number | null;
  // "any", "none" or a resource id.
  resource: string;
};


// Books a new visit (from a clicked slot) or edits an existing one.
export function BookingPanel({
  data,
  start,
  appointment,
  onClose,
  onSaved,
  onBlockInstead,
}: {
  data: BoardData;
  start?: BookingStart;
  appointment?: AppointmentDetail;
  onClose: () => void;
  onSaved: (appointmentId: string) => void;
  // Switch to blocking this time (lunch, a meeting…) instead.
  onBlockInstead?: () => void;
}) {
  const { menu, columns } = data;
  const services = new Map(menu.services.map((s) => [s.id, s]));
  const original = new Map((appointment?.items ?? []).map((i) => [i.id, i]));
  const nextKey = useRef(1);

  const [client, setClient] = useState<ClientOption | null>(
    appointment?.client ? { id: appointment.client.id, name: appointment.client.name, phone: appointment.client.phone, allergies: appointment.client.allergies } : null,
  );
  const [lines, setLines] = useState<Line[]>(() =>
    appointment
      ? [...appointment.items]
          .sort((a, b) => a.start - b.start)
          .map((i, n) => ({ key: -1 - n, id: i.id, serviceId: i.serviceId, staffId: i.staffId, startMinute: i.start, resource: i.resourceId ?? "none" }))
      : [{ key: 0, serviceId: "", staffId: start!.staffId, startMinute: start!.startMinute, resource: "any" }],
  );
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<string[][]>([]);
  const [pending, startTransition] = useTransition();

  // Time and price for a line: an item that keeps its service keeps its
  // booked length, and its price unless the stylist changes.
  function lineInfo(l: Line) {
    const service = services.get(l.serviceId);
    if (!service) return null;
    const old = l.id ? original.get(l.id) : undefined;
    const keeps = old && old.serviceId === l.serviceId;
    return {
      minutes: keeps ? old.end - old.start : service.minutes,
      priceCents: keeps && old.staffId === l.staffId ? old.priceCents : priceFor(service.priceCents, menu.offers[l.staffId]?.[l.serviceId]),
    };
  }

  const summary = visitSummary(
    lines.flatMap((l) => {
      const info = lineInfo(l);
      return info && l.startMinute != null ? [{ startMinute: l.startMinute, ...info }] : [];
    }),
  );

  const update = (key: number, change: Partial<Line>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...change } : l)));

  function addLine() {
    const last = lines.at(-1)!;
    const info = lineInfo(last);
    setLines((all) => [
      ...all,
      {
        key: nextKey.current++,
        serviceId: "",
        staffId: last.staffId,
        // Straight after the previous service.
        startMinute: last.startMinute != null ? last.startMinute + (info?.minutes ?? 0) : null,
        resource: "any",
      },
    ]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLineErrors([]);
    startTransition(async () => {
      const result = await saveVisit({
        appointmentId: appointment?.id,
        date: data.date,
        clientId: client?.id ?? null,
        notes,
        lines: lines.map((l) => ({ id: l.id, serviceId: l.serviceId, staffId: l.staffId, startMinute: l.startMinute ?? -1, resource: l.resource })),
      });
      if (result.ok) onSaved(result.appointmentId);
      else {
        setMessage(result.message);
        setLineErrors(result.lineErrors ?? []);
      }
    });
  }

  return (
      <form onSubmit={submit} className="flex flex-col gap-5 py-2 text-sm" aria-label={appointment ? "Edit booking" : "New booking"}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-serif text-2xl font-semibold text-plum-900">{appointment ? "Edit booking" : "New booking"}</h2>
            <p className="text-ink-muted">{formatLongDay(data.date)}</p>
            {!appointment && onBlockInstead && (
              <button type="button" onClick={onBlockInstead} className="mt-1 text-sm font-medium text-plum-900 underline underline-offset-2 hover:text-plum-700">
                Block this time instead
              </button>
            )}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>

        {message && (
          <p role="alert" className="animate-fade-in rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
            {message}
          </p>
        )}

        <ClientPicker client={client} onChange={setClient} />

        {lines.map((l, n) => {
          const info = lineInfo(l);
          const offered = menu.offers[l.staffId] ?? {};
          const choices = menu.services.filter((s) => (s.id in offered && !s.archived) || s.id === l.serviceId);
          const errors = lineErrors[n] ?? [];
          return (
            <fieldset
              key={l.key}
              data-family={services.get(l.serviceId)?.family ?? "other"}
              className={`flex animate-fade-in flex-col gap-3 rounded-lg border border-l-4 border-l-(--fam-accent) bg-surface p-3 ${errors.length ? "border-danger/50" : "border-line"}`}
            >
              <legend className="px-1 font-semibold">Service {n + 1}</legend>
              <LabeledSelect label="Service" value={l.serviceId} onChange={(v) => update(l.key, { serviceId: v })}>
                <option value="">Choose a service</option>
                {sortCategories(new Set(choices.map((s) => s.category))).map((category) => (
                  <optgroup key={category} label={category}>
                    {choices
                      .filter((s) => s.category === category)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {!(s.id in offered) ? " (not offered)" : ""}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </LabeledSelect>
              <div className="grid grid-cols-2 gap-3">
                <LabeledSelect label="Stylist" value={l.staffId} onChange={(v) => update(l.key, { staffId: v })}>
                  {columns.map((c) => (
                    <option key={c.staffId} value={c.staffId}>
                      {c.name}
                    </option>
                  ))}
                </LabeledSelect>
                <label className={labelClass}>
                  Starts
                  <input
                    type="time"
                    step={300}
                    value={l.startMinute != null ? minuteToTime(l.startMinute) : ""}
                    onChange={(e) => update(l.key, { startMinute: parseTime(e.target.value) })}
                    required
                    className={fieldClass}
                  />
                </label>
              </div>
              <LabeledSelect label="Chair" value={l.resource} onChange={(v) => update(l.key, { resource: v })}>
                <option value="any">Any free chair</option>
                <option value="none">No chair</option>
                {menu.resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </LabeledSelect>
              <div className="flex items-center justify-between text-ink-muted">
                <span data-testid="line-summary">
                  {info && l.startMinute != null
                    ? `${formatMinute(l.startMinute)}–${formatMinute(l.startMinute + info.minutes)} · ${formatMinutes(info.minutes)} · ${formatPrice(info.priceCents)}`
                    : "Choose a service"}
                </span>
                {lines.length > 1 && (
                  <button type="button" className="font-medium text-ink-muted underline underline-offset-2 hover:text-ink" onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}>
                    Remove
                  </button>
                )}
              </div>
              {errors.length > 0 && (
                <ul className="list-disc pl-5 text-danger">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </fieldset>
          );
        })}

        <Button size="sm" className="self-start" onClick={addLine}>
          <PlusIcon className="size-4" />
          Add another service
        </Button>

        <label className={labelClass}>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={MAX_NOTES} className={fieldClass} />
        </label>

        <div className="flex items-center justify-between rounded-lg bg-plum-100 px-3 py-2.5 font-semibold text-plum-900" aria-live="polite" data-testid="visit-total">
          {summary ? (
            <>
              <span>
                {formatMinute(summary.start)}–{formatMinute(summary.end)} · {formatMinutes(summary.minutes)}
              </span>
              <span>{formatPrice(summary.priceCents)}</span>
            </>
          ) : (
            <span className="font-normal">Total: choose a service</span>
          )}
        </div>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="lg" className="flex-1" disabled={pending}>
            {pending ? "Saving…" : appointment ? "Save changes" : "Create booking"}
          </Button>
          <Button size="lg" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
  );
}

function LabeledSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className={labelClass}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        {children}
      </select>
    </label>
  );
}

const SEARCH_DELAY_MS = 200;

// Find an existing client by name or phone, or add a new one with just a
// name and phone.
export function ClientPicker({ client, onChange }: { client: ClientOption | null; onChange: (c: ClientOption | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientOption[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [fields, setFields] = useState({ firstName: "", lastName: "", phone: "" });
  const [errors, setErrors] = useState<{ first_name?: string; phone?: string; form?: string }>({});
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef("");

  if (client) {
    return (
      <section aria-label="Client" className="flex animate-fade-in flex-col gap-2 rounded-lg border border-line bg-sunken/50 p-3">
        <div className="flex items-center gap-3">
          <Avatar name={client.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{client.name}</div>
            {client.phone && <div className="text-ink-muted">{client.phone}</div>}
          </div>
          <button type="button" className="shrink-0 font-medium text-plum-900 underline underline-offset-2 hover:text-plum-700" onClick={() => onChange(null)}>
            Change client
          </button>
        </div>
        {client.allergies && <p className="rounded-md bg-danger-soft px-2 py-1 font-medium text-danger">Allergy: {client.allergies}</p>}
      </section>
    );
  }

  function search(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    latest.current = value;
    if (value.trim().length < 2) {
      setResults(null);
      return;
    }
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const found = await findClients(value);
        if (latest.current === value) setResults(found);
      });
    }, SEARCH_DELAY_MS);
  }

  if (adding) {
    return (
      <section aria-label="New client" className="flex animate-fade-in flex-col gap-3 rounded-lg border border-line bg-sunken/50 p-3">
        <h3 className="font-semibold">New client</h3>
        {errors.form && <p className="text-danger">{errors.form}</p>}
        <div className="grid grid-cols-2 gap-2">
          <label className={labelClass}>
            First name
            <input value={fields.firstName} onChange={(e) => setFields({ ...fields, firstName: e.target.value })} className={fieldClass} aria-invalid={!!errors.first_name} />
            {errors.first_name && <span className="font-normal text-danger">{errors.first_name}</span>}
          </label>
          <label className={labelClass}>
            Last name
            <input value={fields.lastName} onChange={(e) => setFields({ ...fields, lastName: e.target.value })} className={fieldClass} />
          </label>
        </div>
        <label className={labelClass}>
          Phone
          <input value={fields.phone} onChange={(e) => setFields({ ...fields, phone: e.target.value })} inputMode="tel" className={fieldClass} aria-invalid={!!errors.phone} />
          {errors.phone && <span className="font-normal text-danger">{errors.phone}</span>}
        </label>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await quickAddClient(fields);
                if (result.ok) onChange(result.client);
                else setErrors(result.errors);
              })
            }
          >
            {pending ? "Adding…" : "Add client"}
          </Button>
          <Button size="sm" onClick={() => setAdding(false)}>
            Back to search
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Client" className="flex flex-col gap-2">
      <label htmlFor="client-search" className="text-sm font-medium">
        Find a client
      </label>
      <input
        id="client-search"
        type="search"
        value={query}
        onChange={(e) => search(e.target.value)}
        placeholder="Search by name or phone"
        autoComplete="off"
        className={fieldClass}
      />
      {results && (
        <ul aria-label="Matching clients" className="animate-fade-in divide-y divide-line overflow-hidden rounded-lg border border-line">
          {results.length === 0 && <li className="px-3 py-2 text-ink-muted">No clients match.</li>}
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left transition-colors duration-(--motion-fast) hover:bg-sunken active:bg-plum-100" onClick={() => onChange(c)}>
                <span className="font-semibold">{c.name}</span>
                <span className="text-ink-muted">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="self-start font-medium text-plum-900 underline underline-offset-2 hover:text-plum-700"
        onClick={() => {
          // Start the form from what was searched for: a phone number or a name.
          const isPhone = parseClientSearch(query).kind === "phone";
          const [first = "", ...rest] = isPhone ? [] : query.trim().split(/\s+/);
          setFields({ firstName: first, lastName: rest.join(" "), phone: isPhone ? query.trim() : "" });
          setAdding(true);
        }}
      >
        New client
      </button>
    </section>
  );
}
