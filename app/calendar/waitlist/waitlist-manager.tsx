"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert, Card, EmptyState, listClass, rowClass } from "@/components/ui/page";
import { PlusIcon } from "@/components/ui/icons";
import { formatDate } from "@/lib/clients";
import { addDays } from "@/lib/scheduling/time";
import { TIME_WINDOWS, type WindowName } from "@/lib/scheduling/waitlist";
import type { ClientOption } from "../actions";
import { ClientPicker } from "../booking-panel";
import { addToWaitlist, removeFromWaitlist } from "../waitlist-actions";

type Entry = { id: string; clientName: string; phone: string | null; services: string; stylists: string; fromDate: string; toDate: string; windows: WindowName[]; notes: string | null; since: string };

const WINDOW_NAMES = Object.keys(TIME_WINDOWS) as WindowName[];

export function WaitlistManager({
  today,
  canEdit,
  services,
  stylists,
  entries,
}: {
  today: string;
  canEdit: boolean;
  services: { id: string; name: string; category: string }[];
  stylists: { id: string; name: string }[];
  entries: Entry[];
}) {
  const [client, setClient] = useState<ClientOption | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([""]);
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(addDays(today, 14));
  const [windows, setWindows] = useState<WindowName[]>([]);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const categories = [...new Set(services.map((s) => s.category))];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      if (!client) return setMessage({ ok: false, text: "Choose a client, or add a new one." });
      const r = await addToWaitlist({ clientId: client.id, serviceIds: serviceIds.filter(Boolean), staffIds, fromDate, toDate, windows, notes });
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      setMessage({ ok: true, text: `Added ${client.name} to the waitlist.` });
      setClient(null);
      setServiceIds([""]);
      setStaffIds([]);
      setWindows([]);
      setNotes("");
    });
  }

  return (
    <>
      <Card
        title={
          <>
            Waiting <span className="ml-1 text-13 font-normal text-ink-subtle tabular-nums">{entries.length}</span>
          </>
        }
        titleId="waiting-heading"
        flush
      >
        {entries.length === 0 ? (
          <EmptyState>No one is on the waitlist.</EmptyState>
        ) : (
          <ul className={listClass} aria-labelledby="waiting-heading">
            {entries.map((e) => (
              <li key={e.id} className={`flex flex-wrap items-start justify-between gap-3 ${rowClass}`}>
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {e.clientName}
                    {e.phone && <span className="ml-2 font-normal text-ink-muted tabular-nums">{e.phone}</span>}
                  </p>
                  <p className="text-sm text-ink">
                    {e.services} · {e.stylists}
                  </p>
                  <p className="text-13 text-ink-muted">
                    {formatDate(e.fromDate)} – {formatDate(e.toDate)} · {e.windows.length ? e.windows.map((w) => TIME_WINDOWS[w].label).join(", ") : "Any time"}
                    {e.notes && ` · ${e.notes}`}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    size="xs"
                    variant="quiet"
                    disabled={pending}
                    aria-label={`Remove ${e.clientName} from the waitlist`}
                    onClick={() => startTransition(async () => void (await removeFromWaitlist(e.id)))}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canEdit && (
        <Card title="Add to the waitlist" titleId="add-heading">
          <form onSubmit={submit} aria-label="Add to the waitlist" className="flex flex-col gap-5 text-sm">
            {message && (message.ok ? <Alert tone="success">{message.text}</Alert> : <Alert>{message.text}</Alert>)}
            <ClientPicker client={client} onChange={setClient} />
            <div className="flex flex-col gap-2">
              {serviceIds.map((id, i) => (
                <label key={i} className={labelClass}>
                  {i === 0 ? "Service" : `Service ${i + 1}`}
                  <select
                    aria-label={i === 0 ? "Service" : `Service ${i + 1}`}
                    value={id}
                    onChange={(e) => setServiceIds(serviceIds.map((x, n) => (n === i ? e.target.value : x)))}
                    className={selectClass}
                  >
                    <option value="">Choose a service</option>
                    {categories.map((c) => (
                      <optgroup key={c} label={c}>
                        {services
                          .filter((s) => s.category === c)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              ))}
              {serviceIds.length < 5 && (
                <Button size="sm" className="self-start" onClick={() => setServiceIds([...serviceIds, ""])}>
                  <PlusIcon className="size-4" />
                  Another service
                </Button>
              )}
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-13 font-medium text-ink">Stylists (none ticked: any stylist)</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {stylists.map((s) => (
                  <label key={s.id} className="flex items-center gap-2">
                    <input type="checkbox" className={checkboxClass} checked={staffIds.includes(s.id)} onChange={() => setStaffIds(toggle(staffIds, s.id))} />
                    {s.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-4">
              <label className={labelClass}>
                From
                <input type="date" min={today} value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${fieldClass} w-44!`} />
              </label>
              <label className={labelClass}>
                Until
                <input type="date" min={fromDate} value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${fieldClass} w-44!`} />
              </label>
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-13 font-medium text-ink">Times (none ticked: any time)</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {WINDOW_NAMES.map((w) => (
                  <label key={w} className="flex items-center gap-2">
                    <input type="checkbox" className={checkboxClass} checked={windows.includes(w)} onChange={() => setWindows(toggle(windows, w))} />
                    {TIME_WINDOWS[w].label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={labelClass}>
              Notes (optional)
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className={fieldClass} />
            </label>
            <Button type="submit" variant="primary" disabled={pending} className="self-start">
              {pending ? "Adding…" : "Add to waitlist"}
            </Button>
          </form>
        </Card>
      )}
    </>
  );
}
