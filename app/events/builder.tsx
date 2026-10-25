"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ClientPicker } from "@/app/calendar/booking-panel";
import type { ClientOption } from "@/app/calendar/actions";
import { DeniseFace } from "@/components/denise";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CloseIcon } from "@/components/ui/icons";
import { Alert, Card } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { builderProblems, lanesFor, memberKey, priceOf, timelineOf, type BuilderState } from "@/lib/events/builder";
import { headcountCutoff, paymentSchedule, SCHEDULED_LABELS } from "@/lib/events/pricing";
import { PARTY_ROLE_LABELS, PARTY_ROLES, packageRoles, type EventPackage, type EventSettings, type PartyMember, type PartyRole } from "@/lib/events/types";
import type { TeamMember } from "@/lib/events/load";
import { describeTimelineProblem, laneKey, laneSpans, suggestTeam, timelineProblems, type EventRole, type Lanes } from "@/lib/scheduling/events";
import { formatMinute, minuteToTime, parseTime, type LocalDate } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { checkTeam, draftEvent, saveEvent, type TeamCheck } from "./actions";
import { TimelineEditor } from "./timeline-editor";

export type BuilderProps = {
  eventId: string | null;
  initial: BuilderState;
  packages: EventPackage[];
  settings: EventSettings;
  taxBp: number;
  team: TeamMember[];
  today: LocalDate;
  // Past the cutoff on a booked event, and not a manager: the party is locked.
  partyLocked: boolean;
};

const QUICK_ADD: PartyRole[] = ["bridesmaid", "maid_of_honor", "mother", "flower_girl", "guest"];

