"use client";

import { useRef, useState, useTransition } from "react";
import { Drawer } from "@/components/drawer";
import { inputClass } from "@/components/form";
import { MAX_NOTES, priceFor, visitSummary } from "@/lib/appointments";
import { parseClientSearch } from "@/lib/clients";
import { formatDay } from "@/lib/schedule-format";
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

const small = "rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-60";

// Books a new visit (from a clicked slot) or edits an existing one.
export function BookingPanel({
  data,
  start,
  appointment,
  onClose,
  onSaved,
}: {
  data: BoardData;
  start?: BookingStart;
  appointment?: AppointmentDetail;
  onClose: () => void;
  onSaved: (appointmentId: string) => void;
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
    <Drawer title={appointment ? "Edit appointment" : "New appointment"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5 text-sm" aria-label={appointment ? "Edit appointment" : "New appointment"}>
        <p className="text-neutral-600">{formatDay(data.date, true)}</p>

        {message && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
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
            <fieldset key={l.key} className={`flex flex-col gap-3 rounded-lg border p-3 ${errors.length ? "border-red-300" : "border-neutral-200"}`}>
              <legend className="px-1 font-medium">Service {n + 1}</legend>
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
                <label className="flex flex-col gap-1 font-medium">
                  Starts
                  <input
                    type="time"
                    step={300}
                    value={l.startMinute != null ? minuteToTime(l.startMinute) : ""}
                    onChange={(e) => update(l.key, { startMinute: parseTime(e.target.value) })}
                    required
                    className={inputClass}
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
              <div className="flex items-center justify-between text-neutral-600">
                <span data-testid="line-summary">
                  {info && l.startMinute != null
                    ? `${formatMinute(l.startMinute)}–${formatMinute(l.startMinute + info.minutes)} · ${formatMinutes(info.minutes)} · ${formatPrice(info.priceCents)}`
                    : "Choose a service"}
                </span>
                {lines.length > 1 && (
                  <button type="button" className="text-neutral-500 underline hover:text-neutral-900" onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}>
                    Remove
                  </button>
                )}
              </div>
              {errors.length > 0 && (
                <ul className="list-disc pl-5 text-red-700">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </fieldset>
          );
        })}

        <button type="button" className={`${small} self-start`} onClick={addLine}>
          Add another service
        </button>

        <label className="flex flex-col gap-1 font-medium">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={MAX_NOTES} className={inputClass} />
        </label>

        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 font-medium" aria-live="polite" data-testid="visit-total">
          {summary ? (
            <>
              <span>
                {formatMinute(summary.start)}–{formatMinute(summary.end)} · {formatMinutes(summary.minutes)}
              </span>
              <span>{formatPrice(summary.priceCents)}</span>
            </>
          ) : (
            <span className="text-neutral-500">Total: choose a service</span>
          )}
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={pending} className="rounded-md bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-700 disabled:opacity-60">
            {pending ? "Saving…" : appointment ? "Save changes" : "Book appointment"}
          </button>
          <button type="button" className={small} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Drawer>
  );
}

function LabeledSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 font-medium">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {children}
      </select>
    </label>
  );
}

const SEARCH_DELAY_MS = 200;

// Find an existing client by name or phone, or add a new one with just a
// name and phone.
function ClientPicker({ client, onChange }: { client: ClientOption | null; onChange: (c: ClientOption | null) => void }) {
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
      <section aria-label="Client" className="rounded-lg border border-neutral-200 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">{client.name}</div>
            {client.phone && <div className="text-neutral-500">{client.phone}</div>}
          </div>
          <button type="button" className="text-neutral-500 underline hover:text-neutral-900" onClick={() => onChange(null)}>
            Change client
          </button>
        </div>
        {client.allergies && <p className="mt-2 rounded-md bg-red-50 px-2 py-1 font-medium text-red-700">Allergy: {client.allergies}</p>}
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
      <section aria-label="New client" className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
        <h3 className="font-medium">New client</h3>
        {errors.form && <p className="text-red-700">{errors.form}</p>}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 font-medium">
            First name
            <input value={fields.firstName} onChange={(e) => setFields({ ...fields, firstName: e.target.value })} className={inputClass} aria-invalid={!!errors.first_name} />
            {errors.first_name && <span className="font-normal text-red-700">{errors.first_name}</span>}
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Last name
            <input value={fields.lastName} onChange={(e) => setFields({ ...fields, lastName: e.target.value })} className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-1 font-medium">
          Phone
          <input value={fields.phone} onChange={(e) => setFields({ ...fields, phone: e.target.value })} inputMode="tel" className={inputClass} aria-invalid={!!errors.phone} />
          {errors.phone && <span className="font-normal text-red-700">{errors.phone}</span>}
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            className={small}
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
          </button>
          <button type="button" className={small} onClick={() => setAdding(false)}>
            Back to search
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Client" className="flex flex-col gap-2">
      <label htmlFor="client-search" className="font-medium">
        Find a client
      </label>
      <input
        id="client-search"
        type="search"
        value={query}
        onChange={(e) => search(e.target.value)}
        placeholder="Search by name or phone"
        autoComplete="off"
        className={inputClass}
      />
      {results && (
        <ul aria-label="Matching clients" className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {results.length === 0 && <li className="px-3 py-2 text-neutral-500">No clients match.</li>}
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left hover:bg-neutral-50" onClick={() => onChange(c)}>
                <span className="font-medium">{c.name}</span>
                <span className="text-neutral-500">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="self-start text-neutral-600 underline hover:text-neutral-900"
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
