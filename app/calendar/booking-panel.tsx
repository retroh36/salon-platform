"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { MAX_NOTES, priceFor, visitSummary } from "@/lib/appointments";
import { parseClientSearch } from "@/lib/clients";
import { formatLongDay } from "@/lib/schedule-format";
import { formatMinute, minuteToTime, parseTime } from "@/lib/scheduling/time";
import { formatMinutes, formatPrice, sortCategories } from "@/lib/services";
import { DeniseFace } from "@/components/denise";
import type { BookingIdea, BookingIdeas } from "@/lib/denise/ideas";
import { packageFor, usesLeft, type ClientPackage } from "@/lib/packages";
import type { Scope } from "@/lib/scheduling/series";
import { clientPackagesFor, patchTestWarnings, findClients, previewSeries, quickAddClient, saveSeries, saveVisit, saveVisitScoped, type ClientOption, type SeriesPreviewVisit, type VisitInput } from "./actions";
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
  // This booking's own length (e.g. the stylist's usual time), if chosen.
  minutes?: number;
};


// Books a new visit (from a clicked slot) or edits an existing one.
export function BookingPanel({
  data,
  start,
  appointment,
  onClose,
  onSaved,
  onBlockInstead,
  onGroupInstead,
}: {
  data: BoardData;
  start?: BookingStart;
  appointment?: AppointmentDetail;
  onClose: () => void;
  onSaved: (appointmentId: string, message?: string) => void;
  // Switch to blocking this time (lunch, a meeting…) instead.
  onBlockInstead?: () => void;
  // Switch to booking several people as a group.
  onGroupInstead?: () => void;
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
  const [ideas, setIdeas] = useState<BookingIdeas | null>(null);
  const [pending, startTransition] = useTransition();
  // Repeating (new bookings), and the series' visits once checked; or, when
  // editing a series visit, which visits the change is for.
  const [repeat, setRepeat] = useState({ on: false, weeks: "4", endKind: "count" as "count" | "until", count: "6", until: "" });
  const [preview, setPreview] = useState<SeriesPreviewVisit[] | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<Scope>("this");

  // Time and price for a line: an item that keeps its service keeps its
  // booked length, and its price unless the stylist changes.
  function lineInfo(l: Line) {
    const service = services.get(l.serviceId);
    if (!service) return null;
    const old = l.id ? original.get(l.id) : undefined;
    const keeps = old && old.serviceId === l.serviceId;
    // The stylist's own length for a new service, if they have one.
    const usual = menu.timings[l.staffId]?.[l.serviceId] ?? service.minutes;
    return {
      minutes: l.minutes ?? (keeps ? old.end - old.start : usual),
      priceCents: keeps && old.staffId === l.staffId ? old.priceCents : priceFor(service.priceCents, menu.offers[l.staffId]?.[l.serviceId]),
    };
  }

  const summary = visitSummary(
    lines.flatMap((l) => {
      const info = lineInfo(l);
      return info && l.startMinute != null ? [{ startMinute: l.startMinute, ...info }] : [];
    }),
  );

  const update = (key: number, change: Partial<Line>) => {
    setPreview(null);
    // A different service or stylist starts from their length again.
    const reset = "serviceId" in change || "staffId" in change ? { minutes: undefined } : {};
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...reset, ...change } : l)));
  };
  const changeRepeat = (change: Partial<typeof repeat>) => {
    setPreview(null);
    setRepeat((r) => ({ ...r, ...change }));
  };

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

  const repeatInput = () => ({
    intervalWeeks: Number(repeat.weeks),
    end: repeat.endKind === "count" ? { kind: "count" as const, count: Number(repeat.count) } : { kind: "until" as const, until: repeat.until },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLineErrors([]);
    setIdeas(null);
    const input: VisitInput = {
      appointmentId: appointment?.id,
      date: data.date,
      clientId: client?.id ?? null,
      notes,
      lines: lines.map((l) => ({ id: l.id, serviceId: l.serviceId, staffId: l.staffId, startMinute: l.startMinute ?? -1, resource: l.resource, minutes: l.minutes })),
    };
    startTransition(async () => {
      // A new series: check every visit first, then book what staff chose.
      if (!appointment && repeat.on) {
        if (!preview) {
          if (!client) return setMessage("Choose a client, or add a new one.");
          const r = await previewSeries(input, repeatInput());
          if (!r.ok) return setMessage(r.message);
          setPreview(r.visits);
          setChoices(Object.fromEntries(r.visits.map((v) => [v.date, v.ok ? "planned" : v.alternatives.length ? "0" : "skip"])));
          return;
        }
        const visits = preview.flatMap((v) => {
          const c = choices[v.date];
          if (c === "skip") return [];
          if (c === "planned") return [{ date: v.date, lines: input.lines }];
          const alt = v.alternatives[Number(c)];
          return [{ date: alt.date, lines: alt.lines }];
        });
        const r = await saveSeries(input, repeatInput(), visits);
        if (r.ok) onSaved(r.appointmentId, r.message);
        else setMessage(r.message);
        return;
      }
      const result = appointment?.series && scope !== "this" ? await saveVisitScoped(input, scope) : await saveVisit(input);
      if (result.ok) onSaved(result.appointmentId, (result as { message?: string }).message);
      else {
        setMessage(result.message);
        setLineErrors(result.lineErrors ?? []);
        setIdeas(result.ideas ?? null);
      }
    });
  }

  const booking = preview?.filter((v) => choices[v.date] !== "skip").length ?? 0;

  // Patch tests: warn as soon as the client and a service that needs one
  // are chosen.
  const patchKey = JSON.stringify([client?.id, lines.map((l) => [l.serviceId, l.startMinute])]);
  const [patch, setPatch] = useState<{ key: string; messages: string[]; blocks: boolean } | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    patchTestWarnings(client.id, data.date, lines.filter((l) => l.serviceId && l.startMinute != null).map((l) => ({ serviceId: l.serviceId, startMinute: l.startMinute! }))).then(
      (r) => live && setPatch({ key: patchKey, ...r }),
    );
    return () => {
      live = false;
    };
    // patchKey covers the client and lines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchKey]);
  const patchNow = client && patch?.key === patchKey ? patch : null;

  // The client's packages: a booked service they have uses left for is
  // pointed out, and used at checkout.
  const [packages, setPackages] = useState<{ clientId: string; list: ClientPackage[] } | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    clientPackagesFor(client.id).then((list) => live && setPackages({ clientId: client.id, list }));
    return () => {
      live = false;
    };
  }, [client]);
  const clientPackages = client && packages?.clientId === client.id ? packages.list : [];

  return (
      <form onSubmit={submit} className="flex flex-col gap-5 py-2 text-sm" aria-label={appointment ? "Edit booking" : "New booking"}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-serif text-2xl font-semibold text-navy-900">{appointment ? "Edit booking" : "New booking"}</h2>
            <p className="text-ink-muted">{formatLongDay(data.date)}</p>
            {!appointment && (onBlockInstead || onGroupInstead) && (
              <p className="mt-1 flex flex-wrap gap-x-4">
                {onGroupInstead && (
                  <button type="button" onClick={onGroupInstead} className="text-sm font-medium text-link underline underline-offset-2 hover:text-link-hover">
                    Book a group instead
                  </button>
                )}
                {onBlockInstead && (
                  <button type="button" onClick={onBlockInstead} className="text-sm font-medium text-link underline underline-offset-2 hover:text-link-hover">
                    Block this time instead
                  </button>
                )}
              </p>
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

        {patchNow && patchNow.messages.length > 0 && (
          <p role="alert" data-testid="patch-warning" className={`rounded-md border px-3 py-2 ${patchNow.blocks ? "border-danger/30 bg-danger-soft text-danger" : "border-status-late-ink/25 bg-status-late-bg text-status-late-ink"}`}>
            <strong className="font-semibold">Patch test:</strong> {patchNow.messages.join(" ")}{" "}
            {patchNow.blocks ? "The salon requires a valid patch test, so this can't be booked yet." : "You can still book; check with the client."}
          </p>
        )}

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
              {info && (
                <UsualLength
                  learned={menu.learned[`${l.staffId}:${l.serviceId}`]}
                  stylist={columns.find((c) => c.staffId === l.staffId)?.firstName ?? "This stylist"}
                  minutes={info.minutes}
                  chosen={l.minutes !== undefined}
                  onUse={(minutes) => update(l.key, { minutes })}
                />
              )}
              {errors.length > 0 && (
                <ul className="list-disc pl-5 text-danger">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {(() => {
                const level = columns.find((c) => c.staffId === l.staffId)?.level ?? null;
                const offer = l.serviceId ? packageFor(clientPackages, l.serviceId, level) : null;
                return offer && client ? (
                  <p className="rounded-md bg-status-confirmed-bg px-2.5 py-1.5 text-status-confirmed-ink" data-testid="package-note">
                    {client.name.split(" ")[0]} has {usesLeft(offer.item)} on a package. It&apos;s used at checkout.
                  </p>
                ) : null;
              })()}
              {ideas?.line === n && (
                <IdeasCard
                  ideas={ideas}
                  onPick={(o) => {
                    update(l.key, { staffId: o.staffId, startMinute: o.startMinute });
                    setIdeas(null);
                    setLineErrors([]);
                    setMessage(null);
                  }}
                />
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

        <div className="flex items-center justify-between rounded-lg bg-navy-100 px-3 py-2.5 font-semibold text-navy-900" aria-live="polite" data-testid="visit-total">
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

        {!appointment && (
          <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3">
            <legend className="sr-only">Repeat</legend>
            <label className="flex items-center gap-2 font-medium text-ink">
              <input type="checkbox" className={checkboxClass} checked={repeat.on} onChange={(e) => changeRepeat({ on: e.target.checked })} />
              Repeat this visit
            </label>
            {repeat.on && (
              <div className="flex animate-fade-in flex-col gap-3">
                <label className="flex items-center gap-2">
                  Every
                  <input type="number" min={1} max={52} value={repeat.weeks} onChange={(e) => changeRepeat({ weeks: e.target.value })} className={`${fieldClass} w-20!`} aria-label="Weeks between visits" />
                  weeks, same stylist and services
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="series-end" checked={repeat.endKind === "count"} onChange={() => changeRepeat({ endKind: "count" })} />
                    For
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={52}
                    value={repeat.count}
                    onChange={(e) => changeRepeat({ count: e.target.value, endKind: "count" })}
                    className={`${fieldClass} w-20!`}
                    aria-label="Number of visits"
                  />
                  <span>visits</span>
                  <label className="ml-2 flex items-center gap-2">
                    <input type="radio" name="series-end" checked={repeat.endKind === "until"} onChange={() => changeRepeat({ endKind: "until" })} />
                    Until
                  </label>
                  <input
                    type="date"
                    value={repeat.until}
                    min={data.date}
                    onChange={(e) => changeRepeat({ until: e.target.value, endKind: "until" })}
                    className={`${fieldClass} w-40!`}
                    aria-label="Last date"
                  />
                </div>
              </div>
            )}
          </fieldset>
        )}

        {preview && (
          <section aria-label="Visits in the series" className="flex animate-fade-in flex-col gap-2">
            <p className="font-medium text-ink" data-testid="series-summary">
              {preview.filter((v) => v.ok).length} of {preview.length} visits fit as planned.
              {preview.some((v) => !v.ok) && " For the others, choose one of Denise's suggestions or skip that date."}
            </p>
            <ul className="flex flex-col gap-2">
              {preview.map((v) => (
                <li key={v.date} data-fits={v.ok || undefined} className={`rounded-lg border p-3 ${v.ok ? "border-line" : "border-denise-200 bg-denise-50"}`}>
                  <p className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{v.label}</span>
                    <span className={v.ok ? "text-status-confirmed-ink" : "text-danger"}>{v.ok ? "Fits" : "Doesn't fit"}</span>
                  </p>
                  {!v.ok && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      <p className="text-ink-muted">{v.problems.join(" ")}</p>
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-denise-700">
                        <DeniseFace size={18} />
                        {v.alternatives.length ? "Denise suggests:" : "Denise couldn't find another time nearby."}
                      </p>
                      {v.alternatives.map((a, i) => (
                        <label key={i} className="flex items-center gap-2">
                          <input type="radio" name={`alt-${v.date}`} checked={choices[v.date] === String(i)} onChange={() => setChoices({ ...choices, [v.date]: String(i) })} />
                          {a.label}
                        </label>
                      ))}
                      <label className="flex items-center gap-2">
                        <input type="radio" name={`alt-${v.date}`} checked={choices[v.date] === "skip"} onChange={() => setChoices({ ...choices, [v.date]: "skip" })} />
                        Skip this date
                      </label>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {appointment?.series && (
          <fieldset className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
            <legend className="px-1 font-medium text-ink">Change</legend>
            {(
              [
                ["this", "This visit only"],
                ["following", "This and following visits"],
                ["all", "All visits in the series"],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="edit-scope" checked={scope === v} onChange={() => setScope(v)} />
                {label}
              </label>
            ))}
          </fieldset>
        )}

        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="lg" className="flex-1" disabled={pending || (preview !== null && booking === 0)}>
            {pending ? "Saving…" : appointment ? "Save changes" : repeat.on ? (preview ? `Book ${booking} visit${booking === 1 ? "" : "s"}` : "Check dates") : "Create booking"}
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
          <button type="button" className="shrink-0 font-medium text-link underline underline-offset-2 hover:text-link-hover" onClick={() => onChange(null)}>
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
              <button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left transition-colors duration-(--motion-fast) hover:bg-sunken active:bg-navy-100" onClick={() => onChange(c)}>
                <span className="font-semibold">{c.name}</span>
                <span className="text-ink-muted">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="self-start font-medium text-link underline underline-offset-2 hover:text-link-hover"
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

// Denise's note when a service is booked shorter than the stylist usually
// takes: "Bridget usually takes 3h 1m for this (9 visits). Book 3h 5m?"
// Facts from what she's learned (lib/insights/); staff decide.
function UsualLength({
  learned,
  stylist,
  minutes,
  chosen,
  onUse,
}: {
  learned: { medianMinutes: number; visits: number } | undefined;
  stylist: string;
  minutes: number;
  chosen: boolean;
  onUse: (minutes: number) => void;
}) {
  if (!learned) return null;
  const suggested = Math.ceil(learned.medianMinutes / 5) * 5;
  if (learned.medianMinutes <= minutes + SHORT_BY) {
    return chosen ? (
      <p className="text-sm text-denise-700" data-testid="usual-length">
        Booked at {stylist}&rsquo;s usual length.
      </p>
    ) : null;
  }
  return (
    <div role="note" className="flex items-start gap-2 rounded-md border border-denise-200 bg-denise-50 px-2.5 py-2 text-sm text-denise-900" data-testid="usual-length">
      <DeniseFace size={22} />
      <p className="flex-1">
        This is shorter than {stylist} usually takes: {formatMinutes(learned.medianMinutes)} for this ({learned.visits} visits).{" "}
        <button type="button" className="font-semibold text-denise-700 underline underline-offset-2 hover:text-denise-900" onClick={() => onUse(suggested)}>
          Book {formatMinutes(suggested)}
        </button>
      </p>
    </div>
  );
}

// Warn when the booking is this many minutes shorter than usual.
const SHORT_BY = 5;

// Denise, when the rules refuse a time: why, and the nearest times that
// work (one click puts it in the form).
function IdeasCard({ ideas, onPick }: { ideas: BookingIdeas; onPick: (o: BookingIdea) => void }) {
  return (
    <section aria-label="Denise's suggestions" className="flex animate-fade-in gap-2.5 rounded-lg border border-denise-200 bg-denise-50 px-3 py-2.5" data-testid="denise-ideas">
      <DeniseFace size={24} className="mt-0.5" />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-denise-900">{ideas.text}</p>
        {ideas.options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {ideas.options.map((o) => (
              <button
                key={`${o.staffId}-${o.startMinute}`}
                type="button"
                onClick={() => onPick(o)}
                className="inline-flex h-8 items-center rounded-full border border-denise-200 bg-surface px-3 text-sm font-medium text-denise-900 transition-[background-color,border-color,transform] duration-(--motion-fast) hover:border-denise-500 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
