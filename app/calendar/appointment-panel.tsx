"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { Eyebrow, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CalendarIcon, ClockIcon, CloseIcon } from "@/components/ui/icons";
import { StatusChip } from "@/components/ui/status-chip";
import { ACTION_LABELS, allowedActions, CANCEL_REASONS, canEditNotes, isEditable, MAX_NOTES, type AppointmentAction } from "@/lib/appointments";
import { formatLongDay } from "@/lib/schedule-format";
import { formatMinute, type LocalDate } from "@/lib/scheduling/time";
import { formatMinutes, formatPrice } from "@/lib/services";
import { changeVisitStatus, saveVisitNotes } from "./actions";
import type { AppointmentDetail, BoardData } from "./types";

export function AppointmentPanel({
  date,
  appointment,
  me,
  onEdit,
  onClose,
}: {
  date: LocalDate;
  appointment: AppointmentDetail;
  me: BoardData["me"];
  onEdit: () => void;
  onClose: () => void;
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

  function run(action: AppointmentAction, reason = "", detail = "") {
    setMessage(null);
    startTransition(async () => {
      const result = await changeVisitStatus(appointment.id, action, reason, detail);
      if (!result.ok) setMessage(result.message);
      else if (action === "cancel") onClose(); // canceled visits leave the calendar
      else setCanceling(false);
    });
  }

  return (
    <div className="flex flex-col gap-5 py-2 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-2xl font-semibold text-plum-900">Booking details</h2>
        <IconButton label="Close booking details" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      <div className="flex items-center gap-4">
        <Avatar name={client?.name ?? "Walk in"} size="lg" />
        <div className="min-w-0">
          <h3 className="truncate font-serif text-xl font-semibold" data-testid="client-name">
            {client?.name ?? "Walk-in"}
          </h3>
          {client?.phone && <p className="text-ink-muted">{client.phone}</p>}
          <StatusChip status={status} className="mt-1.5" />
        </div>
      </div>

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
            <li key={i.id} className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{i.serviceName}</div>
                <div className="text-ink-muted">
                  With {i.staffName} · {formatMinute(i.start)}–{formatMinute(i.end)}
                  {i.resourceName && ` · ${i.resourceName}`}
                </div>
              </div>
              <span className="tabular-nums">{formatPrice(i.priceCents)}</span>
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

      <NotesForm key={appointment.notes} appointmentId={appointment.id} initial={appointment.notes} editable={notesEditable} />

      {(actions.length > 0 || (me.canBook && isEditable(status))) && (
        <section aria-label="Actions" className="flex flex-col gap-2">
          {primaryAction && (
            <Button variant="primary" size="lg" disabled={pending} onClick={() => run(primaryAction)}>
              {ACTION_LABELS[primaryAction]}
            </Button>
          )}
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
          {canceling && <CancelForm pending={pending} onCancel={(reason, detail) => run("cancel", reason, detail)} onKeep={() => setCanceling(false)} />}
        </section>
      )}

      {client && (
        <Link href={`/clients/${client.id}`} className="self-center font-medium text-plum-900 underline underline-offset-2 hover:text-plum-700">
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

function CancelForm({ pending, onCancel, onKeep }: { pending: boolean; onCancel: (reason: string, detail: string) => void; onKeep: () => void }) {
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  return (
    <form
      aria-label="Cancel booking"
      className="flex animate-fade-in flex-col gap-3 rounded-lg border border-danger/30 bg-danger-soft/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onCancel(reason, detail);
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
