"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CheckCircleIcon, ChevronDownIcon, GlobeIcon, MoreIcon, PhoneIcon, WarningIcon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/tabs";
import { PatchTestForm } from "@/app/clients/patch-test-form";
import { ClientInsightLine } from "@/components/client-insight-line";
import { VisitPhotosTab } from "@/components/visit-photos";
import { ACTION_LABELS, allowedActions, CANCEL_REASONS, canEditNotes, isEditable, MAX_NOTES, STATUS_LABELS, type AppointmentAction } from "@/lib/appointments";
import type { ChecklistItem } from "@/lib/client-checks";
import { nextStep, timerState, timerStatus, visitStatusText } from "@/lib/visit-times";
import { formatLongDay } from "@/lib/schedule-format";
import { LATE_MINUTES } from "@/lib/scheduling/disruptions";
import { addDays, formatMinute, minuteToTime, parseTime, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { UsageLinesEditor, toUsageJson, type DraftLine } from "@/components/usage-lines";
import type { PickerProduct } from "@/lib/inventory-load";
import { addVisitFormula, changeGroupVisitStatus, changeVisitStatus, changeVisitStatusScoped, checkInWithPatchOverride, moveVisitToDay, saveVisitNotes, undoVisitCheckIn, undoVisitNoShow } from "./actions";
import { IdeasCard } from "./booking-panel";
import type { BookingIdeas } from "@/lib/denise/ideas";
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
  onCheckedIn,
  onNoShow,
  onMoved,
  team,
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
  // Just checked in from here: the calendar offers Undo for a few seconds.
  onCheckedIn: (appointmentId: string) => void;
  // Just marked a no-show from here: the calendar offers Undo too.
  onNoShow: (appointmentId: string) => void;
  // Moved to another day (or time): the calendar follows it there.
  onMoved: (date: LocalDate, appointmentId: string, message: string) => void;
  // Who can be named as doing a patch test.
  team: { id: string; name: string }[];
}) {
  const { client, items, status } = appointment;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [confirmingCheckIn, setConfirmingCheckIn] = useState(false);
  const [confirmingNoShow, setConfirmingNoShow] = useState(false);
  const [moving, setMoving] = useState(false);
  const [reportingLate, setReportingLate] = useState(false);
  const [tab, setTab] = useState<"notes" | "formula" | "photos" | "history">("notes");
  // What the visit still needs before it goes ahead.
  const checklist = client && (status === "booked" || status === "confirmed" || status === "checked_in") ? (appointment.warnings?.checklist ?? []) : [];
  const outstanding = checklist.filter((c) => !c.done);
  const firstName = client?.name.split(" ")[0] ?? "This client";

  const total = items.reduce((sum, i) => sum + i.priceCents, 0);
  const notesEditable = canEditNotes(me.role, me.staffId, items.map((i) => i.staffId));
  const actions = me.canBook ? allowedActions(status) : [];
  // Check in, then Check out. (A stylist can tap a service's own times on My day.)
  const step = nextStep(status, me.canBook);
  // The front of house, or a stylist on the visit, can say it's running late.
  const canReportLate = date >= today && isEditable(status) && (me.canBook || items.some((i) => i.staffId === me.staffId));
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
      else if (action === "check_in") onCheckedIn(appointment.id);
      else if (action === "no_show") {
        setConfirmingNoShow(false);
        onNoShow(appointment.id);
      }
      else if (action === "cancel") {
        // Canceled visits leave the calendar; Denise looks at the time freed.
        onClose();
        onCanceled(appointment.id);
      }
      else setCanceling(false);
    });
  }

  function checkIn() {
    setConfirmingCheckIn(false);
    run("check_in");
  }

  // A manager or owner, past a patch test the salon requires.
  function overrideCheckIn(reason: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await checkInWithPatchOverride(appointment.id, reason);
      if (!result.ok) return setMessage(result.message);
      setConfirmingCheckIn(false);
      onCheckedIn(appointment.id);
    });
  }

  function undoCheckIn() {
    setMessage(null);
    startTransition(async () => {
      const result = await undoVisitCheckIn(appointment.id);
      if (!result.ok) setMessage(result.message);
    });
  }

  function undoNoShow() {
    setMessage(null);
    startTransition(async () => {
      const result = await undoVisitNoShow(appointment.id);
      if (!result.ok) setMessage(result.message);
    });
  }

  function primary() {
    if (!step) return;
    if (step.kind === "check_out") return onCheckout();
    if (outstanding.length) setConfirmingCheckIn(true);
    else checkIn();
  }

  // Everything but the next step, under "⋯".
  const several = items.length > 1;
  const menuActions: MenuAction[] = [
    canReportLate && { key: "late", label: "Running late", onSelect: () => setReportingLate(true) },
    me.canBook && isEditable(status) && { key: "edit", label: "Edit booking", onSelect: onEdit },
    me.canBook && (status === "booked" || status === "confirmed") && { key: "move", label: "Move to another day", onSelect: () => setMoving(true) },
    status === "checked_in" && me.canBook && { key: "undo_check_in", label: "Undo check-in", onSelect: undoCheckIn },
    actions.includes("no_show") && { key: "no_show", label: ACTION_LABELS.no_show, onSelect: () => setConfirmingNoShow(true) },
    status === "no_show" && me.canBook && { key: "undo_no_show", label: "Undo no-show", onSelect: undoNoShow },
    actions.includes("cancel") && { key: "cancel", label: ACTION_LABELS.cancel, danger: true, onSelect: () => setCanceling(true) },
  ].filter((a): a is MenuAction => Boolean(a));
  const checkedOutNote = status === "completed" && me.canBook;
  const footer = Boolean(step || menuActions.length || checkedOutNote || message);

  return (
    <div className="flex min-h-full flex-col text-sm">
      <div className="flex flex-col gap-6 pt-3 pb-6">
        {/* Who, and where the visit's at. */}
        <header className="flex items-center gap-3">
          <Avatar name={client?.name ?? appointment.group?.label ?? "Walk in"} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1">
              <h3 className="min-w-0 font-serif text-xl font-semibold text-pretty wrap-anywhere" data-testid="client-name">
                {client ? (
                  <Link href={`/clients/${client.id}`} className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                    {client.name}
                  </Link>
                ) : appointment.group ? (
                  `${appointment.group.label} guest`
                ) : (
                  "Walk-in"
                )}
              </h3>
              {client?.phone && (
                <a href={`tel:${client.phone}`} aria-label={`Call ${firstName}`} title={client.phone} className={buttonClass("ghost", "sm", "text-ink-muted hover:text-ink", { square: true })}>
                  <PhoneIcon className="size-4" />
                </a>
              )}
            </div>
            <p data-testid="visit-status" data-status={status} className="truncate text-ink-muted">
              {visitStatusText(status, STATUS_LABELS, appointment, timeZone)}
            </p>
          </div>
        </header>

        {client?.allergies && (
          <p className="-mt-3 flex items-start gap-2 font-medium text-danger">
            <WarningIcon className="mt-0.5 size-4" />
            <span>Allergy: {client.allergies}</span>
          </p>
        )}

        {/* The visit: a line a service, with its stylist, time, chair and price. */}
        <section aria-label="Visit" className="flex flex-col gap-3">
          {date !== today && (
            <p className="font-medium text-ink" data-testid="visit-date">
              {formatLongDay(date, false)}
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {items.map((i) => {
              const state = timerState(i.times);
              return (
                <li key={i.id} data-item-id={i.id} data-testid="service-timer" data-state={state} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-ink">
                      <span className="font-semibold">{i.serviceName}</span> <span className="whitespace-nowrap text-ink-muted">with {i.staffName.split(" ")[0]}</span>
                    </p>
                    <p className="text-ink-muted">
                      <span className="whitespace-nowrap">
                        {formatMinute(i.start)}–{formatMinute(i.end)}
                      </span>
                      {i.resourceName && (
                        <>
                          {" "}
                          · <span className="whitespace-nowrap">{i.resourceName}</span>
                        </>
                      )}
                    </p>
                    {/* With several services, how each one's going (the header says the current one). */}
                    {several && state !== "waiting" && (
                      <p className="text-xs text-ink-muted" aria-live="polite">
                        {timerStatus(i.times, i.bookedMinutes, timeZone)}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 tabular-nums">{formatPrice(i.priceCents)}</span>
                </li>
              );
            })}
          </ul>
          {several && (
            <p className="flex justify-between border-t border-line pt-3 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatPrice(total)}</span>
            </p>
          )}
          {appointment.membership && (
            <p className={`flex items-start gap-1.5 ${appointment.membership.status === "past_due" ? "text-status-late-ink" : "text-ink-muted"}`} data-testid="membership-info">
              <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75}>
                <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" strokeLinejoin="round" />
              </svg>
              <span>{appointment.membership.text}</span>
            </p>
          )}
          {appointment.series && (
            <p className="flex items-center gap-1.5 text-ink-muted" data-testid="series-info">
              <svg aria-hidden viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75}>
                <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.6L4 16M4 20v-4h4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Visit {appointment.series.index} of {appointment.series.count} · every {appointment.series.intervalWeeks === 1 ? "week" : `${appointment.series.intervalWeeks} weeks`}
            </p>
          )}
          {appointment.group && (
            <div data-testid="group-info" className="flex flex-col gap-1">
              <p className="text-ink-muted">
                {appointment.group.label} · {appointment.group.members.length} guest{appointment.group.members.length === 1 ? "" : "s"}
              </p>
              <ul className="flex flex-col gap-0.5" aria-label="Guests in this group">
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
        </section>

        {/* Only while something's outstanding: one row that opens the checklist. */}
        {client && outstanding.length > 0 && <VisitChecklist items={checklist} override={appointment.patchOverride} clientId={client.id} date={date} today={today} me={me} team={team} />}

        {appointment.insight && <ClientInsightLine insight={appointment.insight} />}

        <div className="flex flex-col">
          <Tabs
            label="Visit"
            quiet
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "notes", label: "Notes" },
              { value: "formula", label: "Formula" },
              { value: "photos", label: "Photos" },
              { value: "history", label: "History" },
            ]}
          >
            {tab === "notes" ? (
              <div className="flex flex-col gap-5">
                {client?.preferences && (
                  <section aria-label="Preferences" className="flex flex-col gap-1">
                    <SectionLabel>Client preferences</SectionLabel>
                    <p className="text-ink">{client.preferences}</p>
                  </section>
                )}
                <NotesForm key={appointment.id} appointmentId={appointment.id} initial={appointment.notes} editable={notesEditable} />
              </div>
            ) : tab === "formula" ? (
              <FormulaSection appointment={appointment} date={date} products={products} canRecord={canRecordFormula && Boolean(client)} />
            ) : tab === "photos" ? (
              <VisitPhotosTab key={appointment.id} appointmentId={appointment.id} today={today} />
            ) : (
              <VisitHistory appointment={appointment} />
            )}
          </Tabs>
        </div>
      </div>

      {/* One main button for the next step; everything else is under "⋯". */}
      {footer && (
        <footer aria-label="Actions" className="sticky bottom-0 mt-auto flex flex-col gap-3 border-t border-line bg-surface pt-3">
          {message && (
            <p role="alert" className="flex items-start gap-2 text-danger">
              <WarningIcon className="mt-0.5 size-4" />
              <span>{message}</span>
            </p>
          )}
          {confirmingCheckIn ? (
            <CheckInWarning
              firstName={firstName}
              outstanding={outstanding}
              canOverride={me.role === "owner" || me.role === "manager"}
              pending={pending}
              onCheckIn={checkIn}
              onOverride={overrideCheckIn}
              onCancel={() => setConfirmingCheckIn(false)}
            />
          ) : moving ? (
            <MoveForm
              appointment={appointment}
              date={date}
              today={today}
              onMoved={(to, text) => {
                setMoving(false);
                onMoved(to, appointment.id, text);
              }}
              onCancel={() => setMoving(false)}
            />
          ) : confirmingNoShow ? (
            <div role="group" aria-label="Mark no-show" className="flex flex-col gap-3 rounded-lg border border-line bg-sunken/60 p-3">
              <p className="text-ink">
                Mark {firstName} as a no-show? Their time opens up for other bookings. You can undo it if they turn up.
              </p>
              <div className="flex gap-2">
                <Button variant="danger" disabled={pending} onClick={() => run("no_show")}>
                  Mark no-show
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => setConfirmingNoShow(false)}>
                  Not yet
                </Button>
              </div>
            </div>
          ) : reportingLate ? (
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
          ) : canceling ? (
            <CancelForm
              pending={pending}
              series={Boolean(appointment.series)}
              group={Boolean(appointment.group)}
              onCancel={(reason, detail, scope) => run("cancel", reason, detail, scope)}
              onKeep={() => setCanceling(false)}
            />
          ) : (
            <div className="flex items-center gap-2">
              {step ? (
                <Button variant="primary" size="lg" disabled={pending} onClick={primary} data-testid="primary-action" className="min-w-0 flex-1">
                  {step.kind === "check_in" ? "Check in" : "Check out"}
                </Button>
              ) : checkedOutNote ? (
                // Checked out: there's no undo here; the sale is voided instead.
                <p data-testid="checked-out-note" className="min-w-0 flex-1 text-ink-muted">
                  To reverse checkout, a manager or owner voids the sale
                  {appointment.saleId ? (
                    <>
                      {" "}
                      (
                      <Link href={`/sales/${appointment.saleId}`} className="font-medium text-link underline underline-offset-2 hover:text-link-hover">
                        view the sale
                      </Link>
                      ).
                    </>
                  ) : (
                    "."
                  )}
                </p>
              ) : (
                <span className="flex-1" />
              )}
              {menuActions.length > 0 && <ActionsMenu actions={menuActions} disabled={pending} />}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

type MenuAction = { key: string; label: string; onSelect: () => void; danger?: boolean };

// "⋯": the visit's other actions, in a menu that opens upward from the
// footer. Arrow keys move through it; Escape or a click outside closes it.
function ActionsMenu({ actions, disabled }: { actions: MenuAction[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && open) {
      // Just the menu: the calendar's Escape would close the whole panel.
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <Button ref={button} aria-label="More actions" title="More actions" size="lg" square aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        <MoreIcon />
      </Button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="More actions"
          className="absolute right-0 bottom-full z-10 mb-2 flex w-max max-w-[min(18rem,calc(100vw-2rem))] min-w-52 origin-bottom-right animate-pop-in flex-col rounded-xl border border-line bg-surface p-1.5 shadow-lift"
        >
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
              className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none ${a.danger ? "text-danger" : "text-ink"}`}
            >
              <span className="truncate">{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-medium text-ink-muted">{children}</h4>;
}

// Past visits, how it was booked, and what's happened to it since.
function VisitHistory({ appointment }: { appointment: AppointmentDetail }) {
  return (
    <div className="flex flex-col gap-5">
      {appointment.client && (
        <section aria-label="Past visits" className="flex flex-col gap-1.5">
          <SectionLabel>Past visits</SectionLabel>
          {appointment.pastVisits.length === 0 ? (
            <p className="text-ink-muted">No earlier visits.</p>
          ) : (
            <ul className="flex flex-col gap-1.5" data-testid="past-visits">
              {appointment.pastVisits.map((v, i) => (
                <li key={i} className="flex gap-3">
                  <span className="min-w-14 shrink-0 whitespace-nowrap text-ink-muted tabular-nums">{v.date}</span>
                  <span className="min-w-0 text-ink">
                    {v.services} <span className="whitespace-nowrap text-ink-muted">with {v.staff}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/clients/${appointment.client.id}`} className="self-start font-medium text-link underline-offset-2 hover:underline">
            Client profile
          </Link>
        </section>
      )}
      <section aria-label="Changes" className="flex flex-col gap-1.5">
        <SectionLabel>Booking and changes</SectionLabel>
        {appointment.online && (
          <p data-testid="online-badge" className="flex items-center gap-1.5 text-ink">
            <GlobeIcon className="size-4 text-ink-muted" />
            Booked online by the client
          </p>
        )}
        <ul className="flex flex-col gap-1 text-ink-muted">
          <li>{appointment.bookedBy}</li>
          {appointment.changedBy && <li>{appointment.changedBy}</li>}
          {appointment.log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// Visit notes save as you type (and when you leave the box).
function NotesForm({ appointmentId, initial, editable }: { appointmentId: string; initial: string; editable: boolean }) {
  const [notes, setNotes] = useState(initial);
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }>({ kind: "idle" });
  const saved = useRef(initial);
  const latest = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = useCallback(
    (value: string) => {
      clearTimeout(timer.current);
      if (value === saved.current) return;
      setState({ kind: "saving" });
      void saveVisitNotes(appointmentId, value).then((r) => {
        if (!r.ok) return setState({ kind: "error", message: r.message });
        saved.current = value;
        if (latest.current === value) setState({ kind: "saved" });
      });
    },
    [appointmentId],
  );

  // Leaving with a change not yet saved (another tab, another visit) saves it.
  useEffect(() => () => save(latest.current), [save]);

  if (!editable) {
    return (
      <section aria-label="Notes" className="flex flex-col gap-1">
        <SectionLabel>Visit notes</SectionLabel>
        <p className={`whitespace-pre-wrap ${initial ? "text-ink" : "text-ink-muted"}`}>{initial || "No notes."}</p>
      </section>
    );
  }

  return (
    <form aria-label="Notes" className="flex flex-col gap-1.5" onSubmit={(e) => e.preventDefault()}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="appointment-notes" className="text-xs font-medium text-ink-muted">
          Visit notes
        </label>
        <span aria-live="polite" className="text-xs">
          {state.kind === "saving" && <span className="text-ink-muted">Saving…</span>}
          {state.kind === "saved" && (
            <span role="status" className="text-ink-muted">
              Notes saved.
            </span>
          )}
        </span>
      </div>
      <textarea
        id="appointment-notes"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          latest.current = e.target.value;
          setState({ kind: "idle" });
          clearTimeout(timer.current);
          const value = e.target.value;
          timer.current = setTimeout(() => save(value), NOTES_SAVE_DELAY);
        }}
        onBlur={() => save(notes)}
        maxLength={MAX_NOTES}
        rows={4}
        placeholder="Anything the stylist should know"
        className={`${fieldClass} bg-sunken/60`}
      />
      {state.kind === "error" && (
        <p role="alert" className="text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}

// How long typing pauses before notes save.
const NOTES_SAVE_DELAY = 800;

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

// Move to another day: a date and a start time; every service moves
// together with its stylist (a repeating visit: this, following or all; a
// group: everyone). The booking rules check it; if it doesn't fit, Denise
// offers the nearest times that day.
function MoveForm({
  appointment,
  date,
  today,
  onMoved,
  onCancel,
}: {
  appointment: AppointmentDetail;
  date: LocalDate;
  today: LocalDate;
  onMoved: (date: LocalDate, message: string) => void;
  onCancel: () => void;
}) {
  const first = [...appointment.items].sort((a, b) => a.start - b.start)[0];
  const [to, setTo] = useState<LocalDate>(addDays(date < today ? today : date, 1));
  const [time, setTime] = useState(minuteToTime(first.start));
  const [scope, setScope] = useState<Scope>("this");
  const [message, setMessage] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<BookingIdeas | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Move to another day"
      className="flex animate-fade-in flex-col gap-3 rounded-lg border border-line bg-sunken/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const startMinute = parseTime(time);
        if (startMinute === null) return setMessage("Choose a start time.");
        setMessage(null);
        setIdeas(null);
        start(async () => {
          const r = await moveVisitToDay({ appointmentId: appointment.id, date: to, startMinute }, scope);
          if (r.ok) return onMoved(to, r.message);
          setMessage(r.message);
          // Only times with the same stylist fit this form.
          const same = r.ideas ? { ...r.ideas, options: r.ideas.options.filter((o) => o.staffId === first.staffId) } : null;
          setIdeas(same && same.options.length ? same : null);
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Date
          <input type="date" value={to} min={today} onChange={(e) => e.target.value && setTo(e.target.value)} required className={fieldClass} />
        </label>
        <label className={labelClass}>
          Starts
          <input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required className={fieldClass} />
        </label>
      </div>
      <p className="text-ink-muted">
        {appointment.items.length > 1 ? "Every service moves together, " : ""}with {appointment.items.length > 1 ? "the same stylists" : first.staffName.split(" ")[0]}.
        {appointment.group ? " The whole group moves with it." : ""}
      </p>
      {appointment.series && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium text-ink">Move</legend>
          {(
            [
              ["this", "This visit only"],
              ["following", "This and following visits"],
              ["all", "All visits in the series"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="move-scope" checked={scope === v} onChange={() => setScope(v)} />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      {message && (
        <p role="alert" className="flex items-start gap-2 text-danger">
          <WarningIcon className="mt-0.5 size-4" />
          <span>{message}</span>
        </p>
      )}
      {ideas && <IdeasCard ideas={ideas} onPick={(o) => setTime(minuteToTime(o.startMinute))} />}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          Move
        </Button>
        <Button onClick={onCancel} disabled={pending}>
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
    <section aria-label="Color formula" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <SectionLabel>This visit</SectionLabel>
        {appointment.formulas.length === 0 && !canRecord && <p className="text-ink-muted">No formula recorded.</p>}
        {appointment.formulas.map((f) => (
          <FormulaEntry key={f.id} meta={`${serviceOf(f.itemId)} · ${f.author}`} products={f.products} text={f.text} notes={f.notes} testId="visit-formula-products" />
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
      </div>
      {appointment.client && (
        <div className="flex flex-col gap-2" data-testid="past-formulas">
          <SectionLabel>Earlier</SectionLabel>
          {appointment.pastFormulas.length === 0 ? (
            <p className="text-ink-muted">No earlier formulas.</p>
          ) : (
            appointment.pastFormulas.map((f) => <FormulaEntry key={f.id} meta={`${f.date} · ${f.author}`} products={f.products} text={f.text} notes={f.notes} />)
          )}
        </div>
      )}
    </section>
  );
}

// One formula: what it was for and who, then the products and its text.
function FormulaEntry({ meta, products, text, notes, testId }: { meta: string; products: string; text: string; notes: string | null; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-line-strong pl-3">
      <p className="text-xs text-ink-muted">{meta}</p>
      {products && (
        <p className="font-medium text-ink" data-testid={testId}>
          {products}
        </p>
      )}
      {text !== products && <p className="font-mono text-xs whitespace-pre-line text-ink">{text}</p>}
      {notes && <p className="text-xs text-ink-muted">{notes}</p>}
    </div>
  );
}

// "Before this visit": while something's outstanding, one row ("Before
// this visit (2)") that opens to the checklist: a row per thing the visit
// needs (a patch test, a form to sign), each with its action, and whether
// it holds the visit up. Done rows show a check and fade.
function VisitChecklist({
  items,
  override,
  clientId,
  date,
  today,
  me,
  team,
}: {
  items: ChecklistItem[];
  override: AppointmentDetail["patchOverride"];
  clientId: string;
  date: LocalDate;
  today: LocalDate;
  me: BoardData["me"];
  team: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [recordingPatch, setRecordingPatch] = useState(false);
  const back = encodeURIComponent(`/calendar?date=${date}`);
  const outstanding = items.filter((c) => !c.done).length;

  return (
    <section aria-label="Before this visit" data-testid="visit-checklist" className="rounded-lg border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left font-medium text-ink transition-colors duration-(--motion-fast) hover:bg-sunken/60 focus-visible:outline-2 focus-visible:outline-focus"
      >
        <WarningIcon className="size-4 text-status-late-ink" />
        <span className="flex-1">Before this visit ({outstanding})</span>
        <ChevronDownIcon className={`size-4 text-ink-muted transition-transform duration-(--motion-fast) ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="flex animate-fade-in flex-col gap-3 border-t border-line px-3 py-3">
          {items.map((c) => (
            <li key={c.key} data-done={c.done || undefined} className={`flex flex-col gap-2 ${c.done ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                <p className="flex min-w-0 flex-1 basis-52 gap-2">
                  {c.done ? <CheckCircleIcon className="mt-0.5 size-4 text-status-confirmed-ink" /> : <WarningIcon className="mt-0.5 size-4 text-status-late-ink" />}
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{c.label}</span> <span className="text-ink-muted">— {c.status}</span>
                    {c.detail && <span className="block text-xs text-ink-muted">{c.detail}</span>}
                    {c.blocks &&
                      (override ? (
                        <span className="block text-ink-muted" data-testid="patch-override">
                          Checked in without it by {override.by}, {override.at}: &ldquo;{override.reason}&rdquo;
                        </span>
                      ) : (
                        <span className="block font-medium text-ink">Holds up this visit: the salon requires it before check-in.</span>
                      ))}
                  </span>
                </p>
                {!c.done &&
                  (c.action.kind === "form" ? (
                    <Link
                      href={`/clients/${clientId}/forms/new?template=${c.action.templateId}&back=${back}`}
                      className="ml-6 shrink-0 font-medium whitespace-nowrap text-link underline underline-offset-2 hover:text-link-hover"
                    >
                      Fill it in now
                    </Link>
                  ) : (
                    !recordingPatch && (
                      <Button size="sm" className="ml-6 shrink-0 whitespace-nowrap" onClick={() => setRecordingPatch(true)}>
                        Record patch test
                      </Button>
                    )
                  ))}
              </div>
              {!c.done && c.action.kind === "patch_test" && recordingPatch && <PatchTestForm clientId={clientId} today={today} me={me.staffId} staff={team} compact />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Check in with something still outstanding: one warning listing it all.
// When the salon requires the patch test, it's a refusal instead, and a
// manager or owner can check the client in anyway, saying why.
function CheckInWarning({
  firstName,
  outstanding,
  canOverride,
  pending,
  onCheckIn,
  onOverride,
  onCancel,
}: {
  firstName: string;
  outstanding: ChecklistItem[];
  canOverride: boolean;
  pending: boolean;
  onCheckIn: () => void;
  onOverride: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const blocked = outstanding.some((c) => c.blocks);
  return (
    <div role="group" aria-label="Before checking in" className="flex animate-fade-in flex-col gap-2 rounded-lg border border-status-late-ink/30 bg-status-late-bg px-3 py-2.5 text-status-late-ink">
      <p className="font-semibold">
        {blocked ? `${firstName} can't be checked in yet: the salon requires a valid patch test first.` : `Still to do before ${firstName} checks in:`}
      </p>
      <ul className="flex list-disc flex-col gap-0.5 pl-5">
        {outstanding.map((c) => (
          <li key={c.key}>
            {c.label} — {c.status}
            {c.blocks && <span className="font-semibold"> (required)</span>}
          </li>
        ))}
      </ul>
      {!blocked ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="primary" disabled={pending} onClick={onCheckIn}>
            Check in anyway
          </Button>
          <Button disabled={pending} onClick={onCancel}>
            Not yet
          </Button>
        </div>
      ) : canOverride ? (
        <form
          aria-label="Check in without the patch test"
          className="flex flex-col gap-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) onOverride(reason);
          }}
        >
          <label className={`${labelClass} text-ink`}>
            Why check in without it?
            <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} placeholder="e.g. Tested at another salon last week" className={fieldClass} />
          </label>
          <p className="text-xs">It&apos;s kept in the visit&apos;s history with your name.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={pending || !reason.trim()}>
              Check in without the patch test
            </Button>
            <Button disabled={pending} onClick={onCancel}>
              Not yet
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <p className="flex-1 basis-48">Record a patch test first, or ask a manager or owner: they can check {firstName} in with a reason.</p>
          <Button disabled={pending} onClick={onCancel}>
            Not yet
          </Button>
        </div>
      )}
    </div>
  );
}
