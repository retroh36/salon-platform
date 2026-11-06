"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { ChevronLeftIcon, ChevronRightIcon, WarningIcon } from "@/components/ui/icons";
import { Alert, Badge, nameLinkClass, textLinkClass } from "@/components/ui/page";
import { Sheet } from "@/components/ui/sheet";
import { SideScrollEdges } from "@/components/ui/side-scroll";
import { monthLabel, shiftMonth } from "@/lib/calendar-month";
import { formatDay } from "@/lib/schedule-format";
import { MAX_COPY_WEEKS, personMonth } from "@/lib/schedule-month";
import type { MonthGrid } from "@/lib/schedule-month-load";
import { addDays, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { clockDays, differenceText, entryDay, entryMinutes, type ClockEntry, type DayHours } from "@/lib/time-clock";
import { formatDuration } from "@/lib/duration";
import { cellKey, changesOf, outside, patternLabel, ROLE_GROUPS, sayShifts, scheduledMinutes, shown, withEdit, type Cell, type DayEdit } from "@/lib/team-schedule";
import type { GridPerson } from "@/lib/team-schedule-load";
import { trackSave } from "@/lib/unsaved-work";
import { copyFromPerson, copyWeekForward, publishWeeks, saveDays, saveTimeEntry, type TimeEntryInput } from "./actions";
import { DayEditor } from "./day-editor";
import { PublishSheet } from "./publish-sheet";
import { RangeSwitch } from "./scheduling-tabs";
import { hours, offText, pillText } from "./week-grid";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayNumber = (d: LocalDate) => Number(d.slice(8));
const weekdayOf = (d: LocalDate) => WEEKDAYS[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7];

type Notice = { tone: "error" | "success"; text: string; moves?: { label: string; href: string }[] };

// The team schedule's month: everyone's shifts for every day (a row per
// person, a narrow column per day), with approved time off, drafts and
// the days Denise flags; or, with a person chosen, their month as a
// calendar. Owners and managers change days (into the week's draft, as on
// the week), copy a week forward or copy someone else's days, and publish
// the month's changed weeks at once.
export type ClockData = {
  entries: { id: string; staffId: string; clockIn: string; clockOut: string | null; edited: boolean; missedOut?: boolean; source: string }[];
  // Whoever manages the team fixes punches; payroll only reads them.
  canEdit: boolean;
  timeZone: string;
  now: string;
};

export function MonthGridView({ grid, today, editable, person, clock }: { grid: MonthGrid; today: LocalDate; editable: boolean; person: GridPerson | null; clock: ClockData | null }) {
  const router = useRouter();
  const [base, setBase] = useState(grid);
  const [cells, setCells] = useState(() => new Map(grid.cells.map((c) => [cellKey(c.staffId, c.date), c])));
  if (base !== grid) {
    setBase(grid);
    setCells(new Map(grid.cells.map((c) => [cellKey(c.staffId, c.date), c])));
  }
  const [editing, setEditing] = useState<{ cell: Cell; anchor: HTMLElement } | null>(null);
  const [copying, setCopying] = useState<"week" | "person" | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, start] = useTransition();

  const all = [...cells.values()];
  const changes = changesOf(all);
  const canEdit = (date: LocalDate) => editable && date >= today;
  const days = grid.weeks.flat().filter((d) => d.startsWith(grid.month));
  const monthHref = (m: string) => `/scheduling/month?month=${m}${person ? `&staff=${person.id}` : ""}`;

  function save(edits: DayEdit[]) {
    if (!edits.length) return;
    const before = cells;
    const next = new Map(cells);
    for (const e of edits) {
      const c = next.get(cellKey(e.staffId, e.date));
      if (c) next.set(cellKey(e.staffId, e.date), withEdit(c, e.shifts));
    }
    setCells(next);
    setNotice(null);
    start(async () => {
      const r = await trackSave(saveDays(edits));
      if (!r.ok) {
        setCells(before);
        setNotice({ tone: "error", text: r.message });
      } else router.refresh();
    });
  }

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setNotice(null);
    start(async () => {
      const r = await trackSave(action());
      setNotice({ tone: r.ok ? "success" : "error", text: r.message ?? "Saved." });
      if (r.ok) {
        setCopying(null);
        router.refresh();
      }
    });
  }

  const drafts = changes.length;
  const [punching, setPunching] = useState<Cell | null>(null);
  const entries = useMemo(() => (clock?.entries ?? []).map((e) => ({ ...e, clockIn: new Date(e.clockIn), clockOut: e.clockOut ? new Date(e.clockOut) : null })), [clock]);
  const clockView = clock && { entries, timeZone: clock.timeZone, now: new Date(clock.now) };
  const editProps = {
    canEdit,
    onEdit: (cell: Cell, anchor: HTMLElement) => setEditing({ cell, anchor }),
    // On someone's month, a day up to today opens their clocked hours.
    canClock: (date: LocalDate) => Boolean(person && clock?.canEdit && date <= today),
    onClock: (cell: Cell) => setPunching(cell),
  };

  return (
    <div data-testid="team-month">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={monthHref(shiftMonth(grid.month, -1))} className={buttonClass("secondary", "sm", "", { square: true })} aria-label="Previous month">
            <ChevronLeftIcon className="size-4" />
          </Link>
          <Link href={monthHref(today.slice(0, 7))} className={buttonClass("secondary", "sm")}>
            This month
          </Link>
          <Link href={monthHref(shiftMonth(grid.month, 1))} className={buttonClass("secondary", "sm", "", { square: true })} aria-label="Next month">
            <ChevronRightIcon className="size-4" />
          </Link>
          <h2 className="ml-1 text-base font-semibold text-ink">{monthLabel(grid.month)}</h2>
          <RangeSwitch current="month" month={grid.month} />
          {editable && drafts > 0 && (
            <Badge tone="warning">
              Draft · {drafts} {drafts === 1 ? "change" : "changes"}
            </Badge>
          )}
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            {person && (
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => setCopying("person")}>
                Copy from someone…
              </Button>
            )}
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setCopying("week")}>
              Copy a week forward…
            </Button>
            <Button size="sm" disabled={pending || drafts === 0} onClick={() => setPublishing(true)}>
              Publish month
            </Button>
          </div>
        )}
      </div>

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>
            {notice.text}
            {notice.moves?.length ? (
              <ul className="mt-2 flex flex-col gap-1">
                {notice.moves.map((m) => (
                  <li key={m.href}>
                    <Link href={m.href} className={textLinkClass}>
                      {m.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        </div>
      )}

      {person ? (
        <PersonMonthView grid={grid} person={person} cells={cells} today={today} clock={clockView} {...editProps} />
      ) : (
        <TeamMonth grid={grid} days={days} cells={cells} today={today} clock={clockView} {...editProps} />
      )}

      <p className="mt-2 text-xs text-ink-muted">
        {editable ? "Dashed days are drafts: nobody sees them until you publish. Tap a day to change it." : "Shows the published schedule."} Hours are shifts less approved time off.
      </p>

      {editing && (
        <DayEditor
          key={cellKey(editing.cell.staffId, editing.cell.date)}
          anchor={editing.anchor}
          cell={cells.get(cellKey(editing.cell.staffId, editing.cell.date)) ?? editing.cell}
          person={grid.people.find((p) => p.id === editing.cell.staffId)!}
          open={grid.open[editing.cell.date] ?? []}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(shifts) => {
            const { staffId, date } = editing.cell;
            setEditing(null);
            save([{ staffId, date, shifts }]);
          }}
        />
      )}
      {punching && person && clockView && (
        <PunchSheet
          person={person}
          cell={punching}
          entries={clockView.entries.filter((e) => e.staffId === person.id && entryDay(e, clockView.timeZone) === punching.date)}
          timeZone={clockView.timeZone}
          pending={pending}
          onClose={() => setPunching(null)}
          onSave={(input) => run(async () => {
            const r = await saveTimeEntry(input);
            if (r.ok) setPunching(null);
            return r;
          })}
        />
      )}
      {copying === "week" && (
        <CopyWeekSheet grid={grid} person={person} today={today} pending={pending} onClose={() => setCopying(null)} onCopy={(week, weeks, staffId) => run(() => copyWeekForward(week, weeks, staffId))} />
      )}
      {copying === "person" && person && (
        <CopyPersonSheet grid={grid} person={person} today={today} pending={pending} onClose={() => setCopying(null)} onCopy={(fromId, from, to) => run(() => copyFromPerson(fromId, person.id, from, to))} />
      )}
      {publishing && (
        <PublishSheet
          title="Publish this month"
          changes={changes}
          people={grid.people}
          pending={pending}
          onClose={() => setPublishing(false)}
          onPublish={(moveClients) =>
            start(async () => {
              const r = await publishWeeks(grid.weeks.map((w) => w[0]));
              setPublishing(false);
              if (!r.ok) setNotice({ tone: "error", text: r.message });
              else {
                setNotice({ tone: "success", text: r.message, moves: r.moves });
                if (moveClients && r.moves.length) router.push(r.moves[0].href);
                else router.refresh();
              }
            })
          }
        />
      )}
    </div>
  );
}

type EditProps = {
  canEdit: (date: LocalDate) => boolean;
  onEdit: (cell: Cell, anchor: HTMLElement) => void;
  canClock: (date: LocalDate) => boolean;
  onClock: (cell: Cell) => void;
};
type ClockView = { entries: ClockEntry[]; timeZone: string; now: Date } | null;

// One day's hours, small: each shift on its own line, or time off.
function DayHours({ cell, open, size = "sm" }: { cell: Cell; open: { start: number; end: number }[]; size?: "sm" | "lg" }) {
  const shifts = shown(cell);
  const text = size === "sm" ? "text-2xs" : "text-xs";
  if (open.length === 0) return null;
  return (
    <span className={`flex flex-col items-start gap-0.5 ${text} leading-tight tabular-nums`}>
      {shifts.map((s, i) => (
        <span key={i} className="font-medium whitespace-nowrap text-ink">
          {pillText(s)}
        </span>
      ))}
      {cell.timeOff.map((t, i) => (
        <span key={`off-${i}`} className="inline-flex items-center gap-1 whitespace-nowrap text-ink-muted" title={`Time off ${offText(t, shifts) === "Time off" ? "all day" : pillText(t)}`} data-testid="time-off">
          <span aria-hidden className="size-2.5 shrink-0 rounded-sm bg-[repeating-linear-gradient(135deg,var(--color-ink-subtle)_0_2px,transparent_2px_4px)]" />
          {size === "lg" ? offText(t, shifts) : offText(t, shifts) === "Time off" ? "Off" : pillText(t)}
        </span>
      ))}
      {shifts.length === 0 && cell.timeOff.length === 0 && <span className="text-ink-subtle">Off</span>}
    </span>
  );
}

// A day's cell, as a button when it can be changed.
function DayCell({ cell, person, open, canEdit, onEdit, canClock, onClock, className, children }: EditProps & { cell: Cell; person: GridPerson; open: { start: number; end: number }[]; className: string; children: React.ReactNode }) {
  const draft = cell.draft !== null;
  const left = outside(cell, shown(cell)).length;
  const closed = open.length === 0;
  const label = `${person.firstName}, ${formatDay(cell.date)}: ${closed ? "salon closed" : sayShifts(shown(cell))}${cell.timeOff.length ? ", time off" : ""}${draft ? ", draft" : ""}`;
  const look = `${className} relative ${draft ? "outline-1 -outline-offset-2 outline-active outline-dashed bg-active-soft" : closed ? "bg-sunken" : ""}`;
  const flag = left > 0 && (
    <span className="absolute top-0.5 right-0.5 text-warning" title={`${left} ${left === 1 ? "client" : "clients"} booked outside these hours`} data-testid="clients-outside">
      <WarningIcon className="size-3" />
    </span>
  );
  const clocking = canClock(cell.date);
  return clocking || (canEdit(cell.date) && !closed) ? (
    <button
      type="button"
      className={`${look} text-left hover:bg-sunken/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus`}
      aria-label={clocking ? `Clocked hours, ${person.firstName}, ${formatDay(cell.date)}` : `Edit ${label}`}
      title={label}
      data-cell
      data-staff={cell.staffId}
      data-date={cell.date}
      data-draft={draft || undefined}
      onClick={(e) => (clocking ? onClock(cell) : onEdit(cell, e.currentTarget))}
    >
      {children}
      {flag}
    </button>
  ) : (
    <div className={look} title={label} data-cell data-staff={cell.staffId} data-date={cell.date} data-draft={draft || undefined} data-closed={closed || undefined}>
      {children}
      {flag}
    </div>
  );
}

// Everyone's month: a row per person, a column per day.
function TeamMonth({ grid, days, cells, today, clock, ...edit }: EditProps & { grid: MonthGrid; days: LocalDate[]; cells: Map<string, Cell>; today: LocalDate; clock: ClockView }) {
  const scroller = useRef<HTMLDivElement>(null);
  const groups = ROLE_GROUPS.map((g) => ({
    ...g,
    people: grid.people.filter((p) => g.roles.includes(p.role) && (g.always || days.some((d) => shown(cells.get(cellKey(p.id, d))!).length > 0))),
  })).filter((g) => g.people.length > 0);
  return (
    <div className="relative">
      <div ref={scroller} className="overflow-x-auto overscroll-x-contain rounded-xl border border-line bg-surface">
        <div role="grid" aria-label={`Team schedule, ${monthLabel(grid.month)}`} className="grid" style={{ gridTemplateColumns: `12rem repeat(${days.length}, minmax(3.25rem, 1fr))` }}>
          <div role="row" className="contents">
            <div role="columnheader" className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-2 text-13 font-medium text-ink-muted">
              Team
            </div>
            {days.map((d) => {
              const flags = grid.flags[d]?.filter(() => d >= today) ?? [];
              const closed = (grid.open[d] ?? []).length === 0;
              return (
                <div key={d} role="columnheader" data-day={d} data-flags={flags.length || undefined} title={closed ? "Closed" : flags.map((f) => f.text).join("\n") || undefined} className={`flex flex-col items-center border-b border-l border-line px-1 py-1.5 ${d === today ? "bg-active-soft" : closed ? "bg-sunken" : ""}`}>
                  <span className={`text-2xs ${d === today ? "text-active-ink" : "text-ink-muted"}`}>{weekdayOf(d).slice(0, 2)}</span>
                  <span className={`text-13 font-semibold tabular-nums ${d === today ? "text-active-ink" : "text-ink"}`}>{dayNumber(d)}</span>
                  {flags.length > 0 ? (
                    <span className="text-warning" data-testid="day-flag">
                      <WarningIcon className="size-3.5" />
                      <span className="sr-only">
                        {flags.length} {flags.length === 1 ? "thing" : "things"} to check: {flags.map((f) => f.text).join(" ")}
                      </span>
                    </span>
                  ) : (
                    <span aria-hidden className="h-3.5" />
                  )}
                </div>
              );
            })}
          </div>
          {groups.map((g) => (
            <div key={g.key} role="rowgroup" aria-label={g.label} className="contents">
              <div role="row" className="contents">
                <div role="rowheader" className="sticky left-0 z-10 border-b border-line bg-sunken px-4 py-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase" style={{ gridColumn: `span ${days.length + 1}` }}>
                  {g.label}
                </div>
              </div>
              {g.people.map((p) => {
                const totals = personMonth([...cells.values()], p.id, grid.month);
                return (
                  <div key={p.id} role="row" className="contents" data-person={p.id}>
                    <div role="rowheader" className="sticky left-0 z-10 flex items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
                      <Avatar name={p.name} color={p.color} level={p.level} photoUrl={p.photoUrl} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/scheduling/month?month=${grid.month}&staff=${p.id}`} className={`${nameLinkClass} block text-sm leading-snug text-pretty break-words`} data-testid="month-person">
                          {p.name}
                        </Link>
                        <p className="text-xs text-ink-muted tabular-nums" data-testid="month-hours">
                          {hours(totals.scheduled)}
                          {clock && ` · ${hours(clocked(clock, cells, p.id, days))} clocked`}
                          {p.cycleWeeks > 1 ? ` · ${p.cycleWeeks}-week pattern` : ""}
                        </p>
                      </div>
                    </div>
                    {days.map((d) => {
                      const cell = cells.get(cellKey(p.id, d))!;
                      return (
                        <DayCell key={d} cell={cell} person={p} open={grid.open[d] ?? []} className="min-h-12 min-w-0 overflow-hidden border-b border-l border-line px-1 py-1" {...edit}>
                          <DayHours cell={cell} open={grid.open[d] ?? []} />
                        </DayCell>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <SideScrollEdges target={scroller} label="More days" leftInset="12rem" />
    </div>
  );
}

// One person's month as a calendar, Monday to Sunday, with their totals.
function PersonMonthView({ grid, person, cells, today, clock, ...edit }: EditProps & { grid: MonthGrid; person: GridPerson; cells: Map<string, Cell>; today: LocalDate; clock: ClockView }) {
  const totals = personMonth([...cells.values()], person.id, grid.month);
  const monthDays = grid.weeks.flat().filter((d) => d.startsWith(grid.month));
  const clockedDays = clock
    ? new Map(clockDays(person.id, monthDays.map((d) => ({ date: d, minutes: scheduledMinutes(cells.get(cellKey(person.id, d))!) })), clock.entries, clock.timeZone, clock.now).map((d) => [d.date, d]))
    : null;
  // Scheduled against clocked, up to today (the rest isn't worked yet).
  const sofar = clockedDays ? [...clockedDays.values()].filter((d) => d.date <= today) : [];
  const worked = sofar.reduce((n, d) => n + d.worked, 0);
  const facts = [
    { label: "Scheduled", value: hours(totals.scheduled) },
    ...(clockedDays ? [{ label: "Clocked so far", value: `${hours(worked)} · ${differenceText(worked, sofar.reduce((n, d) => n + d.scheduled, 0))}` }] : []),
    { label: "Days working", value: String(totals.days) },
    { label: "Days with time off", value: String(totals.timeOffDays) },
    { label: "Clients booked", value: String(totals.clients) },
  ];
  return (
    <div className="flex flex-col gap-4" data-testid="person-month">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={person.name} color={person.color} level={person.level} photoUrl={person.photoUrl} size="md" />
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-semibold text-ink">{person.name}</h3>
          <p className="text-13 text-ink-muted">
            {patternLabel(person.cycleWeeks)}
            {person.chair ? ` · ${person.chair}` : ""}
          </p>
        </div>
        <Link href={`/scheduling/month?month=${grid.month}`} className={textLinkClass}>
          Everyone&rsquo;s month
        </Link>
      </div>
      <dl className={`grid grid-cols-2 gap-3 ${clockedDays ? "sm:grid-cols-5" : "sm:grid-cols-4"}`} data-testid="person-month-totals">
        {facts.map((f) => (
          <div key={f.label} className="rounded-lg border border-line bg-surface px-4 py-3">
            <dt className="text-xs text-ink-muted">{f.label}</dt>
            <dd className="text-base font-semibold text-ink tabular-nums">{f.value}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line bg-sunken" aria-hidden>
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-1.5 text-xs font-medium text-ink-muted">
              {w}
            </div>
          ))}
        </div>
        <div role="grid" aria-label={`${person.firstName}'s ${monthLabel(grid.month)}`} className="grid grid-cols-7">
          {grid.weeks.flat().map((d) => {
            const cell = cells.get(cellKey(person.id, d));
            const inMonth = d.startsWith(grid.month);
            if (!cell || !inMonth) return <div key={d} aria-hidden className="min-h-20 border-r border-b border-line bg-canvas [&:nth-child(7n)]:border-r-0" />;
            const open = grid.open[d] ?? [];
            const clients = new Set(cell.booked.map((b) => b.appointmentId)).size;
            return (
              <DayCell key={d} cell={cell} person={person} open={open} className="flex min-h-20 flex-col gap-1 border-r border-b border-line px-2 py-1.5 [&:nth-child(7n)]:border-r-0" {...edit}>
                <span className={`text-13 tabular-nums ${d === today ? "inline-flex size-6 items-center justify-center rounded-full bg-active font-semibold text-white" : "font-medium text-ink"}`}>{dayNumber(d)}</span>
                {open.length === 0 ? <span className="text-xs text-ink-subtle">Closed</span> : <DayHours cell={cell} open={open} size="lg" />}
                {clients > 0 && <span className="text-2xs text-ink-muted">{clients === 1 ? "1 client" : `${clients} clients`}</span>}
                {clockedDays && d <= today && <ClockLine day={clockedDays.get(d)!} />}
              </DayCell>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CopyWeekSheet({ grid, person, today, pending, onClose, onCopy }: { grid: MonthGrid; person: GridPerson | null; today: LocalDate; pending: boolean; onClose: () => void; onCopy: (week: LocalDate, weeks: number, staffId: string | null) => void }) {
  const weeks = grid.weeks.map((w) => w[0]);
  const [week, setWeek] = useState(weeks.find((w) => addDays(w, 6) >= today) ?? weeks[0]);
  const [count, setCount] = useState(4);
  const [who, setWho] = useState(person?.id ?? "");
  return (
    <Sheet title="Copy a week forward" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onCopy(week, count, who || null);
        }}
      >
        <p className="text-sm text-ink-muted">Repeats a week&rsquo;s shifts on the weeks after it, into the draft. Days already past stay as they are.</p>
        <label className={labelClass}>
          Copy the week of
          <select className={selectClass} value={week} onChange={(e) => setWeek(e.target.value)}>
            {weeks.map((w) => (
              <option key={w} value={w}>
                {formatDay(w, true)}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Onto the next
          <select className={selectClass} value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from({ length: MAX_COPY_WEEKS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "week" : "weeks"}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          For
          <select className={selectClass} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {grid.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            Copy into the draft
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function CopyPersonSheet({ grid, person, today, pending, onClose, onCopy }: { grid: MonthGrid; person: GridPerson; today: LocalDate; pending: boolean; onClose: () => void; onCopy: (fromId: string, from: LocalDate, to: LocalDate) => void }) {
  // Others in the same role first.
  const others = grid.people.filter((p) => p.id !== person.id).sort((a, b) => Number(b.role === person.role) - Number(a.role === person.role));
  const first = `${grid.month}-01`;
  const last = grid.weeks.flat().filter((d) => d.startsWith(grid.month)).at(-1)!;
  const [fromId, setFromId] = useState(others[0]?.id ?? "");
  const [from, setFrom] = useState(first < today ? (today <= last ? today : first) : first);
  const [to, setTo] = useState(last);
  return (
    <Sheet title={`Copy days to ${person.firstName}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (fromId) onCopy(fromId, from, to);
        }}
      >
        <p className="text-sm text-ink-muted">
          {person.firstName} gets the same shifts as the person you choose on each of these days, days off included, into the draft.
        </p>
        <label className={labelClass}>
          Copy from
          <select className={selectClass} value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            From
            <input type="date" className={fieldClass} value={from} min={today} onChange={(e) => setFrom(e.target.value)} required />
          </label>
          <label className={labelClass}>
            To
            <input type="date" className={fieldClass} value={to} min={from} onChange={(e) => setTo(e.target.value)} required />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !fromId}>
            Copy into the draft
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

// Minutes someone clocked on these days.
function clocked(clock: NonNullable<ClockView>, cells: Map<string, Cell>, staffId: string, days: LocalDate[]): number {
  const set = new Set(days);
  return clock.entries.filter((e) => e.staffId === staffId && set.has(entryDay(e, clock.timeZone))).reduce((n, e) => n + entryMinutes(e, clock.now), 0);
}

// Under a past day on someone's month: what they clocked, or what's wrong.
function ClockLine({ day }: { day: DayHours }) {
  if (day.missedOut)
    return (
      <span className="text-2xs font-medium text-warning" data-testid="clock-line" data-problem="missed_out">
        No clock-out
      </span>
    );
  if (day.noPunch)
    return (
      <span className="text-2xs font-medium text-warning" data-testid="clock-line" data-problem="no_punch">
        Didn&rsquo;t clock in
      </span>
    );
  if (!day.entries.length) return null;
  return (
    <span className="text-2xs text-ink-muted tabular-nums" data-testid="clock-line">
      Clocked {formatDuration(day.worked)}
    </span>
  );
}

const SOURCES: Record<string, string> = { own: "On their phone", front_desk: "At the front desk", manager: "Added by a manager" };
const hhmm = (d: Date, tz: string) => {
  const m = toLocal(d, tz).minute;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// A day's punches for someone, for a manager to fix: change a time, remove
// one, or add one they missed, always with a reason (logged with who).
function PunchSheet({ person, cell, entries, timeZone, pending, onClose, onSave }: { person: GridPerson; cell: Cell; entries: ClockEntry[]; timeZone: string; pending: boolean; onClose: () => void; onSave: (input: TimeEntryInput) => void }) {
  const [reason, setReason] = useState("");
  const [times, setTimes] = useState(() => Object.fromEntries(entries.map((e) => [e.id, { in: hhmm(e.clockIn, timeZone), out: e.clockOut ? hhmm(e.clockOut, timeZone) : "" }])));
  const [add, setAdd] = useState({ in: "", out: "" });
  const save = (input: Omit<TimeEntryInput, "staffId" | "date" | "reason">) => onSave({ ...input, staffId: person.id, date: cell.date, reason });
  const shifts = shown(cell);
  return (
    <Sheet title={`${person.firstName} · ${formatDay(cell.date)}`} onClose={onClose}>
      <div className="flex flex-col gap-4" data-testid="punch-sheet">
        <p className="text-13 text-ink-muted">Scheduled: {sayShifts(shifts)}{cell.timeOff.length ? " · approved time off" : ""}</p>
        <label className={labelClass}>
          Reason for the change
          <input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Forgot to clock out" maxLength={300} />
        </label>
        {entries.length === 0 && <p className="text-sm text-ink-muted">No punches this day.</p>}
        <ul className="flex flex-col gap-3">
          {entries.map((e, i) => (
            <li key={e.id} className="flex flex-col gap-2 rounded-lg border border-line p-3" data-testid="punch">
              <p className="text-13 text-ink-muted">
                {SOURCES[(e as ClockEntry & { source?: string }).source ?? "own"] ?? ""}
                {e.edited ? " · changed by a manager" : ""}
                {e.clockOut ? "" : e.missedOut ? " · clock-out missed" : " · still clocked in"}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>
                  In
                  <input type="time" className={fieldClass} value={times[e.id].in} onChange={(ev) => setTimes({ ...times, [e.id]: { ...times[e.id], in: ev.target.value } })} aria-label={`Punch ${i + 1} in`} />
                </label>
                <label className={labelClass}>
                  Out
                  <input type="time" className={fieldClass} value={times[e.id].out} onChange={(ev) => setTimes({ ...times, [e.id]: { ...times[e.id], out: ev.target.value } })} aria-label={`Punch ${i + 1} out`} />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="quiet" size="sm" disabled={pending} onClick={() => save({ entryId: e.id, clockIn: times[e.id].in, clockOut: null, remove: true })}>
                  Remove
                </Button>
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => save({ entryId: e.id, clockIn: times[e.id].in, clockOut: times[e.id].out || null })}>
                  Save change
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-sm font-semibold text-ink">Add a punch</p>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              In
              <input type="time" className={fieldClass} value={add.in} onChange={(e) => setAdd({ ...add, in: e.target.value })} aria-label="New punch in" />
            </label>
            <label className={labelClass}>
              Out
              <input type="time" className={fieldClass} value={add.out} onChange={(e) => setAdd({ ...add, out: e.target.value })} aria-label="New punch out" />
            </label>
          </div>
          <Button className="self-end" disabled={pending || !add.in} onClick={() => save({ entryId: null, clockIn: add.in, clockOut: add.out || null })}>
            Add punch
          </Button>
        </div>
        <p className="text-xs text-ink-muted">Every change is kept with who made it and why, in the Audit trail.</p>
      </div>
    </Sheet>
  );
}
