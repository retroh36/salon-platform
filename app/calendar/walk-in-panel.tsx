"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { formatMinute } from "@/lib/scheduling/time";
import type { BoardData } from "./types";
import { addWalkIn, bookWalkInNow, walkIns, walkInLeft, type WalkInView } from "./waitlist-actions";
import { useUnsavedChanges } from "@/components/unsaved";

function waitLabel(minutes: number): string {
  if (minutes <= 5) return "now";
  if (minutes < 60) return `about ${Math.round(minutes / 5) * 5} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round((minutes % 60) / 15) * 15;
  return `about ${h}h${m ? ` ${m}m` : ""}`;
}

// Today's walk-ins: a quick queue with the estimated wait and the next free
// stylist who does the service, and one click to book them.
export function WalkInPanel({ data, onClose, onBooked }: { data: BoardData; onClose: () => void; onBooked: (appointmentId: string, message: string) => void }) {
  const [queue, setQueue] = useState<WalkInView[] | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const staffName = (id: string) => data.columns.find((c) => c.staffId === id)?.firstName ?? "a stylist";
  const serviceName = (id: string) => data.menu.services.find((s) => s.id === id)?.name ?? "A service";
  const services = data.menu.services.filter((s) => !s.archived);
  // Something filled in: leaving asks first.
  useUnsavedChanges(Boolean(name.trim() || phone.trim() || serviceId));

  useEffect(() => {
    let live = true;
    walkIns().then((q) => live && setQueue(q));
    return () => {
      live = false;
    };
  }, []);

  const run = (work: () => Promise<{ ok: boolean; message?: string; appointmentId?: string }>, after?: () => void) =>
    startTransition(async () => {
      setMessage(null);
      const r = await work();
      if (!r.ok) setMessage(r.message ?? "Something went wrong.");
      else if (r.appointmentId) return onBooked(r.appointmentId, r.message!);
      else after?.();
      setQueue(await walkIns());
    });

  return (
    <div className="flex flex-col gap-4 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-navy-900">Walk-ins</h2>
          <p className="text-ink-muted">Today{data.date !== data.today ? " (bookings go on today's calendar)" : ""}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>

      {message && <Alert>{message}</Alert>}

      <section aria-label="Walk-in queue" className="flex flex-col gap-2">
        {queue === null ? (
          <p className="text-ink-muted">Loading…</p>
        ) : queue.length === 0 ? (
          <p className="text-ink-muted">No one waiting.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {queue.map((w, i) => (
              <li key={w.id} className="flex animate-fade-in flex-col gap-2 rounded-xl border border-line bg-surface p-3">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">
                    {i + 1}. {w.name}
                  </span>
                  <span className="text-ink-muted">{serviceName(w.serviceId)}</span>
                </p>
                {w.estimate ? (
                  <p className="text-ink" data-testid="walk-in-estimate">
                    Next free: <strong className="font-semibold">{staffName(w.estimate.staffId)}</strong> at {formatMinute(w.estimate.start)} · wait {waitLabel(w.estimate.wait)}
                  </p>
                ) : (
                  <p className="text-danger">No one who does this service is free today.</p>
                )}
                <div className="flex gap-2">
                  {w.estimate && (
                    <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => bookWalkInNow(w.id))}>
                      Book with {staffName(w.estimate.staffId)} at {formatMinute(w.estimate.start)}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => walkInLeft(w.id))}>
                    Left
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <form
        aria-label="Add walk-in"
        className="flex flex-col gap-3 rounded-xl border border-line bg-sunken/40 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => addWalkIn({ name, phone, serviceId }),
            () => {
              setName("");
              setPhone("");
              setServiceId("");
            },
          );
        }}
      >
        <p className="font-semibold text-ink">Add a walk-in</p>
        <label className={labelClass}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} autoComplete="off" />
        </label>
        <label className={labelClass}>
          Phone (optional)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={fieldClass} autoComplete="off" />
        </label>
        <label className={labelClass}>
          Service
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={selectClass}>
            <option value="">Choose a service</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          Add to queue
        </Button>
      </form>
    </div>
  );
}
