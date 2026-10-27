"use client";

// "Mark … out" on a stylist's column: a side panel by the calendar. Choose
// when they're out (All day, Leaving early… or Coming in late…) and
// Denise's plan for their clients updates at once: a row per client with
// where they go (Move or Reschedule, and why), any of which can be changed.
// Where they'd move shows dashed on the calendar while the panel is open.
// "Apply plan" marks them out and moves everyone at once (all or nothing),
// then goes on to each client's message; "Mark out only" leaves the
// clients to the front desk (and Denise's fixes). Stylists can only mark
// themselves out.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { DeniseFace } from "@/components/denise";
import { Button, IconButton } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { ChevronDownIcon, CloseIcon } from "@/components/ui/icons";
import { useKeepOnScreen } from "@/components/ui/keep-on-screen";
import { Listbox } from "@/components/ui/listbox";
import { Alert, Badge, nameLinkClass, textLinkClass } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { useUnsavedChanges } from "@/components/unsaved";
import { smsCounterText } from "@/lib/messaging/templates";
import { reach } from "@/lib/reach";
import { clashingRows, movesOf, type OutWhen, type RescueChoice, type RescueRow } from "@/lib/rescue";
import { formatMinute, fromLocal, toLocal } from "@/lib/scheduling/time";
import { applyRescue, loadOutPanel, markOut, sendRescueMessage, undoRescue, type OutPanelData, type RescueMessage } from "./out-actions";

type Kind = OutWhen["kind"];
const STEP = 15;

// What the calendar shows while the panel is open: the time they're out
// (hatched on their column) and where clients would move that day.
export type OutPreview = { staffId: string; from: number; until: number | null; label: string; moves: { itemId: string; staffId: string; minute: number }[] };

const keyOf = (c: RescueChoice) => `${c.kind}|${c.label}|${c.detail ?? ""}`;
const whenKey = (w: OutWhen) => (w.kind === "all" ? "all" : `${w.kind}:${w.minute}`);

// The tag on a row: Move (another stylist, or later that day), Reschedule
// (another day), Call (left as it is) or Stays (in the chair already).
function tagOf(c: RescueChoice, row: RescueRow): { label: string; tone: "info" | "warning" | "neutral" } {
  if (c.kind === "reschedule") return { label: "Reschedule", tone: "warning" };
  if (c.kind === "leave") return { label: row.note === "in_chair" ? "Stays" : "Call", tone: "neutral" };
  return { label: "Move", tone: "info" };
}

