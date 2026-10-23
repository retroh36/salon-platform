"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClass } from "@/components/ui/button";
import { Eyebrow, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CalendarIcon, ClockIcon, GlobeIcon, HourglassIcon } from "@/components/ui/icons";
import { StatusChip } from "@/components/ui/status-chip";
import { ClientInsightCard } from "@/components/client-insight";
import { ServiceTimer } from "@/components/service-timer";
import { ACTION_LABELS, allowedActions, CANCEL_REASONS, canEditNotes, isEditable, MAX_NOTES, type AppointmentAction } from "@/lib/appointments";
import { formatLongDay } from "@/lib/schedule-format";
import { LATE_MINUTES } from "@/lib/scheduling/disruptions";
import { formatMinute, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { formatMinutes, formatPrice } from "@/lib/services";
import { UsageLinesEditor, toUsageJson, type DraftLine } from "@/components/usage-lines";
import type { PickerProduct } from "@/lib/inventory-load";
import { addVisitFormula, changeGroupVisitStatus, changeVisitStatus, changeVisitStatusScoped, saveVisitNotes } from "./actions";
import type { Scope } from "@/lib/scheduling/series";
import { useNow } from "./now-line";
import type { AppointmentDetail, BoardData } from "./types";

export function AppointmentPanel({
  date,
  today,
  timeZone,
  appointment,
  me,
  onEdit,
  onClose,
  onReportLate,
  onCanceled,
  onCheckout,
  onOpenVisit,
  products,
}: {
  date: LocalDate;
  today: LocalDate;
  products: PickerProduct[];
  timeZone: string;
  appointment: AppointmentDetail;
  me: BoardData["me"];
  onEdit: () => void;
  onClose: () => void;
  // Tell Denise: she takes it from here in her panel.
  onReportLate: (itemId: string, minutes: number) => void;
  onCanceled: (appointmentId: string) => void;
  // Opens the checkout (services, products, tips and payments).
  onCheckout: () => void;
  // Open another guest's visit in the same group.
  onOpenVisit: (appointmentId: string) => void;
}) {
  const { client, items, status } = appointment;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);

  const start = Math.min(...items.map((i) => i.start));
  const end = Math.max(...items.map((i) => i.end));
  const total = items.reduce((sum, i) => sum + i.priceCents, 0);
  const notesEditable = canEditNotes(me.role, me.staffId, items.map((i) => i.staffId));
  const actions = me.canBook ? allowedActions(status) : [];
  const primaryAction = actions.find((a) => a === "check_in" || a === "check_out");
  // The front of house, or a stylist on the visit, can say it's running late.
  const canReportLate = date >= today && isEditable(status) && (me.canBook || items.some((i) => i.staffId === me.staffId));
  const [reportingLate, setReportingLate] = useState(false);
  // On the day (or after): the front of house, or a stylist on the visit.
  const canRecordFormula = date <= today && status !== "canceled" && status !== "no_show" && (me.canBook || items.some((i) => i.staffId === me.staffId));

  function run(action: AppointmentAction, reason = "", detail = "", scope: Scope | "group" = "this") {
    setMessage(null);
    startTransition(async () => {
      const result =
        scope === "this"
          ? await changeVisitStatus(appointment.id, action, reason, detail)
          : scope === "group"
            ? await changeGroupVisitStatus(appointment.id, action, reason, detail)
            : await changeVisitStatusScoped(appointment.id, action, scope, reason, detail);
      if (!result.ok) setMessage(result.message);
      else if (action === "cancel") {
        // Canceled visits leave the calendar; Denise looks at the time freed.
        onClose();
        onCanceled(appointment.id);
      }
      else setCanceling(false);
    });
  }

  return (
    <div className="flex flex-col gap-5 py-2 text-sm">
      <div className="flex items-center gap-4">
        <Avatar name={client?.name ?? appointment.group?.label ?? "Walk in"} size="lg" />
        <div className="min-w-0">
          <h3 className="truncate font-serif text-xl font-semibold" data-testid="client-name">
            {client?.name ?? (appointment.group ? `${appointment.group.label} guest` : "Walk-in")}
          </h3>
          {client?.phone && <p className="text-ink-muted">{client.phone}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusChip status={status} />
            {appointment.online && (
              <span data-testid="online-badge" className="flex items-center gap-1 text-ink-muted">
                <GlobeIcon className="size-4" />
                Booked online
              </span>
            )}
          </div>
          {appointment.series && (
            <p className="mt-1.5 flex items-center gap-1.5 text-ink-muted" data-testid="series-info">
              <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.6L4 16M4 20v-4h4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Visit {appointment.series.index} of {appointment.series.count} · every {appointment.series.intervalWeeks === 1 ? "week" : `${appointment.series.intervalWeeks} weeks`}
            </p>
          )}
        </div>
      </div>

      {appointment.insight && <ClientInsightCard insight={appointment.insight} />}

      {appointment.group && (
        <div className="rounded-lg border border-navy-200 bg-navy-100/40 px-2.5 py-2" data-testid="group-info">
          <p className="font-semibold text-navy-900">
            {appointment.group.label} · {appointment.group.members.length} guest{appointment.group.members.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5" aria-label="Guests in this group">
            {appointment.group.members.map((m) => (
              <li key={m.appointmentId}>
                {m.appointmentId === appointment.id ? (
                  <span className="text-ink">
                    {m.clientName} · {m.staffName} · {formatMinute(m.start)} (this visit)
                  </span>
                ) : (
                  <button type="button" className="text-left text-link underline-offset-2 hover:underline" onClick={() => onOpenVisit(m.appointmentId)}>
                    {m.clientName} · {m.staffName} · {formatMinute(m.start)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-danger">
          {message}
        </p>
      )}

      <dl className="flex flex-col gap-3 border-y border-line py-4">
        <div className="flex items-center gap-3">
          <dt className="sr-only">Date</dt>
          <CalendarIcon className="size-5 text-ink-muted" />
          <dd>{formatLongDay(date, false)}</dd>
        </div>
        <div className="flex items-start gap-3">
          <dt className="sr-only">Time</dt>
          <ClockIcon className="size-5 text-ink-muted" />
          <dd>
            {formatMinute(start)}–{formatMinute(end)}
            <span className="block text-ink-muted">{formatMinutes(end - start)}</span>
          </dd>
        </div>
      </dl>

      {client?.allergies && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 font-medium text-danger">Allergy: {client.allergies}</p>}

      <section aria-label="Services" className="flex flex-col gap-3">
        <Eyebrow>{items.length > 1 ? "Services" : "Service"}</Eyebrow>
        <ul className="flex flex-col gap-3">
          {items.map((i) => (
            <li key={i.id} className="flex flex-col gap-2" data-item-id={i.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{i.serviceName}</div>
                  <div className="text-ink-muted">
                    With {i.staffName} · {formatMinute(i.start)}–{formatMinute(i.end)}
                    {i.resourceName && ` · ${i.resourceName}`}
                  </div>
                </div>
                <span className="tabular-nums">{formatPrice(i.priceCents)}</span>
              </div>
              {/* Actual times, on the day: the stylist doing it or the front desk. */}
              {date === today && status !== "canceled" && status !== "no_show" && (
                <ServiceTimer
                  itemId={i.id}
                  times={i.times}
                  hasProcessing={i.processingMinutes > 0}
                  bookedMinutes={i.bookedMinutes}
                  canRecord={(me.canBook || i.staffId === me.staffId) && (status !== "completed" || i.times.startedAt !== null)}
                />
              )}
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-line pt-3 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(total)}</span>
        </div>
      </section>

      {client?.preferences && (
        <section aria-label="Preferences" className="flex flex-col gap-1.5">
          <Eyebrow>Client preferences</Eyebrow>
          <p>{client.preferences}</p>
        </section>
      )}

      {(appointment.formulas.length > 0 || (canRecordFormula && client)) && (
        <FormulaSection appointment={appointment} date={date} products={products} canRecord={canRecordFormula && Boolean(client)} />
      )}

      <NotesForm key={appointment.notes} appointmentId={appointment.id} initial={appointment.notes} editable={notesEditable} />

      {appointment.warnings && client && (
        <section aria-label="Before this visit" className="flex flex-col gap-2 rounded-lg border border-status-late-ink/25 bg-status-late-bg px-3 py-2.5 text-status-late-ink">
          <p className="font-semibold">{status === "checked_in" ? "Still to do for this visit" : "Before check-in"}</p>
          {appointment.warnings.patch.map((m) => (
            <p key={m}>
              {m}
              {appointment.warnings!.patchBlocks ? " The salon requires one for this service." : ""}
            </p>
          ))}
          {appointment.warnings.forms.map((f) => (
            <p key={f.templateId} className="flex flex-wrap items-center justify-between gap-2">
              <span>{f.name} isn&apos;t signed yet.</span>
              <Link
                href={`/clients/${client.id}/forms/new?template=${f.templateId}&back=${encodeURIComponent(`/calendar?date=${date}`)}`}
                className="font-semibold underline underline-offset-2"
              >
                Fill it in now
              </Link>
            </p>
          ))}
        </section>
      )}

      {(actions.length > 0 || (me.canBook && isEditable(status)) || canReportLate) && (
        <section aria-label="Actions" className="flex flex-col gap-2">
          {primaryAction && (
            <Button variant="primary" size="lg" disabled={pending} onClick={() => (primaryAction === "check_out" ? onCheckout() : run(primaryAction))}>
              {ACTION_LABELS[primaryAction]}
            </Button>
          )}
          {canReportLate &&
            (reportingLate ? (
              <RunningLateForm
                appointment={appointment}
                date={date}
                timeZone={timeZone}
                onReport={(itemId, minutes) => {
                  setReportingLate(false);
                  onReportLate(itemId, minutes);
                }}
                onCancel={() => setReportingLate(false)}
              />
            ) : (
              <Button size="lg" disabled={pending} onClick={() => setReportingLate(true)}>
                <HourglassIcon className="size-4 text-ink-muted" />
                Running late
              </Button>
            ))}
          {me.canBook && isEditable(status) && (
            <Button size="lg" disabled={pending} onClick={onEdit}>
              Edit booking
            </Button>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {actions.includes("no_show") && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run("no_show")}>
                {ACTION_LABELS.no_show}
              </Button>
            )}
            {actions.includes("cancel") && !canceling && (
              <Button variant="ghost" size="sm" className="text-danger" disabled={pending} onClick={() => setCanceling(true)}>
                {ACTION_LABELS.cancel}
              </Button>
            )}
          </div>
          {canceling && (
            <CancelForm
              pending={pending}
              series={Boolean(appointment.series)}
              group={Boolean(appointment.group)}
              onCancel={(reason, detail, scope) => run("cancel", reason, detail, scope)}
              onKeep={() => setCanceling(false)}
            />
          )}
        </section>
      )}

      {client && (
        <Link href={`/clients/${client.id}`} className="self-center font-medium text-link underline underline-offset-2 hover:text-link-hover">
          View client profile
        </Link>
      )}

      <p className="text-xs text-ink-muted">
        {appointment.bookedBy}
        {appointment.changedBy && (
          <>
            <br />
            {appointment.changedBy}
          </>
        )}
      </p>
    </div>
  );
}

function NotesForm({ appointmentId, initial, editable }: { appointmentId: string; initial: string; editable: boolean }) {
  const [notes, setNotes] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);

  if (!editable) {
    return (
      <section aria-label="Notes" className="flex flex-col gap-1.5">
        <Eyebrow>Notes</Eyebrow>
        <p className={`rounded-md bg-sunken px-3 py-2 whitespace-pre-wrap ${initial ? "" : "text-ink-muted"}`}>{initial || "No notes."}</p>
      </section>
    );
  }

  return (
    <form
      aria-label="Notes"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        startTransition(async () => {
          const r = await saveVisitNotes(appointmentId, notes);
          setResult(r.ok ? { text: "Notes saved.", error: false } : { text: r.message, error: true });
        });
      }}
    >
      <label htmlFor="appointment-notes" className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
        Notes
      </label>
      <textarea
        id="appointment-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={MAX_NOTES}
        rows={3}
        placeholder="Anything the stylist should know"
        className={`${fieldClass} bg-sunken/60`}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || notes === initial}>
          {pending ? "Saving…" : "Save notes"}
        </Button>
        {result && (
          <span role={result.error ? "alert" : "status"} className={`animate-fade-in ${result.error ? "text-danger" : "text-status-confirmed-ink"}`}>
            {result.text}
          </span>
        )}
      </div>
    </form>
  );
}

function CancelForm({
  pending,
  series,
  group,
  onCancel,
  onKeep,
}: {
  pending: boolean;
  series: boolean;
  group: boolean;
  onCancel: (reason: string, detail: string, scope: Scope | "group") => void;
  onKeep: () => void;
}) {
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [scope, setScope] = useState<Scope | "group">("this");
  return (
    <form
      aria-label="Cancel booking"
      className="flex animate-fade-in flex-col gap-3 rounded-lg border border-danger/30 bg-danger-soft/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onCancel(reason, detail, scope);
      }}
    >
      <label className={labelClass}>
        Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)} required className={selectClass}>
          <option value="">Choose a reason</option>
          {CANCEL_REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        <span>
          Details {reason !== "Other" && <span className="font-normal text-ink-muted">(optional)</span>}
        </span>
        <input value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={300} className={fieldClass} />
      </label>
      {(series || group) && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium text-ink">Cancel</legend>
          {(
            [
              ["this", "This visit only"],
              ...(group ? [["group", "The whole group"] as const] : []),
              ...(series
                ? [
                    ["following", "This and following visits"] as const,
                    ["all", "All visits in the series"] as const,
                  ]
                : []),
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="cancel-scope" checked={scope === v} onChange={() => setScope(v)} />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass("danger", "md")} disabled={pending}>
          Cancel booking
        </button>
        <Button onClick={onKeep} disabled={pending}>
          Keep it
        </Button>
      </div>
    </form>
  );
}

// "Running late": for a client who's checked in, the visit is running over
// (and the stylist is behind); otherwise, the client is late. Denise then
// works out what that means for the rest of the day.
function RunningLateForm({
  appointment,
  date,
  timeZone,
  onReport,
  onCancel,
}: {
  appointment: AppointmentDetail;
  date: LocalDate;
  timeZone: string;
  onReport: (itemId: string, minutes: number) => void;
  onCancel: () => void;
}) {
  const now = useNow();
  const checkedIn = appointment.status === "checked_in";
  const items = [...appointment.items].sort((a, b) => a.start - b.start);
  // Running over: the service under way (or the last one started).
  const nowMinute = now !== null && toLocal(new Date(now), timeZone).date === date ? toLocal(new Date(now), timeZone).minute : null;
  const current = nowMinute === null ? items[0] : (items.filter((i) => i.start <= nowMinute).at(-1) ?? items[0]);
  const [itemId, setItemId] = useState(current.id);
  const [minutes, setMinutes] = useState<number | null>(null);
  const firstName = appointment.client?.name.split(" ")[0] ?? "the client";

  return (
    <form
      aria-label="Running late"
      className="flex animate-fade-in flex-col gap-3 rounded-lg border border-line-strong bg-sunken/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!minutes) return;
        onReport(checkedIn ? itemId : items[0].id, minutes);
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold text-ink">{checkedIn ? "How far over is this running?" : `How late is ${firstName}?`}</legend>
        <div className="flex flex-wrap gap-1.5">
          {LATE_MINUTES.map((m) => (
            <label key={m} className="cursor-pointer">
              <input type="radio" name="late-minutes" value={m} checked={minutes === m} onChange={() => setMinutes(m)} className="peer sr-only" />
              <span className="inline-flex h-8 items-center rounded-full border border-line-strong bg-surface px-3 text-sm transition-colors duration-(--motion-fast) peer-checked:border-navy-900 peer-checked:bg-navy-900 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus hover:bg-sunken peer-checked:hover:bg-navy-800">
                {m} min
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {checkedIn && items.length > 1 && (
        <label className={labelClass}>
          Which service is running over?
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={selectClass}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.serviceName} with {i.staffName.split(" ")[0]}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!minutes}>
          Tell Denise
        </Button>
        <Button onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// The visit's color formulas, and recording one with the products used:
// they're taken from stock when the visit is checked out.
function FormulaSection({ appointment, date, products, canRecord }: { appointment: AppointmentDetail; date: LocalDate; products: PickerProduct[]; canRecord: boolean }) {
  const items = [...appointment.items].sort((a, b) => a.start - b.start);
  const [adding, setAdding] = useState(false);
  const [itemId, setItemId] = useState(items[0].id);
  const [lines, setLines] = useState<DraftLine[]>([{ productId: "", amount: "" }]);
  const [formula, setFormula] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const serviceOf = (id: string) => items.find((i) => i.id === id)?.serviceName ?? "";

  return (
    <section aria-label="Color formula" className="flex flex-col gap-2">
      <Eyebrow>Color formula</Eyebrow>
      {appointment.formulas.map((f) => (
        <div key={f.id} className="rounded-md border-l-4 border-peach-accent bg-peach-fill/40 px-3 py-2">
          <p className="text-xs text-ink-muted">
            {serviceOf(f.itemId)} · {f.author}
          </p>
          {f.products && <p className="font-medium text-ink" data-testid="visit-formula-products">{f.products}</p>}
          {f.text !== f.products && <p className="font-mono text-xs whitespace-pre-line text-ink">{f.text}</p>}
          {f.notes && <p className="text-xs text-ink-muted">{f.notes}</p>}
        </div>
      ))}
      {result && (
        <p role={result.error ? "alert" : "status"} className={`animate-fade-in ${result.error ? "text-danger" : "font-medium text-status-confirmed-ink"}`}>
          {result.text}
        </p>
      )}
      {canRecord &&
        (adding ? (
          <form
            aria-label="Record formula"
            className="flex animate-fade-in flex-col gap-3 rounded-lg border border-line-strong bg-sunken/60 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setResult(null);
              startTransition(async () => {
                const r = await addVisitFormula({ itemId, date, formula, notes, lines: toUsageJson(lines) });
                if (!r.ok) return setResult({ text: r.message, error: true });
                setResult({ text: appointment.status === "completed" ? "Formula saved, and stock updated." : "Formula saved. Stock is taken at checkout.", error: false });
                setAdding(false);
                setLines([{ productId: "", amount: "" }]);
                setFormula("");
                setNotes("");
              });
            }}
          >
            {items.length > 1 && (
              <label className={labelClass}>
                Service
                <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={selectClass}>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.serviceName} with {i.staffName.split(" ")[0]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <UsageLinesEditor products={products} lines={lines} onChange={setLines} label="Products and amounts" />
            <label className={labelClass}>
              <span>
                Formula <span className="font-normal text-ink-muted">(optional: the products are the formula)</span>
              </span>
              <textarea value={formula} onChange={(e) => setFormula(e.target.value)} rows={2} maxLength={2000} placeholder="e.g. Roots 6N + 6NN (1:1), 35 min" className={fieldClass} />
            </label>
            <label className={labelClass}>
              <span>
                Notes <span className="font-normal text-ink-muted">(optional)</span>
              </span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className={fieldClass} />
            </label>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Saving…" : "Save formula"}
              </Button>
              <Button onClick={() => setAdding(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" className="self-start" onClick={() => setAdding(true)}>
            {appointment.formulas.length ? "Record another formula" : "Record formula"}
          </Button>
        ))}
    </section>
  );
}
