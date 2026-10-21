"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Drawer } from "@/components/drawer";
import { inputClass } from "@/components/form";
import {
  ACTION_LABELS,
  allowedActions,
  CANCEL_REASONS,
  canEditNotes,
  isEditable,
  MAX_NOTES,
  STATUS_LABELS,
  type AppointmentAction,
} from "@/lib/appointments";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, type LocalDate } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { changeVisitStatus, saveVisitNotes } from "./actions";
import type { AppointmentDetail, BoardData } from "./types";

const button = "rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-60";
const primary = "rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60";

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
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [canceling, setCanceling] = useState(false);

  const start = Math.min(...items.map((i) => i.start));
  const end = Math.max(...items.map((i) => i.end));
  const total = items.reduce((sum, i) => sum + i.priceCents, 0);
  const notesEditable = canEditNotes(me.role, me.staffId, items.map((i) => i.staffId));

  function run(action: AppointmentAction, reason = "", detail = "") {
    setMessage(null);
    startTransition(async () => {
      const result = await changeVisitStatus(appointment.id, action, reason, detail);
      if (!result.ok) setMessage({ text: result.message, error: true });
      else if (action === "cancel") onClose(); // canceled visits leave the calendar
      else setCanceling(false);
    });
  }

  return (
    <Drawer title={client?.name ?? "Walk-in"} onClose={onClose}>
      <div className="flex flex-col gap-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700" data-status={status}>
            {STATUS_LABELS[status]}
          </span>
          <span>
            {formatDay(date)} · {formatMinute(start)}–{formatMinute(end)}
          </span>
        </div>

        {message && (
          <p role={message.error ? "alert" : "status"} className={message.error ? "rounded-md bg-red-50 px-3 py-2 text-red-700" : "text-green-700"}>
            {message.text}
          </p>
        )}

        {client && (
          <section aria-label="Client">
            {client.allergies && <p className="mb-2 rounded-md bg-red-50 px-3 py-2 font-medium text-red-700">Allergy: {client.allergies}</p>}
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
              {client.phone && (
                <>
                  <dt className="text-neutral-500">Phone</dt>
                  <dd>{client.phone}</dd>
                </>
              )}
              {client.email && (
                <>
                  <dt className="text-neutral-500">Email</dt>
                  <dd className="truncate">{client.email}</dd>
                </>
              )}
              {client.preferences && (
                <>
                  <dt className="text-neutral-500">Preferences</dt>
                  <dd>{client.preferences}</dd>
                </>
              )}
            </dl>
            <Link href={`/clients/${client.id}`} className="mt-2 inline-block text-neutral-600 underline hover:text-neutral-900">
              Open client profile
            </Link>
          </section>
        )}

        <section aria-label="Services">
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {items.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div>
                  <div className="font-medium">{i.serviceName}</div>
                  <div className="text-neutral-500">
                    {i.staffName} · {formatMinute(i.start)}–{formatMinute(i.end)}
                    {i.resourceName && ` · ${i.resourceName}`}
                  </div>
                </div>
                <span>{formatPrice(i.priceCents)}</span>
              </li>
            ))}
            <li className="flex justify-between px-3 py-2 font-medium">
              <span>Total</span>
              <span>{formatPrice(total)}</span>
            </li>
          </ul>
        </section>

        <NotesForm key={appointment.notes} appointmentId={appointment.id} initial={appointment.notes} editable={notesEditable} />

        {me.canBook && (isEditable(status) || allowedActions(status).length > 0) && (
          <section aria-label="Actions" className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {isEditable(status) && (
                <button type="button" className={button} onClick={onEdit} disabled={pending}>
                  Edit
                </button>
              )}
              {allowedActions(status)
                .filter((a) => a !== "cancel")
                .map((a) => (
                  <button key={a} type="button" className={a === "check_in" || a === "check_out" ? primary : button} disabled={pending} onClick={() => run(a)}>
                    {ACTION_LABELS[a]}
                  </button>
                ))}
              {allowedActions(status).includes("cancel") && !canceling && (
                <button type="button" className={`${button} text-red-700`} disabled={pending} onClick={() => setCanceling(true)}>
                  Cancel appointment
                </button>
              )}
            </div>
            {canceling && <CancelForm pending={pending} onCancel={(reason, detail) => run("cancel", reason, detail)} onKeep={() => setCanceling(false)} />}
          </section>
        )}

        <p className="text-xs text-neutral-500">
          {appointment.bookedBy && <>Booked by {appointment.bookedBy}</>}
          {appointment.changedBy && (
            <>
              <br />
              Last changed by {appointment.changedBy}
            </>
          )}
        </p>
      </div>
    </Drawer>
  );
}

function NotesForm({ appointmentId, initial, editable }: { appointmentId: string; initial: string; editable: boolean }) {
  const [notes, setNotes] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);

  if (!editable) {
    return (
      <section aria-label="Notes">
        <h3 className="mb-1 font-medium">Notes</h3>
        <p className={initial ? "whitespace-pre-wrap" : "text-neutral-500"}>{initial || "No notes."}</p>
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
      <label htmlFor="appointment-notes" className="font-medium">
        Notes
      </label>
      <textarea
        id="appointment-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={MAX_NOTES}
        rows={3}
        className={inputClass}
      />
      <div className="flex items-center gap-3">
        <button type="submit" className={button} disabled={pending || notes === initial}>
          {pending ? "Saving…" : "Save notes"}
        </button>
        {result && (
          <span role={result.error ? "alert" : "status"} className={result.error ? "text-red-700" : "text-green-700"}>
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
      aria-label="Cancel appointment"
      className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onCancel(reason, detail);
      }}
    >
      <label htmlFor="cancel-reason" className="font-medium">
        Reason
      </label>
      <select id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} required className={inputClass}>
        <option value="">Choose a reason</option>
        {CANCEL_REASONS.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <label htmlFor="cancel-detail" className="font-medium">
        Details {reason !== "Other" && <span className="font-normal text-neutral-500">(optional)</span>}
      </label>
      <input id="cancel-detail" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={300} className={inputClass} />
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60" disabled={pending}>
          Cancel appointment
        </button>
        <button type="button" className={button} onClick={onKeep} disabled={pending}>
          Keep it
        </button>
      </div>
    </form>
  );
}