export function OutPanel({
  staffId,
  firstName,
  date,
  today,
  timeZone,
  canPlan,
  hours,
  leaves,
  onClose,
  onPreview,
  onMarkOutOnly,
  onApplied,
}: {
  staffId: string;
  firstName: string;
  date: string;
  today: string;
  timeZone: string;
  // The front of house plans where clients go; a stylist only marks
  // themselves out.
  canPlan: boolean;
  // Their working day, for the times to choose from.
  hours: { start: number; end: number };
  // "Gil has to leave at 1" (from Denise): leaving early at that minute.
  leaves: number | null;
  onClose: () => void;
  onPreview: (preview: OutPreview | null) => void;
  // Mark them out without moving anyone: Denise does it, and her fixes
  // take it from there.
  onMarkOutOnly: (when: OutWhen) => void;
  onApplied: () => void;
}) {
  // Times to choose from, every quarter hour inside their day, and where
  // each choice starts (the next quarter hour today, else midday or two
  // hours in).
  const times = useMemo(() => {
    const out: number[] = [];
    for (let m = Math.ceil((hours.start + STEP) / STEP) * STEP; m < hours.end; m += STEP) out.push(m);
    return out;
  }, [hours.start, hours.end]);
  const nowMinute = date === today ? toLocal(new Date(), timeZone).minute : null;
  const nearest = (want: number) => times.reduce((best, m) => (Math.abs(m - want) < Math.abs(best - want) ? m : best), times[0] ?? want);
  const startFor = (kind: Kind): OutWhen =>
    kind === "all"
      ? { kind: "all" }
      : {
          kind,
          minute: nearest(kind === "early" ? (leaves ?? (nowMinute !== null && nowMinute > hours.start ? Math.ceil(nowMinute / STEP) * STEP : 13 * 60)) : hours.start + 120),
        };
  const [when, setWhen] = useState<OutWhen>(() => (leaves !== null ? startFor("early") : { kind: "all" }));

  // Plans loaded for each time out (the all-day one first, so a new choice
  // shows at once from the visits it touches, until its own plan arrives).
  const [plans, setPlans] = useState<Record<string, OutPanelData | null>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const load = (w: OutWhen) =>
    reach(loadOutPanel(staffId, date, w).then((data) => ({ ok: true as const, data }))).then((r) => {
      if (!r.ok) return setFailed(r.message ?? "I couldn't load the plan. Try again.");
      setFailed(null);
      setPlans((all) => ({ ...all, [whenKey(w)]: r.data }));
    });
  useEffect(() => {
    if (!canPlan) return;
    load({ kind: "all" });
    // Once per stylist and day, and again after applying or undoing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPlan, staffId, date, version]);
  // The chosen time's own plan, a moment after the choice settles.
  useEffect(() => {
    if (!canPlan || when.kind === "all") return;
    const id = window.setTimeout(() => load(when), 250);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPlan, whenKey(when), version]);

  const allDay = plans.all;
  const exact = plans[whenKey(when)];
  // Marked out already: the plan is for that time out, whatever's chosen.
  const marked = allDay?.plan.out ?? null;
  const span = (w: OutWhen) => {
    const dayStart = fromLocal(date, 0, timeZone)!.getTime();
    if (w.kind === "all") return { from: dayStart, until: null as number | null };
    const at = fromLocal(date, w.minute, timeZone)!.getTime();
    return w.kind === "early" ? { from: at, until: null } : { from: dayStart, until: at };
  };
  const data = marked ? allDay : (exact ?? null);
  // Until its own plan arrives: the all-day plan's visits that this time
  // out touches.
  const rows: RescueRow[] | null = data
    ? data.plan.rows
    : allDay
      ? allDay.plan.rows.filter((r) => Date.parse(r.outTo) > span(when).from && (span(when).until === null || Date.parse(r.outFrom) < span(when).until!))
      : null;
  const applied = allDay?.plan.applied ?? null;

  // Staff's own changes to a row, kept by what they chose.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const choices = (rows ?? []).map((r) => {
    const want = picked[r.appointmentId];
    const i = want ? r.choices.findIndex((c) => keyOf(c) === want) : -1;
    return i >= 0 ? i : r.choice;
  });
  useUnsavedChanges(Object.keys(picked).length > 0 && !applied);
  const clashes = new Set(clashingRows(rows ?? [], choices));
  const moves = movesOf(rows ?? [], choices);
  const moving = new Set(moves.map((m) => m.appointmentId)).size;
  const needing = (rows ?? []).filter((r) => r.note !== "in_chair");
  const counts = { move: 0, reschedule: 0, call: 0 };
  (rows ?? []).forEach((r, i) => {
    const c = r.choices[choices[i]];
    if (!c || r.note === "in_chair") return;
    if (c.kind === "reschedule") counts.reschedule++;
    else if (c.kind === "leave") counts.call++;
    else counts.move++;
  });

  // The time out and the moves, on the calendar.
  const outLabel = (w: OutWhen) => (w.kind === "all" ? (date === today ? "Out today" : "Out all day") : w.kind === "early" ? `Out from ${formatMinute(w.minute)}` : `Out until ${formatMinute(w.minute)}`);
  const markedWhen: OutWhen | null = marked
    ? marked.until
      ? { kind: "late", minute: toLocal(new Date(marked.until), timeZone).minute }
      : marked.allDay
        ? { kind: "all" }
        : { kind: "early", minute: toLocal(new Date(marked.from), timeZone).minute }
    : null;
  const shownWhen = markedWhen ?? when;
  const previewKey = JSON.stringify([shownWhen, applied ? [] : moves.map((m) => [m.itemId, m.staffId, m.start])]);
  useEffect(() => {
    const w = shownWhen;
    const from = w.kind === "early" ? w.minute : hours.start;
    const until = w.kind === "late" ? w.minute : null;
    onPreview({
      staffId,
      from,
      until,
      label: outLabel(w),
      moves: applied
        ? []
        : moves.flatMap((m) => {
            const local = toLocal(new Date(m.start), timeZone);
            return local.date === date ? [{ itemId: m.itemId, staffId: m.staffId, minute: local.minute }] : [];
          }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const refresh = () => {
    setPicked({});
    setPlans({});
    setVersion((v) => v + 1);
  };

  function apply() {
    setMessage(null);
    start(async () => {
      const r = await reach(
        applyRescue(
          staffId,
          date,
          when,
          moves.map((m) => ({ appointmentId: m.appointmentId, itemId: m.itemId, staffId: m.staffId, resourceId: m.resourceId, start: m.start })),
        ),
      );
      if (!r.ok) {
        setMessage(r.message);
        if ("markedOut" in r && r.markedOut) refresh();
        return;
      }
      onApplied();
      refresh();
    });
  }

  function markOnly() {
    setMessage(null);
    if (canPlan && needing.length) return onMarkOutOnly(when);
    start(async () => {
      const r = await reach(markOut(staffId, date, marked ? (markedWhen ?? when) : when));
      if (!r.ok) return setMessage(r.message);
      setDone(canPlan ? `${firstName} is marked out. No clients affected.` : "You're marked out. The front desk will move your clients.");
      setPicked({});
      onApplied();
    });
  }

  function undo(actionId: string) {
    setMessage(null);
    start(async () => {
      const r = await reach(undoRescue(actionId));
      if (!r.ok) return setMessage(r.message);
      onApplied();
      refresh();
    });
  }

  const title = `${firstName} is out`;
  const denise = !canPlan
    ? "Choose when you're out. The front desk will find new spots for your clients."
    : applied
      ? "Everyone's moved. Here's a message for each client to check before it's sent."
      : rows === null
        ? failed ?? "Looking at the clients…"
        : needing.length === 0
          ? marked
            ? "No clients need a new spot."
            : "No clients need a new spot then."
          : `${needing.length} ${needing.length === 1 ? "client needs" : "clients need"} a new spot. Here's my plan.`;

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label={`Mark ${firstName} out`} role="region">
      <div className="flex items-start gap-3">
        <DeniseFace size={36} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="text-sm text-ink-muted" data-testid="out-denise">
            {denise}
          </p>
        </div>
        <IconButton label="Close panel" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      {done ? (
        <div className="mt-6 flex flex-col items-start gap-4">
          <Alert tone="success">{done}</Alert>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : applied && allDay ? (
        <Applied staffId={staffId} data={allDay} actionId={applied.actionId} by={applied.by} pending={pending} onUndo={undo} message={message} onSent={() => setVersion((v) => v + 1)} />
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-2">
            <Segmented
              label={`When ${firstName} is out`}
              value={shownWhen.kind}
              onChange={(k) => {
                setPicked({});
                setWhen(startFor(k));
              }}
              options={[
                { value: "all", label: "All day", disabled: !!marked },
                { value: "early", label: "Leaving early…", disabled: !!marked || times.length === 0 },
                { value: "late", label: "Coming in late…", disabled: !!marked || times.length === 0 },
              ]}
            />
            {shownWhen.kind !== "all" &&
              (marked ? (
                <p className="text-13 text-ink-muted">{outLabel(shownWhen)}.</p>
              ) : (
                <Listbox
                  label={shownWhen.kind === "early" ? "Leaves at" : "Comes in at"}
                  value={String(shownWhen.minute)}
                  options={times.map((m) => ({ value: String(m), label: `${shownWhen.kind === "early" ? "Leaves at" : "Comes in at"} ${formatMinute(m)}` }))}
                  onChange={(v) => {
                    setPicked({});
                    setWhen({ kind: shownWhen.kind, minute: Number(v) });
                  }}
                />
              ))}
            {marked && <p className="text-13 text-ink-muted">Marked out already. Apply the plan to move the clients.</p>}
          </div>

          {canPlan && rows && rows.length > 0 && (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="out-summary">
                {counts.move > 0 && <Badge tone="success">{counts.move} move</Badge>}
                {counts.reschedule > 0 && <Badge tone="warning">{counts.reschedule} reschedule</Badge>}
                {counts.call > 0 && <Badge>{counts.call} to call</Badge>}
                {counts.move > 0 && <span className="text-xs text-ink-subtle">Moves show dashed on the calendar</span>}
              </div>
              <ol className="mt-3 -mr-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2" aria-label={`${firstName}'s clients`}>
                {rows.map((row, i) => (
                  <PlanRow
                    key={row.appointmentId}
                    row={row}
                    choice={choices[i]}
                    clash={clashes.has(i)}
                    onChoose={(k) => setPicked((all) => ({ ...all, [row.appointmentId]: keyOf(row.choices[k]) }))}
                  />
                ))}
              </ol>
            </>
          )}
          {canPlan && rows && rows.length === 0 && <div className="flex-1" />}
          {(!canPlan || rows === null) && <div className="flex-1" />}

          <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
            {message && <Alert>{message}</Alert>}
            {canPlan && rows && moving > 0 ? (
              <>
                <Button variant="primary" size="lg" onClick={apply} disabled={pending || clashes.size > 0 || (exact === undefined && !marked)} data-testid="apply-plan">
                  {pending ? "Applying…" : `Apply plan · ${moving} ${moving === 1 ? "client" : "clients"}`}
                </Button>
                {!marked && (
                  <button type="button" className={`${textLinkClass} self-center text-sm`} onClick={markOnly} disabled={pending}>
                    Mark out only, I&apos;ll handle clients
                  </button>
                )}
                <p className="text-center text-xs text-ink-subtle">{clashes.size > 0 ? "Change the clients that clash first." : "Next: review a message to each client before it's sent. Undo anytime."}</p>
              </>
            ) : (
              !marked && (
                <Button variant="primary" size="lg" onClick={markOnly} disabled={pending || (canPlan && rows === null)} data-testid="mark-out">
                  {pending ? "Marking out…" : canPlan ? `Mark ${firstName} out` : "Mark me out"}
                </Button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PlanRow({ row, choice, clash, onChoose }: { row: RescueRow; choice: number; clash: boolean; onChoose: (k: number) => void }) {
  const c = row.choices[choice];
  const tag = tagOf(c, row);
  const reason = clash ? "Clashes with a client above. Choose another." : [row.noteShort, c.detail].filter(Boolean).join(" · ") || null;
  return (
    <li className="flex flex-col gap-2" data-testid="out-row">
      <div className="flex items-baseline gap-3">
        <span className="w-14 shrink-0 text-13 text-ink-muted tabular-nums">{row.start}</span>
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {row.clientId ? (
              <a href={`/clients/${row.clientId}`} className={nameLinkClass}>
                {row.clientName}
              </a>
            ) : (
              row.clientName
            )}
          </p>
          <p className="text-13 text-ink-muted">
            {row.services} · {row.length}
          </p>
        </div>
      </div>
      <div className="ml-[4.25rem] flex items-start gap-2 rounded-lg border border-line bg-sunken/60 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={clash ? "danger" : tag.tone}>{clash ? "Clashes" : tag.label}</Badge>
            <span className="text-sm text-ink" data-testid="out-choice">
              {c.label}
            </span>
          </div>
          {reason && <p className="mt-0.5 text-13 text-ink-muted">{reason}</p>}
        </div>
        {row.choices.length > 1 && <ChangeMenu row={row} choice={choice} onChoose={onChoose} />}
      </div>
    </li>
  );
}

// "Change": the other places this client could go, each with its reason.
function ChangeMenu({ row, choice, onChoose }: { row: RescueRow; choice: number; onChoose: (k: number) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const byKeys = useRef(false);
  useKeepOnScreen(menu, open);
  useEffect(() => {
    if (!open) return;
    if (byKeys.current) menu.current?.querySelector<HTMLElement>("[role=menuitemradio]")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const name = row.firstName ?? row.clientName;
  return (
    <div
      ref={root}
      className="relative shrink-0"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          return;
        }
        if (!open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
        e.preventDefault();
        const all = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
        const i = all.indexOf(document.activeElement as HTMLElement);
        all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
      }}
    >
      <Button
        size="xs"
        variant="quiet"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Change ${name}'s plan`}
        onClick={(e) => {
          byKeys.current = e.detail === 0;
          setOpen(!open);
        }}
      >
        Change
        <ChevronDownIcon className={`size-3.5 ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={`Where ${name} goes`}
          className="absolute top-full right-0 z-50 mt-1 flex w-72 origin-top-right animate-pop-in flex-col rounded-lg border border-line bg-surface p-1.5 shadow-lift"
        >
          {row.choices.map((c, k) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={k === choice}
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                onChoose(k);
              }}
              className={`flex flex-col items-start rounded-md px-3 py-2 text-left transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none ${k === choice ? "bg-sunken" : ""}`}
            >
              <span className={`text-sm ${k === choice ? "font-semibold text-navy-900" : "text-ink"}`}>{c.label}</span>
              {c.detail && <span className="text-xs text-ink-muted">{c.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Message = RescueMessage & { clientName: string };

// After applying: Undo, and each client's message to check and send.
function Applied({
  staffId,
  data,
  actionId,
  by,
  pending,
  onUndo,
  message,
  onSent,
}: {
  staffId: string;
  data: OutPanelData;
  actionId: string;
  by: string | null;
  pending: boolean;
  onUndo: (actionId: string) => void;
  message: string | null;
  onSent: () => void;
}) {
  const unsent = data.messages.filter((m) => !m.sent && m.channel);
  const [sending, startSending] = useTransition();
  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
      <Alert tone="success">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Plan applied{by ? ` by ${by}` : ""}. The stylists taking clients have a notice on My day.</span>
          <Button size="sm" onClick={() => onUndo(actionId)} disabled={pending}>
            Undo all
          </Button>
        </div>
      </Alert>
      {message && <Alert>{message}</Alert>}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-13 font-medium text-ink-muted">Messages to clients ({data.messages.length})</h3>
        {unsent.length > 1 && (
          <Button
            size="sm"
            disabled={sending}
            onClick={() =>
              startSending(async () => {
                for (const m of unsent) await reach(sendRescueMessage({ appointmentId: m.appointmentId, staffId, template: m.template, channel: m.channel!, edited: null, subject: m.subject }));
                onSent();
              })
            }
          >
            {sending ? "Sending…" : `Send all (${unsent.length})`}
          </Button>
        )}
      </div>
      {data.messages.length === 0 ? (
        <p className="text-sm text-ink-muted">No one to message.</p>
      ) : (
        <ul className="-mr-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2">
          {data.messages.map((m) => (
            <MessageRow key={m.appointmentId} staffId={staffId} message={m} freeText={data.freeText} onSent={onSent} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageRow({ staffId, message: m, freeText, onSent }: { staffId: string; message: Message; freeText: boolean; onSent: () => void }) {
  const [body, setBody] = useState(m.body);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const edited = body.trim() !== m.body.trim();
  const counter = m.channel === "sms" ? smsCounterText(body) : null;

  function send() {
    if (!m.channel) return;
    start(async () => {
      const r = await reach(sendRescueMessage({ appointmentId: m.appointmentId, staffId, template: m.template, channel: m.channel!, edited: edited ? body : null, subject: m.subject }));
      setResult(r.ok ? null : r.message);
      if (r.ok) onSent();
    });
  }

  return (
    <li className="rounded-lg border border-line bg-surface p-3" data-testid="out-message">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink">{m.clientName}</p>
        {m.sent ? <Badge tone="success">Sent</Badge> : m.channel ? <Badge>{m.channel === "sms" ? "Text" : "Email"}</Badge> : <Badge tone="warning">No messages: call</Badge>}
      </div>
      {m.sent || !m.channel ? (
        <p className="text-sm whitespace-pre-line text-ink-muted">{m.body}</p>
      ) : (
        <>
          <label className="sr-only" htmlFor={`msg-${m.appointmentId}`}>
            Message to {m.clientName}
          </label>
          <textarea id={`msg-${m.appointmentId}`} value={body} onChange={(e) => setBody(e.target.value)} readOnly={!freeText} rows={4} className={`${fieldClass} h-auto py-2`} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={send} disabled={pending || !body.trim()}>
              {pending ? "Sending…" : "Send"}
            </Button>
            {counter && <span className={`text-xs ${counter.warn ? "text-warning" : "text-ink-subtle"}`}>{counter.text}</span>}
            {!freeText && <span className="text-xs text-ink-subtle">Your role sends the template as it is.</span>}
          </div>
        </>
      )}
      {result && <Alert className="mt-2">{result}</Alert>}
    </li>
  );
}
