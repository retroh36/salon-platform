"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert, Badge, textLinkClass } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { DeniseFace } from "@/components/denise";
import { useUnsavedChanges } from "@/components/unsaved";
import { DEFAULT_DAYS, MAX_PHONE_SERVICES, type PhoneRequest } from "@/lib/phone-booking";
import { LEVEL_LABELS, STAFF_LEVELS, type StaffLevel } from "@/lib/schedule-forms";
import type { PartOfDay } from "@/lib/scheduling/phone";
import { addDays } from "@/lib/scheduling/time";
import { reach } from "@/lib/reach";
import { saveVisit, type ClientOption } from "./actions";
import { ClientPicker, type BookingDraft } from "./booking-panel";
import { clientAlerts, findPhoneTimes, readCall, type ClientAlerts, type ClientMatch, type PhoneOption, type PhoneSearch } from "./phone-actions";
import type { BoardData } from "./types";
import { addToWaitlist } from "./waitlist-actions";

const EXAMPLE = "Maria Lopez, balayage + cut with Bridget next week, afternoons";

type Part = PartOfDay | "any";

// Booking while the client is on the phone: type what they ask for, Denise
// reads it into the fields, and the three best times come from the booking
// rules (./phone-actions.ts). One tap books; Adjust opens the usual
// booking form with it filled in. Without Denise, staff fill in the fields.
export function PhonePanel({
  data,
  onClose,
  onBooked,
  onWaitlisted,
  onAdjust,
}: {
  data: BoardData;
  onClose: () => void;
  onBooked: (appointmentId: string, date: string, message: string) => void;
  onWaitlisted: (message: string) => void;
  onAdjust: (draft: BookingDraft, client: ClientOption | null) => void;
}) {
  const stylists = data.columns.filter((c) => Object.keys(data.menu.offers[c.staffId] ?? {}).length > 0);
  const services = data.menu.services.filter((s) => !s.archived);
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const fresh = (): PhoneRequest => ({
    clientText: null,
    sameAsLast: false,
    serviceIds: [],
    staffId: null,
    level: null,
    from: data.today,
    to: addDays(data.today, DEFAULT_DAYS - 1),
    part: null,
    after: null,
    before: null,
    earliest: false,
  });

  const [line, setLine] = useState("");
  // The fields show once Denise has read the line, or straight away without her.
  const [request, setRequest] = useState<PhoneRequest | null>(data.me.denise ? null : fresh());
  const [reading, setReading] = useState<{ query: string; matches: ClientMatch[]; key: number } | null>(null);
  const [note, setNote] = useState<string | null>(data.me.denise ? null : "Fill in what the client wants, and I'll find the best times.");
  const [client, setClient] = useState<ClientOption | null>(null);
  const [alerts, setAlerts] = useState<{ clientId: string; value: ClientAlerts | null } | null>(null);
  const [found, setFound] = useState<PhoneSearch | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useUnsavedChanges(Boolean(line.trim() || client || request?.serviceIds.length));

  useEffect(() => {
    if (!client) return;
    let live = true;
    clientAlerts(client.id).then((value) => live && setAlerts({ clientId: client.id, value }));
    return () => {
      live = false;
    };
  }, [client]);
  const clientInfo = client && alerts?.clientId === client.id ? alerts.value : null;

  function search(r: PhoneRequest, who: ClientOption | null) {
    setMessage(null);
    startTransition(async () => {
      const result = await reach(findPhoneTimes(r, who?.id ?? null));
      if (result.ok) setFound(result);
      else {
        setFound(null);
        setMessage(result.message);
      }
    });
  }

  function read(e: React.FormEvent) {
    e.preventDefault();
    if (!line.trim()) return;
    setMessage(null);
    setFound(null);
    startTransition(async () => {
      const r = await reach(readCall(line));
      if (!r.ok) return setMessage(r.message);
      setRequest(r.request);
      setNote(r.note ?? (r.by === "fields" ? "Fill in what the client wants below." : null));
      // One clear match is the client; several are listed to choose from.
      const only = r.clients.length === 1 ? r.clients[0] : null;
      setClient(only);
      setReading({ query: r.request.clientText ?? "", matches: r.clients, key: Date.now() });
      if (r.request.serviceIds.length) {
        const result = await reach(findPhoneTimes(r.request, only?.id ?? null));
        if (result.ok) setFound(result);
        else setMessage(result.message);
      }
    });
  }

  const change = (patch: Partial<PhoneRequest>) => {
    setFound(null);
    setRequest((r) => ({ ...(r ?? fresh()), ...patch }));
  };

  function book(o: PhoneOption) {
    if (!client) return setMessage("Choose the client first, or add them as a new client.");
    setMessage(null);
    startTransition(async () => {
      const r = await reach(
        saveVisit({ date: o.date, clientId: client.id, notes: "", lines: o.lines.map((l) => ({ serviceId: l.serviceId, staffId: l.staffId, startMinute: l.startMinute, resource: "any", minutes: l.minutes })) }),
      );
      if (r.ok) onBooked(r.appointmentId, o.date, `Booked ${client.name.split(" ")[0]}: ${o.when}.`);
      else {
        // Someone took it meanwhile: say so and look again.
        setMessage(r.message);
        if (request) search(request, client);
      }
    });
  }

  function waitlist() {
    if (!client || !request) return setMessage("Choose the client first.");
    startTransition(async () => {
      const r = await reach(
        addToWaitlist({
          clientId: client.id,
          serviceIds: request.serviceIds,
          staffIds: request.staffId ? [request.staffId] : request.level ? stylists.filter((s) => s.level === request.level).map((s) => s.staffId) : [],
          fromDate: request.from,
          toDate: request.to,
          windows: request.part ? [request.part] : [],
          notes: "Added from a phone booking.",
        }),
      );
      if (r.ok) onWaitlisted(`${client.name.split(" ")[0]} is on the waitlist.`);
      else setMessage(r.message);
    });
  }

  const who = request?.staffId ?? (request?.level ? `level:${request.level}` : "anyone");
  const lastText = clientInfo?.last?.text;

  return (
    <div className="flex flex-col gap-4 py-2 text-sm" data-testid="phone-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-ink">Phone booking</h2>
          <p className="text-ink-muted">Type what the client asks for.</p>
        </div>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </div>

      {data.me.denise && (
        <form onSubmit={read} aria-label="What the client wants" className="flex flex-col gap-2">
          <label htmlFor="phone-line" className="sr-only">
            What the client wants
          </label>
          <textarea
            id="phone-line"
            autoFocus
            rows={2}
            value={line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={EXAMPLE}
            maxLength={500}
            className={`${fieldClass} h-auto resize-none py-2`}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="submit" variant={found?.ok && found.options.length ? "secondary" : "primary"} disabled={pending || !line.trim()}>
              {pending && !request ? "Reading…" : "Find times"}
            </Button>
            {!request && (
              <button type="button" className={textLinkClass} onClick={() => setRequest(fresh())}>
                Fill in the fields instead
              </button>
            )}
          </div>
        </form>
      )}

      {note && (
        <p className="flex items-start gap-2 text-denise-900" data-testid="phone-note">
          <DeniseFace size={20} className="mt-px" />
          <span>{note}</span>
        </p>
      )}
      {message && <Alert>{message}</Alert>}

      {request && (
        <>
          <ClientPicker
            key={reading?.key ?? "none"}
            client={client}
            onChange={(c) => {
              setClient(c);
              setFound(null);
            }}
            query={reading?.query}
            found={reading?.matches.length ? reading.matches : null}
          />
          {client && clientInfo && (
            <div className="flex flex-col gap-2" data-testid="phone-alerts">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={clientInfo.card === "on_file" ? "success" : "neutral"}>{clientInfo.card === "on_file" ? "Card on file" : "No card on file"}</Badge>
                {clientInfo.repeatNoShow && <Badge tone="danger">Repeat no-show</Badge>}
              </div>
              {clientInfo.policyNote && <p className="text-denise-900">{clientInfo.policyNote}</p>}
              {lastText && (
                <p className="text-ink-muted">
                  Last visit: {lastText}.{" "}
                  <button
                    type="button"
                    className={textLinkClass}
                    onClick={() => change({ serviceIds: clientInfo.last!.serviceIds, staffId: clientInfo.last!.staffId, level: null })}
                  >
                    Same as last time
                  </button>
                </p>
              )}
            </div>
          )}

          <fieldset className="flex flex-col gap-3 border-t border-line pt-4" aria-label="What they want">
            <legend className="sr-only">What they want</legend>
            {(request.serviceIds.length ? request.serviceIds : [""]).map((id, n) => (
              <div key={n} className="flex items-end gap-2">
                <label className={`${labelClass} min-w-0 flex-1`}>
                  {n === 0 ? "Service" : "Then"}
                  <select
                    value={id}
                    onChange={(e) => {
                      const next = [...request.serviceIds];
                      next[n] = e.target.value;
                      change({ serviceIds: next.filter(Boolean) });
                    }}
                    className={selectClass}
                  >
                    <option value="">Choose a service</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                {n > 0 && (
                  <Button size="sm" variant="quiet" aria-label={`Remove ${serviceName.get(id) ?? "service"}`} onClick={() => change({ serviceIds: request.serviceIds.filter((_, i) => i !== n) })}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
            {request.serviceIds.length > 0 && request.serviceIds.length < MAX_PHONE_SERVICES && (
              <button type="button" className={`self-start ${textLinkClass}`} onClick={() => change({ serviceIds: [...request.serviceIds, services[0].id] })}>
                Add another service
              </button>
            )}
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
                {stylists.map((s) => (
                  <option key={s.staffId} value={s.staffId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className={labelClass}>
                From
                <input type="date" value={request.from} min={data.today} onChange={(e) => e.target.value && change({ from: e.target.value, to: e.target.value > request.to ? e.target.value : request.to })} className={fieldClass} />
              </label>
              <label className={labelClass}>
                To
                <input type="date" value={request.to} min={request.from} onChange={(e) => e.target.value && change({ to: e.target.value })} className={fieldClass} />
              </label>
            </div>
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
            <label className="flex items-center gap-2 text-ink">
              <input type="checkbox" checked={request.earliest} onChange={(e) => change({ earliest: e.target.checked })} className={checkboxClass} />
              Earliest first
            </label>
            {!found && (
              <Button variant={data.me.denise ? "secondary" : "primary"} className="self-start" disabled={pending || !request.serviceIds.length} onClick={() => search(request, client)}>
                {pending ? "Looking…" : "Show times"}
              </Button>
            )}
          </fieldset>
        </>
      )}

      {found?.ok && (
        <section aria-label="Best times" className="flex animate-fade-in flex-col gap-3 border-t border-line pt-4" data-testid="phone-times">
          {found.options.length > 0 ? (
            <>
              <h3 className="font-medium text-ink">Best times</h3>
              <Options options={found.options} client={client} pending={pending} onBook={book} onAdjust={(o) => onAdjust(draftOf(o), client)} primary />
            </>
          ) : (
            <>
              <p className="text-ink" data-testid="phone-nothing">
                Nothing fits {found.searched}.
              </p>
              {found.otherDays.length > 0 && (
                <>
                  <h3 className="font-medium text-ink">Another day</h3>
                  <Options options={found.otherDays} client={client} pending={pending} onBook={book} onAdjust={(o) => onAdjust(draftOf(o), client)} />
                </>
              )}
              {found.sameLevel.length > 0 && (
                <>
                  <h3 className="font-medium text-ink">Another stylist at the same level</h3>
                  <Options options={found.sameLevel} client={client} pending={pending} onBook={book} onAdjust={(o) => onAdjust(draftOf(o), client)} />
                </>
              )}
              <div className="flex flex-col gap-1.5">
                <p className="text-ink-muted">Or put them on the waitlist, and I&rsquo;ll look out for an opening.</p>
                <Button size="sm" className="self-start" disabled={pending || !client} onClick={waitlist}>
                  Add to waitlist
                </Button>
              </div>
            </>
          )}
          {found.lengths && <p className="text-13 text-ink-muted">{found.lengths}</p>}
        </section>
      )}
    </div>
  );
}

const draftOf = (o: PhoneOption): BookingDraft => ({ date: o.date, lines: o.lines.map((l) => ({ serviceId: l.serviceId, staffId: l.staffId, startMinute: l.startMinute, minutes: l.minutes })) });

function Options({
  options,
  client,
  pending,
  onBook,
  onAdjust,
  primary = false,
}: {
  options: PhoneOption[];
  client: ClientOption | null;
  pending: boolean;
  onBook: (o: PhoneOption) => void;
  onAdjust: (o: PhoneOption) => void;
  primary?: boolean;
}) {
  return (
    <ol className="flex flex-col gap-2">
      {options.map((o, n) => (
        <li key={`${o.date}-${o.lines[0].staffId}-${o.lines[0].startMinute}`} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-3" data-testid="phone-option">
          <p className="font-medium text-ink">{o.when}</p>
          <p className="text-ink">{o.what}</p>
          <p className="text-denise-900">{o.reason}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" variant={primary && n === 0 ? "primary" : "secondary"} disabled={pending || !client} title={client ? undefined : "Choose the client first"} onClick={() => onBook(o)}>
              Book
            </Button>
            <Button size="sm" variant="quiet" disabled={pending} onClick={() => onAdjust(o)}>
              Adjust
            </Button>
          </div>
        </li>
      ))}
    </ol>
  );
}