const formatDay = (date: LocalDate) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// The event builder: everything on one screen. Describe it to Denise (or
// fill it in), adjust anything, and save. The total, deposit, payment
// schedule and timeline update as you go; the team for each artist lane is
// suggested from who's free that day.
export function EventBuilder({ eventId, initial, packages, settings, taxBp, team, today, partyLocked }: BuilderProps) {
  const router = useRouter();
  const [state, setState] = useState<BuilderState>(initial);
  const [line, setLine] = useState("");
  const [drafted, setDrafted] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [check, setCheck] = useState<TeamCheck>({});
  const manual = useRef(new Set<string>(Object.keys(initial.team).filter((k) => initial.team[k])));
  const [drafting, startDraft] = useTransition();
  const [saving, startSave] = useTransition();

  const active = packages.filter((p) => p.isActive && !p.isTrial);
  const tasks = useMemo(() => timelineOf(state, packages, settings), [state, packages, settings]);
  const spans = useMemo(() => laneSpans(tasks), [tasks]);
  const price = useMemo(() => priceOf(state, packages, settings, taxBp, tasks), [state, packages, settings, taxBp, tasks]);
  const schedule = state.date ? paymentSchedule({ mainCents: price.mainCents, depositCents: price.depositCents, eventDate: state.date, bookedOn: today }, settings) : [];
  const brideAt = state.members.findIndex((m) => m.partyRole === "bride");
  const nameOf = (key: string) => state.members[Number(key) - 1]?.name || `Guest ${key}`;
  const timelineIssues = state.readyBy == null ? [] : timelineProblems(tasks, state.readyBy, brideAt >= 0 ? memberKey(brideAt) : null);
  const problems = builderProblems(state, packages, settings, eventId ? "0000-01-01" : today);

  const update = (patch: Partial<BuilderState>) => setState((s) => ({ ...s, ...patch }));
  // A change to the party or ready-by time works the timeline out again
  // (and the number of artists, unless staff chose it).
  const updateParty = (members: PartyMember[]) => setState((s) => ({ ...s, members, lanes: lanesFor(members, packages, settings), tasks: null }));

  // Who's free for each lane, whenever the day or the lanes change; empty
  // lanes take the first free person.
  const spanKey = JSON.stringify([state.date, spans, state.onLocation ? state.travelMinutes : 0]);
  useEffect(() => {
    if (!state.date || !spans.length) return;
    let current = true;
    const timer = setTimeout(async () => {
      const result = await checkTeam(eventId, state.date, spans, state.onLocation ? state.travelMinutes : 0);
      if (!current) return;
      setCheck(result);
      setState((s) => {
        const free = (staffId: string, span: { role: EventRole; lane: number }) => result[laneKey(span)]?.[staffId] === null;
        const kept = Object.fromEntries(Object.entries(s.team).filter(([k, v]) => v && (manual.current.has(k) || result[k]?.[v] === null)));
        const open = spans.filter((sp) => !kept[laneKey(sp)]);
        const others = team.filter((t) => !Object.values(kept).includes(t.id));
        const suggested = suggestTeam(open, others, free);
        return { ...s, team: { ...kept, ...Object.fromEntries(suggested) } };
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // spanKey stands for the date, the lanes and travel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanKey]);

  function draft() {
    setMessage(null);
    startDraft(async () => {
      const result = await draftEvent(line);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      const d = result.draft;
      manual.current.clear();
      setState((s) => ({
        ...s,
        title: d.title,
        date: d.date ?? s.date,
        readyBy: d.readyBy ?? s.readyBy,
        onLocation: d.onLocation,
        venueName: d.venue,
        travelMinutes: d.onLocation ? s.travelMinutes || settings.travelMinutes : s.travelMinutes,
        members: d.members,
        lanes: lanesFor(d.members, packages, settings),
        team: {},
        tasks: null,
        source: "denise",
        described: line.trim(),
      }));
      const missing = [!d.date && "the date", d.readyBy == null && "the ready-by time"].filter(Boolean);
      setDrafted(
        `I've filled in ${d.members.length} ${d.members.length === 1 ? "person" : "people"}, the timeline, the team and the total from your description${missing.length ? `; add ${missing.join(" and ")}` : ""}. Check everything before saving.`,
      );
    });
  }

  function save() {
    setMessage(null);
    startSave(async () => {
      const result = await saveEvent(eventId, state);
      if (!result.ok) setMessage(result.message);
      else router.push(`/events/${result.id}`);
    });
  }

  const client: ClientOption | null = state.clientId ? { id: state.clientId, name: state.clientName, phone: null, allergies: null } : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <section aria-label="Denise drafts it" className="flex flex-col gap-3 rounded-xl border border-denise-200 bg-denise-50 p-4">
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              draft();
            }}
          >
            <label className={`${labelClass} flex-1 text-denise-900`}>
              <span className="flex items-center gap-2">
                <DeniseFace size={22} /> Describe it to Denise
              </span>
              <input
                value={line}
                onChange={(e) => setLine(e.target.value)}
                placeholder="June 14 wedding, ready by 2pm, bride plus 5 bridesmaids hair and makeup, at the Grand Hotel"
                className={fieldClass}
                maxLength={500}
              />
            </label>
            <Button type="submit" variant="primary" disabled={drafting || line.trim().length < 5}>
              {drafting ? "Drafting…" : "Draft it"}
            </Button>
          </form>
          {drafted && (
            <p className="text-sm text-denise-900" role="status" data-testid="denise-drafted">
              {drafted}
            </p>
          )}
        </section>

        <Card title="Event" titleId="event-details">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={`${labelClass} sm:col-span-2`}>
              Name
              <input value={state.title} onChange={(e) => update({ title: e.target.value })} placeholder="Rossi wedding" className={fieldClass} maxLength={120} />
            </label>
            <div className="sm:col-span-2">
              <ClientPicker client={client} onChange={(c) => update({ clientId: c?.id ?? null, clientName: c?.name ?? "" })} />
            </div>
            <label className={labelClass}>
              Date
              <input type="date" value={state.date} min={eventId ? undefined : today} onChange={(e) => update({ date: e.target.value, tasks: null })} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Ready by
              <input
                type="time"
                step={300}
                value={state.readyBy == null ? "" : minuteToTime(state.readyBy)}
                onChange={(e) => {
                  const m = parseTime(e.target.value);
                  update({ readyBy: m == null ? null : m - (m % 5), tasks: null });
                }}
                className={fieldClass}
              />
            </label>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium text-ink">Where</span>
              <Segmented
                label="Where"
                value={state.onLocation ? "location" : "salon"}
                onChange={(v) => update({ onLocation: v === "location", travelMinutes: v === "location" ? state.travelMinutes || settings.travelMinutes : state.travelMinutes })}
                options={[
                  { value: "salon", label: "In the salon" },
                  { value: "location", label: "On location" },
                ]}
              />
            </div>
            {state.onLocation && (
              <>
                <label className={labelClass}>
                  Venue
                  <input value={state.venueName} onChange={(e) => update({ venueName: e.target.value })} className={fieldClass} maxLength={200} />
                </label>
                <label className={labelClass}>
                  Address
                  <input value={state.venueAddress} onChange={(e) => update({ venueAddress: e.target.value })} className={fieldClass} maxLength={300} />
                </label>
                <label className={labelClass}>
                  Miles from the salon
                  <input type="number" min={0} max={1000} step={1} value={state.travelMiles || ""} onChange={(e) => update({ travelMiles: Math.max(0, Number(e.target.value) || 0) })} className={fieldClass} />
                </label>
                <label className={labelClass}>
                  Travel each way (minutes)
                  <input type="number" min={0} max={240} step={5} value={state.travelMinutes} onChange={(e) => update({ travelMinutes: Math.min(240, Math.max(0, Math.round((Number(e.target.value) || 0) / 5) * 5)) })} className={fieldClass} />
                </label>
              </>
            )}
          </div>
        </Card>

        <Card
          title={`Party (${state.members.length})`}
          titleId="event-party"
          actions={
            <Segmented
              label="Who pays"
              value={state.billing}
              onChange={(v) => update({ billing: v })}
              options={[
                { value: "main", label: "Bill the main client" },
                { value: "split", label: "Each pays their own" },
              ]}
            />
          }
        >
          {partyLocked && (
            <Alert tone="info" className="mb-4">
              The headcount cutoff has passed. An owner or manager can change the party now.
            </Alert>
          )}
          <ol className="flex flex-col gap-2" aria-label="Party">
            {state.members.map((m, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-lg border border-line p-2.5" data-testid="party-member">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1.3fr)_auto]">
                  <input
                    aria-label={`Name of person ${i + 1}`}
                    value={m.name}
                    disabled={partyLocked}
                    onChange={(e) => update({ members: state.members.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                    className={fieldClass}
                    maxLength={80}
                  />
                  <select
                    aria-label={`Role of ${m.name || `person ${i + 1}`}`}
                    value={m.partyRole}
                    disabled={partyLocked}
                    onChange={(e) => updateParty(state.members.map((x, j) => (j === i ? { ...x, partyRole: e.target.value as PartyRole } : x)))}
                    className={`${selectClass} order-3 sm:order-none`}
                  >
                    {PARTY_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {PARTY_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Package for ${m.name || `person ${i + 1}`}`}
                    value={m.packageId}
                    disabled={partyLocked}
                    onChange={(e) => updateParty(state.members.map((x, j) => (j === i ? { ...x, packageId: e.target.value } : x)))}
                    className={`${selectClass} order-4 sm:order-none`}
                  >
                    {!m.packageId && <option value="">Choose a package</option>}
                    {active.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {formatPrice(p.priceCents)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove ${m.name || `person ${i + 1}`}`}
                    disabled={partyLocked}
                    onClick={() => updateParty(state.members.filter((_, j) => j !== i))}
                    className="flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors duration-(--motion-fast) hover:bg-sunken hover:text-ink disabled:opacity-40"
                  >
                    <CloseIcon className="size-4" />
                  </button>
                </div>
                {state.billing === "split" && (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex min-h-11 items-center gap-2 font-medium">
                      <input type="checkbox" className={checkboxClass} checked={m.paysOwn} onChange={(e) => update({ members: state.members.map((x, j) => (j === i ? { ...x, paysOwn: e.target.checked } : x)) })} />
                      Pays their own by link
                    </label>
                    {m.paysOwn && (
                      <>
                        <input aria-label={`Phone for ${m.name}`} placeholder="Phone" inputMode="tel" value={m.phone} onChange={(e) => update({ members: state.members.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)) })} className={`${fieldClass} w-40`} />
                        <input aria-label={`Email for ${m.name}`} placeholder="Email" type="email" value={m.email} onChange={(e) => update({ members: state.members.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) })} className={`${fieldClass} w-56`} />
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {!partyLocked && (
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Add to the party">
              {(brideAt < 0 ? (["bride", ...QUICK_ADD] as PartyRole[]) : QUICK_ADD).map((role) => (
                <Button
                  key={role}
                  size="sm"
                  onClick={() => {
                    const count = state.members.filter((m) => m.partyRole === role).length;
                    const pkg = active.find((p) => p.partyRole === role) ?? active.find((p) => p.partyRole === "bridesmaid") ?? active[0];
                    updateParty([...state.members, { name: role === "bride" || count === 0 ? PARTY_ROLE_LABELS[role] : `${PARTY_ROLE_LABELS[role]} ${count + 1}`, partyRole: role, packageId: pkg?.id ?? "", paysOwn: false, email: "", phone: "" }]);
                  }}
                >
                  + {PARTY_ROLE_LABELS[role]}
                </Button>
              ))}
            </div>
          )}
          {!active.length && <p className="mt-3 text-ink-muted">There are no event packages yet. An owner sets them up on Settings → Bridal and events.</p>}
        </Card>

        <Card title="Notes" titleId="event-notes">
          <textarea aria-label="Notes" value={state.notes} onChange={(e) => update({ notes: e.target.value })} rows={3} maxLength={4000} className={fieldClass} placeholder="Inspiration, allergies to products, parking…" />
        </Card>
      </div>

      <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start" aria-label="Total and timeline">
        <Card title="Total" titleId="event-total">
          <dl className="flex flex-col gap-1.5 text-sm" data-testid="event-total">
            <Line label={`Packages (${state.members.length})`} cents={price.subtotalCents} />
            {price.travelFeeCents > 0 && <Line label="Travel" cents={price.travelFeeCents} />}
            {price.earlyFeeCents > 0 && <Line label={`Early start (${price.earlyFeeCents / Math.max(settings.earlyStartFeeCents, 1)} ${price.earlyFeeCents / Math.max(settings.earlyStartFeeCents, 1) === 1 ? "artist" : "artists"})`} cents={price.earlyFeeCents} />}
            {price.serviceChargeCents > 0 && <Line label={`Service charge (${settings.serviceChargePct}%)`} cents={price.serviceChargeCents} />}
            {price.taxCents > 0 && <Line label="Tax" cents={price.taxCents} />}
            <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums" data-testid="total">
                {formatPrice(price.totalCents)}
              </dd>
            </div>
            {price.ownCents > 0 && <Line label="Paid by the party, by link" cents={price.ownCents} />}
            <div className="flex justify-between font-semibold">
              <dt>
                Deposit to book ({settings.depositPct}%{settings.depositRefundable ? "" : ", non-refundable"})
              </dt>
              <dd className="tabular-nums" data-testid="deposit">
                {formatPrice(price.depositCents)}
              </dd>
            </div>
          </dl>
          {schedule.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">If booked today</h3>
              <ul className="mt-1 flex flex-col gap-1 text-sm" data-testid="schedule">
                {schedule.map((p) => (
                  <li key={p.kind} className="flex justify-between gap-2">
                    <span>
                      {SCHEDULED_LABELS[p.kind]} · {p.dueOn === today ? "to book" : formatDay(p.dueOn)}
                    </span>
                    <span className="tabular-nums">{formatPrice(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
              {state.date && <p className="mt-2 text-xs text-ink-muted">Party changes until {formatDay(headcountCutoff(state.date, settings))}.</p>}
            </div>
          )}
        </Card>

        <Card title="Timeline" titleId="event-timeline">
          {state.readyBy == null || !state.members.length ? (
            <p className="text-ink-muted">Add the party and the ready-by time, and I&rsquo;ll plan the day backward from it.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-4">
                {(["hair", "makeup"] as const)
                  .filter((role) => state.lanes[role] > 0)
                  .map((role) => (
                    <LaneCount key={role} role={role} lanes={state.lanes} onChange={(lanes) => update({ lanes, tasks: null })} />
                  ))}
              </div>
              <ul className="flex flex-col gap-2" aria-label="Team">
                {spans.map((span) => {
                  const key = laneKey(span);
                  const options = team.filter((t) => t.eventRoles.includes(span.role));
                  return (
                    <li key={key} className="flex flex-col gap-1" data-testid="lane">
                      <label className="flex items-center justify-between gap-2 text-sm font-medium">
                        <span>
                          {span.role === "hair" ? "Hair" : "Makeup"} {span.lane} · call {formatMinute(span.call)}
                        </span>
                        <select
                          aria-label={`${span.role === "hair" ? "Hair" : "Makeup"} artist ${span.lane}`}
                          value={state.team[key] ?? ""}
                          onChange={(e) => {
                            manual.current.add(key);
                            update({ team: { ...state.team, [key]: e.target.value || null } });
                          }}
                          className={`${selectClass} h-10 w-44`}
                        >
                          <option value="">Not chosen</option>
                          {options.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.firstName}
                              {check[key]?.[t.id] ? ` (${check[key][t.id]})` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      {state.team[key] && check[key]?.[state.team[key]!] && (
                        <p className="text-sm text-danger">
                          {team.find((t) => t.id === state.team[key])?.firstName} {check[key][state.team[key]!]} then.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              {spans.some((s) => !state.team[laneKey(s)]) && Object.keys(check).length > 0 && (
                <p className="text-sm text-danger" data-testid="short-staffed">
                  {spans.filter((s) => !state.team[laneKey(s)]).length === 1 ? "One lane has" : `${spans.filter((s) => !state.team[laneKey(s)]).length} lanes have`} nobody free.
                </p>
              )}
              <TimelineEditor
                tasks={tasks}
                readyBy={state.readyBy}
                nameOf={nameOf}
                staffOf={(span) => team.find((t) => t.id === state.team[laneKey(span)])?.firstName ?? null}
                onChange={(next) => update({ tasks: next })}
                manual={state.tasks !== null}
                onReset={() => update({ tasks: null })}
              />
              {timelineIssues.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm text-danger" role="alert">
                  {timelineIssues.map((p, i) => (
                    <li key={i}>{describeTimelineProblem(p, nameOf)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-2">
          {message && <Alert>{message}</Alert>}
          <Button variant="primary" size="lg" disabled={saving || problems.length > 0} onClick={save}>
            {saving ? "Saving…" : eventId ? "Save changes" : "Save as inquiry"}
          </Button>
          {problems.length > 0 && <p className="text-sm text-ink-muted">{problems[0]}</p>}
          {packages.length > 0 && (
            <p className="text-xs text-ink-subtle">
              Packages: {active.map((p) => `${p.name} (${packageRoles(p)})`).join(", ")}.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Line({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular-nums">{formatPrice(cents)}</dd>
    </div>
  );
}

function LaneCount({ role, lanes, onChange }: { role: EventRole; lanes: Lanes; onChange: (lanes: Lanes) => void }) {
  const label = role === "hair" ? "Hair artists" : "Makeup artists";
  return (
    <div className="flex items-center gap-2 text-sm font-medium" role="group" aria-label={label}>
      <span>{label}</span>
      <Button size="xs" aria-label={`Fewer ${label.toLowerCase()}`} disabled={lanes[role] <= 1} onClick={() => onChange({ ...lanes, [role]: lanes[role] - 1 })}>
        −
      </Button>
      <span className="w-5 text-center tabular-nums" data-testid={`${role}-lanes`}>
        {lanes[role]}
      </span>
      <Button size="xs" aria-label={`More ${label.toLowerCase()}`} disabled={lanes[role] >= 10} onClick={() => onChange({ ...lanes, [role]: lanes[role] + 1 })}>
        +
      </Button>
    </div>
  );
}
