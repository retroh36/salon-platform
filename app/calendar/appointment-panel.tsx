"use client";

import type { Moved } from "@/lib/move-notices";
import { MessageClientForm } from "./message-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert, Badge, nameLinkClass, textLinkClass, type Tone } from "@/components/ui/page";
import { CheckCircleIcon, ChevronDownIcon, GlobeIcon, MoreIcon, PhoneIcon, WarningIcon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/tabs";
import { PatchTestForm } from "@/app/clients/patch-test-form";
import { ClientInsightLine } from "@/components/client-insight-line";
import { QuizCard } from "./quiz-card";
import { VisitPhotosTab } from "@/components/visit-photos";
import { ACTION_LABELS, ACTION_STATUS, allowedActions, CANCEL_REASONS, canEditNotes, cancelReason, isEditable, MAX_NOTES, STATUS_LABELS, type AppointmentAction, type AppointmentStatus } from "@/lib/appointments";
import type { ChecklistItem } from "@/lib/client-checks";
import { nextStep, timerState, timerStatus, visitStatusText } from "@/lib/visit-times";
import { CardLinkButton, FeeControls } from "@/components/policy-controls";
import { cancelFee, type VisitTerms } from "@/lib/policy";
import { formatLongDay } from "@/lib/schedule-format";
import { LATE_MINUTES } from "@/lib/scheduling/disruptions";
import { addDays, formatMinute, minuteToTime, parseTime, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { shortRange } from "@/lib/calendar";
import { UsageLinesEditor, toUsageJson, type DraftLine } from "@/components/usage-lines";
import type { PickerProduct } from "@/lib/inventory-load";
import { addVisitFormula, changeGroupVisitStatus, changeVisitStatus, changeVisitStatusScoped, checkInWithPatchOverride, moveVisitToDay, saveVisitNotes, undoVisitCheckIn, undoVisitNoShow } from "./actions";
import { IdeasCard } from "./booking-panel";
import type { BookingIdeas } from "@/lib/denise/ideas";
import type { Scope } from "@/lib/scheduling/series";
import { useNow } from "./now-line";
import type { AppointmentDetail, BoardData } from "./types";
import { UndoFix } from "./undo-fix";
import { ItemSteps } from "./item-steps";
import { FormLinkButton } from "./form-link";
import { GracePrompt } from "./grace-prompt";
import { reach } from "@/lib/reach";
import { useKeepOnScreen } from "@/components/ui/keep-on-screen";

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
  onStatusNow,
  onCheckedIn,
  onNoShow,
  onMoved,
  onUndoFix,
  onRebook,
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
  // A status change for this visit: shown at once, saved in the
  // background, and put back (saying why, through `failed`) if it fails.
  onStatusNow: (appointmentId: string, to: AppointmentStatus, save: () => Promise<{ ok: boolean; message?: string }>, failed?: (message: string) => void) => Promise<boolean>;
  // Just checked in from here: the calendar offers Undo for a few seconds.
  onCheckedIn: (appointmentId: string) => void;
  // Just marked a no-show from here: the calendar offers Undo too.
  onNoShow: (appointmentId: string) => void;
  // Moved to another day (or time): the calendar follows it there.
  onMoved: (date: LocalDate, appointmentId: string, message: string, moved?: Moved | null) => void;
  // Undo one of Denise's fixes from the History tab (her card says how it went).
  onUndoFix: (actionId: string, told: string[]) => void;
  // Checked out: book their next visit (the booking form, filled in).
  onRebook?: () => void;
  // Who can be named as doing a patch test.
  team: { id: string; name: string; color?: string | null; photoUrl?: string | null }[];
}) {
  const { client, items, status } = appointment;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [confirmingCheckIn, setConfirmingCheckIn] = useState(false);
  const [confirmingNoShow, setConfirmingNoShow] = useState(false);
  const [moving, setMoving] = useState(false);
  const [reportingLate, setReportingLate] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);
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
  // Message client: an upcoming visit, from the front of house or a stylist on it.
  // A visit still to come: its forms can go to the client by link.
  const canSendForms = me.canBook && date >= today && (status === "booked" || status === "confirmed");
  const canMessage = Boolean(client) && date >= today && isEditable(status) && (me.canBook || items.some((i) => i.staffId === me.staffId));
  const canRecordFormula = date <= today && status !== "canceled" && status !== "no_show" && (me.canBook || items.some((i) => i.staffId === me.staffId));

  function run(action: AppointmentAction, reason = "", detail = "", scope: Scope | "group" = "this") {
    setMessage(null);
    // This visit only: on screen at once, saved behind it.
    if (scope === "this" && action !== "check_out") {
      const save = () => changeVisitStatus(appointment.id, action, reason, detail);
      if (action === "check_in") {
        onCheckedIn(appointment.id);
        onStatusNow(appointment.id, "checked_in", save, setMessage);
      } else if (action === "no_show") {
        setConfirmingNoShow(false);
        onNoShow(appointment.id);
        onStatusNow(appointment.id, "no_show", save, setMessage);
      } else {
        // The reason is checked here, while the form is still open.
        if (!cancelReason(reason, detail)) return setMessage(reason === "Other" ? "Say why it was canceled." : "Choose a reason.");
        // Canceled visits leave the calendar; once it's saved, Denise looks
        // at the time freed (the calendar says so if it didn't save).
        onClose();
        onStatusNow(appointment.id, ACTION_STATUS[action], save).then((ok) => ok && onCanceled(appointment.id));
      }
      return;
    }
    startTransition(async () => {
      const result = await reach(
        scope === "this"
          ? changeVisitStatus(appointment.id, action, reason, detail)
          : scope === "group"
            ? changeGroupVisitStatus(appointment.id, action, reason, detail)
            : changeVisitStatusScoped(appointment.id, action, scope, reason, detail),
      );
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
    setConfirmingCheckIn(false);
    onCheckedIn(appointment.id);
    onStatusNow(appointment.id, "checked_in", () => checkInWithPatchOverride(appointment.id, reason), (m) => {
      setMessage(m);
      setConfirmingCheckIn(true);
    });
  }

  function undoCheckIn() {
    setMessage(null);
    onStatusNow(appointment.id, "booked", () => undoVisitCheckIn(appointment.id), setMessage);
  }

  function undoNoShow() {
    setMessage(null);
    onStatusNow(appointment.id, "booked", () => undoVisitNoShow(appointment.id), setMessage);
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
    canMessage && { key: "message", label: "Message client", onSelect: () => (setSentNote(null), setMessaging(true)) },
    me.canBook && isEditable(status) && { key: "edit", label: "Edit booking", onSelect: onEdit },
    me.canBook && (status === "booked" || status === "confirmed") && { key: "move", label: "Move to another day", onSelect: () => setMoving(true) },
    status === "checked_in" && me.canBook && { key: "undo_check_in", label: "Undo check-in", onSelect: undoCheckIn },
    actions.includes("no_show") && { key: "no_show", label: ACTION_LABELS.no_show, onSelect: () => setConfirmingNoShow(true) },
    status === "no_show" && me.canBook && { key: "undo_no_show", label: "Undo no-show", onSelect: undoNoShow },
    actions.includes("cancel") && { key: "cancel", label: ACTION_LABELS.cancel, danger: true, onSelect: () => setCanceling(true) },
    // Checked out: there's no undo here; a manager or owner voids the sale.
    status === "completed" && me.canBook && {
      key: "reverse",
      label: "Reverse checkout…",
      onSelect: () => (appointment.saleId ? router.push(`/sales/${appointment.saleId}`) : setMessage("To reverse checkout, a manager or owner voids the sale.")),
    },
  ].filter((a): a is MenuAction => Boolean(a));
  // The footer: the main step (Check in, Check out, or Rebook once checked
  // out), and beside it the visit's everyday actions (taken out of "⋯").
  const mainAction =
    step ? { label: step.kind === "check_in" ? "Check in" : "Check out", run: primary }
    : status === "completed" && me.canBook && client && onRebook ? { label: "Rebook", run: onRebook }
    : null;
  const FOOTER_KEYS = ["edit", "message"];
  const footerActions = FOOTER_KEYS.flatMap((k) => menuActions.filter((a) => a.key === k)).slice(0, mainAction ? 1 : 2);
  const shownInMenu = menuActions.filter((a) => !footerActions.includes(a));
  // Key facts, one labeled row each.
  const keyRows = ([
    appointment.membership && [
      "Membership",
      <>
        {appointment.membership.status === "past_due" && (
          <>
            <Badge tone="warning">Payment failed</Badge>{" "}
          </>
        )}
        {appointment.membership.text}
      </>,
      "membership-info",
      appointment.membership.text.length > STACK_AT,
    ],
    appointment.packages.length > 0 && ["Package", appointment.packages.map((p) => p.replace(/^Package: /, "")).join(", "), "package-info"],
    appointment.series && ["Repeats", `Visit ${appointment.series.index} of ${appointment.series.count} · every ${appointment.series.intervalWeeks === 1 ? "week" : `${appointment.series.intervalWeeks} weeks`}`, "series-info"],
    appointment.group && [
      "Group",
      <div key="group" data-testid="group-info" className="flex flex-col gap-0.5">
        <span className="text-ink-muted">
          {appointment.group.label} · {appointment.group.members.length} guest{appointment.group.members.length === 1 ? "" : "s"}
        </span>
        <ul className="flex flex-col gap-0.5" aria-label="Guests in this group">
          {appointment.group.members.map((m) => (
            <li key={m.appointmentId}>
              {m.appointmentId === appointment.id ? (
                <span className="text-ink">
                  {m.clientName} · {m.staffName} · {formatMinute(m.start)} (this visit)
                </span>
              ) : (
                <button type="button" className={`text-left ${nameLinkClass}`} onClick={() => onOpenVisit(m.appointmentId)}>
                  {m.clientName} · {m.staffName} · {formatMinute(m.start)}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>,
      "group-row",
      true,
    ],
  ] as (false | null | FactTuple)[]).filter((r): r is FactTuple => Boolean(r));
  const footer = Boolean(mainAction || footerActions.length || message || sentNote || confirmingCheckIn || moving || confirmingNoShow || (messaging && client) || reportingLate || canceling);

  const first = Math.min(...items.map((i) => i.start));
  const last = Math.max(...items.map((i) => i.end));
  const lastVisit = appointment.pastVisits[0];
  const latestFormula = appointment.pastFormulas[0];

  return (
    <div className="flex min-h-full flex-col text-sm">
      {/* One grid, top to bottom: who, the visit, what to know, then the
          tabs; 16px between sections, a thin rule between each. */}
      <div className="flex flex-1 flex-col gap-4 pt-3 pb-6">
        {/* Who: their initials and name, "⋯", then the status and their number. */}
        <header className="flex items-start gap-3">
          <Avatar name={client?.name ?? "Walk-in"} size="md" halo={false} />
          <div className="min-w-0 flex-1">
            <h3 className="text-xl leading-7 font-semibold text-pretty wrap-anywhere text-ink" data-testid="client-name">
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
            {/* Each item brings its own "·"; the one that starts a line is
                clipped off, so a wrapped phone never leaves a dot behind. */}
            <div className="mt-1 overflow-hidden py-0.5">
            <div className="-ml-4 flex flex-wrap items-center gap-y-1">
              <span data-testid="visit-status" data-status={status} className={`inline-flex min-w-0 ${DOT}`}>
                <Badge tone={STATUS_TONES[status]}>{visitStatusText(status, STATUS_LABELS, appointment, timeZone)}</Badge>
              </span>
              {client?.phone && (
                <span className={`inline-flex ${DOT}`}>
                  <a
                    href={`tel:${client.phone}`}
                    aria-label={`Call ${firstName}, ${client.phone}`}
                    className="inline-flex items-center gap-1 rounded-sm text-ink-muted tabular-nums hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
                    data-testid="client-phone"
                  >
                    <PhoneIcon className="size-3.5" />
                    {client.phone}
                  </a>
                </span>
              )}
              {client?.messages.noTexts && (
                <span data-testid="no-texts" className={`inline-flex ${DOT}`}>
                  <Badge tone="warning">{client.messages.noTexts}</Badge>
                </span>
              )}
            </div>
            </div>
          </div>
          {shownInMenu.length > 0 && <ActionsMenu actions={shownInMenu} disabled={pending} />}
        </header>

        {/* The visit: the day and time once, then a row a service. */}
        <section aria-label="Visit" className="flex flex-col gap-3 border-t border-line pt-4" data-testid="visit-block">
          <p className="text-base font-semibold text-ink tabular-nums" data-testid="visit-when">
            <span data-testid="visit-date">{date === today ? "Today" : formatLongDay(date, false)}</span> · {shortRange(first, last)}
          </p>
          {[...new Set(items.flatMap((i) => (i.bundleName ? [i.bundleName] : [])))].map((name) => (
            <p key={name} className="-mt-2 text-ink-muted" data-testid="visit-bundle">
              Booked as {name}
            </p>
          ))}
          <ul className="flex flex-col gap-2.5">
            {items.map((i) => {
              const state = timerState(i.times);
              const stylist = team.find((t) => t.id === i.staffId);
              return (
                <li key={i.id} data-item-id={i.id} data-testid="service-timer" data-state={state} className="flex flex-col gap-0.5">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 font-medium text-ink">{i.serviceName}</span>
                    <span className="shrink-0 text-ink tabular-nums">{formatPrice(i.priceCents)}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-ink-muted">
                    with
                    <Avatar name={i.staffName} color={stylist?.color} photoUrl={stylist?.photoUrl} size="xs" halo={false} />
                    {i.staffName.split(" ")[0]}
                    {i.requested && <span className="whitespace-nowrap" data-testid="requested">· Asked for</span>}
                    {i.resourceName && <span className="whitespace-nowrap">· {i.resourceName}</span>}
                    {/* Several services: each one's own time (the visit's is above). */}
                    {several && <span className="whitespace-nowrap tabular-nums">· {shortRange(i.start, i.end)}</span>}
                  </p>
                  {i.steps && <ItemSteps itemId={i.id} start={i.start} steps={i.steps} canEdit={me.canBook && isEditable(status)} />}
                  {several && state !== "waiting" && (
                    <p className="text-xs text-ink-muted" aria-live="polite">
                      {timerStatus(i.times, i.bookedMinutes, timeZone)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {several && (
            <p className="flex justify-between font-semibold text-ink">
              <span>Total</span>
              <span className="tabular-nums">{formatPrice(total)}</span>
            </p>
          )}
          {/* Checked out: the sale in short. */}
          {status === "completed" && appointment.sale && (
            <dl className="flex flex-col gap-2 border-t border-line pt-3" data-testid="visit-receipt">
              <FactRow label="Paid">
                <span className="font-semibold tabular-nums">{formatPrice(appointment.sale.totalCents)}</span>
              </FactRow>
              <FactRow label="Tip">
                <span className="tabular-nums">{appointment.sale.tipCents ? formatPrice(appointment.sale.tipCents) : "None"}</span>
              </FactRow>
              <FactRow label="Paid by">{appointment.sale.methods || "—"}</FactRow>
            </dl>
          )}
        </section>

        {/* What to know about the client, only what applies, then Denise's line. */}
        {(client?.allergies || keyRows.length > 0 || (appointment.policy && client) || appointment.insight || (client && outstanding.length > 0)) && (
          <section aria-label="Client" className="flex flex-col gap-3 border-t border-line pt-4">
            {(client?.allergies || keyRows.length > 0 || (appointment.policy && client)) && (
              <dl className="flex flex-col gap-2" data-testid="visit-facts">
                {appointment.policy && client && <PolicyInfo appointment={appointment} firstName={firstName} part="card" />}
                {keyRows.map(([label, value, testId, stack]) => (
                  <FactRow key={label} label={label} testId={testId} stack={stack}>
                    {value}
                  </FactRow>
                ))}
                {appointment.policy && client && <PolicyInfo appointment={appointment} firstName={firstName} part="standing" />}
                {client?.allergies && (
                  <FactRow label="Allergy" testId="visit-allergy" danger>
                    {client.allergies}
                  </FactRow>
                )}
              </dl>
            )}
            {/* Only while something's outstanding: one row that opens the checklist. */}
            {client && outstanding.length > 0 && <VisitChecklist items={checklist} override={appointment.patchOverride} clientId={client.id} appointmentId={appointment.id} contact={canSendForms ? { phone: client.phone, email: client.email } : null} date={date} today={today} timeZone={timeZone} me={me} team={team} />}
            {appointment.quiz && <QuizCard quiz={appointment.quiz} canDecide={me.canBook && isEditable(status)} />}
            {appointment.insight && (
              // Pulled left so her face lines up with the rows; never past the
              // right edge (the panel never scrolls sideways).
              <div className="-ml-1.5">
                <ClientInsightLine insight={appointment.insight} />
              </div>
            )}
          </section>
        )}

        <div className="flex flex-1 flex-col border-t border-line pt-1">
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
              <div className="flex flex-col gap-4">
                {client?.preferences && (
                  <section aria-label="Preferences" className="flex flex-col gap-1">
                    <SectionLabel>Client preferences</SectionLabel>
                    <p className="text-ink">{client.preferences}</p>
                  </section>
                )}
                <NotesForm key={appointment.id} appointmentId={appointment.id} initial={appointment.notes} editable={notesEditable} />
                {lastVisit && (
                  <section aria-label="Last visit" className="flex flex-col gap-1" data-testid="last-visit">
                    <SectionLabel>Last visit</SectionLabel>
                    <p className="text-ink">
                      <span className="tabular-nums">{lastVisit.date}</span> · {lastVisit.services} <span className="text-ink-muted">with {lastVisit.staff}</span>
                    </p>
                  </section>
                )}
                {latestFormula && (
                  <section aria-label="Latest formula" className="flex flex-col gap-1" data-testid="latest-formula">
                    <SectionLabel>Latest formula</SectionLabel>
                    <p className="text-pretty wrap-anywhere text-ink">{latestFormula.products || latestFormula.text}</p>
                    <p className="text-13 text-ink-muted">
                      {latestFormula.date} · {latestFormula.author}
                    </p>
                  </section>
                )}
              </div>
            ) : tab === "formula" ? (
              <FormulaSection appointment={appointment} date={date} products={products} canRecord={canRecordFormula && Boolean(client)} />
            ) : tab === "photos" ? (
              <VisitPhotosTab key={appointment.id} appointmentId={appointment.id} today={today} />
            ) : (
              <VisitHistory appointment={appointment} onUndoFix={me.canBook ? onUndoFix : null} />
            )}
          </Tabs>
        </div>
      </div>

      {/* Pinned to the bottom: the main step, full width, with the visit's
          everyday actions beside it; the rest is under "⋯" by the name. */}
      {footer && (
        <footer
          aria-label="Actions"
          className="sticky bottom-0 mt-auto flex flex-col gap-3 border-t border-line bg-surface pt-3 pb-1"
        >
          {message && <Alert>{message}</Alert>}
          {sentNote && !messaging && (
            <p role="status" className="text-ink-muted" data-testid="message-sent">
              {sentNote}
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
              onMoved={(to, text, moved) => {
                setMoving(false);
                onMoved(to, appointment.id, text, moved);
              }}
              onCancel={() => setMoving(false)}
            />
          ) : confirmingNoShow ? (
            <div role="group" aria-label="Mark no-show" className="flex animate-fade-in flex-col gap-3">
              <p className="text-ink">
                Mark {firstName} as a no-show? Their time opens up for other bookings. You can undo it if they turn up.
              </p>
              {appointment.policy && appointment.policy.terms.noShowCents > 0 && (
                <p className="text-ink" data-testid="no-show-fee">
                  The no-show fee is {formatPrice(appointment.policy.terms.noShowCents)}
                  {appointment.policy.depositPaidCents > 0
                    ? appointment.policy.terms.noShowCents > appointment.policy.depositPaidCents
                      ? `: the deposit, and the rest charged to ${appointment.policy.cardLabel ?? "the card on file"} in 10 minutes.`
                      : ", kept from the deposit."
                    : appointment.policy.cardLabel
                      ? `, charged to ${appointment.policy.cardLabel} in 10 minutes.`
                      : "; there's no card on file, so it's recorded to collect later."}
                </p>
              )}
              <div className="flex gap-2">
                <Button variant="danger" disabled={pending} onClick={() => run("no_show")}>
                  Mark no-show
                </Button>
                <Button disabled={pending} onClick={() => setConfirmingNoShow(false)}>
                  Not yet
                </Button>
              </div>
            </div>
          ) : messaging && client ? (
            <MessageClientForm
              appointmentId={appointment.id}
              firstName={firstName}
              channels={client.messages}
              freeText={me.freeText}
              onSent={(note) => {
                setMessaging(false);
                setSentNote(note);
              }}
              onCancel={() => setMessaging(false)}
            />
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
              policy={appointment.policy}
              pending={pending}
              series={Boolean(appointment.series)}
              group={Boolean(appointment.group)}
              onCancel={(reason, detail, scope) => run("cancel", reason, detail, scope)}
              onKeep={() => setCanceling(false)}
            />
          ) : (
            <div className="flex items-center gap-2">
              {mainAction && (
                <Button variant="primary" size="lg" disabled={pending} onClick={mainAction.run} data-testid="primary-action" className="h-11 min-w-0 flex-1">
                  {mainAction.label}
                </Button>
              )}
              {footerActions.map((a) => (
                <Button key={a.key} size="lg" disabled={pending} onClick={a.onSelect} className={`h-11 ${mainAction ? "shrink-0" : "flex-1"}`} data-testid={`footer-${a.key}`}>
                  {a.label}
                </Button>
              ))}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

// The status line's tag (docs/brand.md, "Status: one set").
const STATUS_TONES: Record<AppointmentStatus, Tone> = {
  booked: "neutral",
  confirmed: "success",
  checked_in: "info",
  completed: "neutral",
  canceled: "neutral",
  no_show: "danger",
};

type MenuAction = { key: string; label: string; onSelect: () => void; danger?: boolean };

// "⋯": the visit's other actions, in a menu that opens down from beside
// the client's name. Arrow keys move through it; Escape or a click outside closes it.
function ActionsMenu({ actions, disabled }: { actions: MenuAction[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Focus moves into the menu only when it was opened from the keyboard (a
  // click from Enter or Space has no detail), so a mouse never leaves a ring.
  const byKeys = useRef(false);
  useKeepOnScreen(menu, open);

  useEffect(() => {
    if (!open) return;
    if (byKeys.current) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
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
      <Button ref={button} aria-label="More actions" title="More actions" variant="ghost" size="md" square className="text-ink-muted hover:text-ink" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={(e) => {
          byKeys.current = e.detail === 0;
          setOpen(!open);
        }}>
        <MoreIcon />
      </Button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="More actions"
          className="absolute top-full right-0 z-10 mt-1.5 flex w-max max-w-[min(18rem,calc(100vw-2rem))] min-w-52 origin-top-right animate-pop-in flex-col rounded-lg border border-line bg-surface p-1.5 shadow-lift"
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
              className={`flex w-full items-center rounded-md px-3 py-2 text-left text-sm whitespace-nowrap transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none ${a.danger ? "text-danger" : "text-ink"}`}
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
  return <h4 className="text-13 font-medium text-ink-muted">{children}</h4>;
}

// Past visits, how it was booked, and what's happened to it since.
function VisitHistory({ appointment, onUndoFix }: { appointment: AppointmentDetail; onUndoFix: ((actionId: string, told: string[]) => void) | null }) {
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
          <Link href={`/clients/${appointment.client.id}`} className={`self-start ${textLinkClass}`}>
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
        {appointment.fixes.length > 0 && (
          <div data-testid="fix-history" className="flex flex-col gap-2">
            <ul className="flex flex-col gap-1 text-ink-muted">
              {appointment.fixes.flatMap((f, i) => [<li key={`${i}a`}>{f.line}</li>, f.undone ? <li key={`${i}b`}>{f.undone}</li> : null])}
            </ul>
            {appointment.fixActionId && onUndoFix && <UndoFix actionId={appointment.fixActionId} working={false} onUndo={onUndoFix} />}
          </div>
        )}
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
      void saveVisitNotes(appointmentId, value).then(
        (r) => {
          if (!r.ok) return setState({ kind: "error", message: r.message });
          saved.current = value;
          if (latest.current === value) setState({ kind: "saved" });
        },
        // No answer (offline): say so; they save the next time you type or leave the box.
        () => setState({ kind: "error", message: "Notes not saved: check the connection. They'll save when you type again." }),
      );
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
        <label htmlFor="appointment-notes" className="text-13 font-medium text-ink-muted">
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
        className={`${fieldClass} min-h-[6.5rem] max-h-80 resize-none field-sizing-content`}
      />
      {state.kind === "error" && (
        <p role="alert" className="text-13 text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}

// How long typing pauses before notes save.
const NOTES_SAVE_DELAY = 800;

function CancelForm({
  policy,
  pending,
  series,
  group,
  onCancel,
  onKeep,
}: {
  policy: { terms: VisitTerms; bookedAt: string; startsAt: string; depositPaidCents: number; cardLabel: string | null } | null;
  pending: boolean;
  series: boolean;
  group: boolean;
  onCancel: (reason: string, detail: string, scope: Scope | "group") => void;
  onKeep: () => void;
}) {
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [scope, setScope] = useState<Scope | "group">("this");
  // What canceling now costs the client, when it's them who canceled.
  const fee = policy
    ? cancelFee(policy.terms, { startsAt: new Date(policy.startsAt), bookedAt: new Date(policy.bookedAt), depositPaidCents: policy.depositPaidCents }, new Date(), reason).feeCents
    : 0;
  return (
    <form
      aria-label="Cancel booking"
      className="flex animate-fade-in flex-col gap-3 rounded-lg bg-danger-soft/60 p-3"
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
      {fee > 0 && (
        <p className="text-sm text-ink" data-testid="late-cancel-fee">
          It&rsquo;s inside the {policy!.terms.windowHours}-hour window: the late-cancellation fee is {formatPrice(fee)}
          {policy!.depositPaidCents >= fee ? ", kept from the deposit." : policy!.cardLabel ? `, charged to ${policy!.cardLabel}.` : "; there's no card on file."} Anyone allowed can waive it after.
        </p>
      )}
      {(series || group) && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-13 font-medium text-ink">Cancel</legend>
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
  onMoved: (date: LocalDate, message: string, moved?: Moved | null) => void;
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
      className="flex animate-fade-in flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const startMinute = parseTime(time);
        if (startMinute === null) return setMessage("Choose a start time.");
        setMessage(null);
        setIdeas(null);
        start(async () => {
          const r = await moveVisitToDay({ appointmentId: appointment.id, date: to, startMinute }, scope);
          if (r.ok) return onMoved(to, r.message, r.moved);
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
          <legend className="mb-1 text-13 font-medium text-ink">Move</legend>
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
      {message && <Alert>{message}</Alert>}
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
      className="flex animate-fade-in flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!minutes) return;
        onReport(checkedIn ? itemId : items[0].id, minutes);
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium text-ink">{checkedIn ? "How far over is this running?" : `How late is ${firstName}?`}</legend>
        <div className="flex flex-wrap gap-1.5">
          {LATE_MINUTES.map((m) => (
            <label key={m} className="cursor-pointer">
              <input type="radio" name="late-minutes" value={m} checked={minutes === m} onChange={() => setMinutes(m)} className="peer sr-only" />
              <span className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-sm transition-colors duration-(--motion-fast) peer-checked:border-navy-900 peer-checked:bg-navy-900 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus hover:bg-sunken peer-checked:hover:bg-navy-800">
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
          <p role={result.error ? "alert" : "status"} className={`animate-fade-in ${result.error ? "text-danger" : "text-ink-muted"}`}>
            {result.text}
          </p>
        )}
        {canRecord &&
          (adding ? (
            <form
              aria-label="Record formula"
              className="flex animate-fade-in flex-col gap-3 rounded-lg border border-line p-4"
              onSubmit={(e) => {
                e.preventDefault();
                setResult(null);
                startTransition(async () => {
                  const r = await reach(addVisitFormula({ itemId, date, formula, notes, lines: toUsageJson(lines) }));
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
            // Newest first: the one to start from is on top, marked.
            appointment.pastFormulas.map((f, i) => <FormulaEntry key={f.id} meta={`${i === 0 ? "Latest · " : ""}${f.date} · ${f.author}`} products={f.products} text={f.text} notes={f.notes} />)
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
  appointmentId,
  contact,
  date,
  today,
  timeZone,
  me,
  team,
}: {
  items: ChecklistItem[];
  override: AppointmentDetail["patchOverride"];
  clientId: string;
  appointmentId: string;
  // Front of house, for a visit still to come: forms can go by link.
  contact: { phone: string | null; email: string | null } | null;
  date: LocalDate;
  today: LocalDate;
  timeZone: string;
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
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left font-medium text-ink transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus"
      >
        <WarningIcon className="size-4 text-warning-dot" />
        <span className="flex-1">Before this visit ({outstanding})</span>
        <ChevronDownIcon className={`size-4 text-ink-muted ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="flex animate-fade-in flex-col gap-3 border-t border-line p-3">
          {items.map((c) => (
            <li key={c.key} data-done={c.done || undefined} className={`flex flex-col gap-2 ${c.done ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                <p className="flex min-w-0 flex-1 basis-52 gap-2">
                  {c.done ? <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-success" /> : <WarningIcon className="mt-0.5 size-4 shrink-0 text-warning-dot" />}
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{c.label}</span> <span className="text-ink-muted">— {c.status}</span>
                    {c.detail && <span className="block text-xs text-ink-muted">{c.detail}</span>}
                    {c.blocks &&
                      (override ? (
                        <span className="block text-ink-muted" data-testid="patch-override">
                          Checked in without it by {override.by}, {override.at}: &ldquo;{override.reason}&rdquo;
                        </span>
                      ) : (
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone="warning">Required</Badge>
                          <span className="text-13 text-ink-muted">Holds up this visit: the salon requires it before check-in.</span>
                        </span>
                      ))}
                  </span>
                </p>
                {!c.done &&
                  (c.action.kind === "form" ? (
                    <Link
                      href={`/clients/${clientId}/forms/new?template=${c.action.templateId}&back=${back}`}
                      className={`ml-6 shrink-0 whitespace-nowrap ${textLinkClass}`}
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
              {!c.done && c.action.kind === "form" && contact && items.findIndex((x) => !x.done && x.action.kind === "form") === items.indexOf(c) && (
                <FormLinkButton appointmentId={appointmentId} phone={contact.phone} email={contact.email} />
              )}
              {!c.done && c.action.kind === "patch_test" && recordingPatch && <PatchTestForm clientId={clientId} today={today} timeZone={timeZone} me={me.staffId} staff={team} compact />}
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
    <div role="group" aria-label="Before checking in" className="flex animate-fade-in flex-col gap-2 rounded-lg bg-warning-soft p-3 text-ink">
      <p className="flex items-start gap-2 font-medium">
        <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-warning-dot" />
        {blocked ? `${firstName} can't be checked in yet: the salon requires a valid patch test first.` : `Still to do before ${firstName} checks in:`}
      </p>
      <ul className="flex list-disc flex-col gap-0.5 pl-8 text-ink-muted">
        {outstanding.map((c) => (
          <li key={c.key}>
            {c.label} — {c.status}
            {c.blocks && <span className="font-medium text-ink"> (required)</span>}
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
          <label className={labelClass}>
            Why check in without it?
            <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} placeholder="e.g. Tested at another salon last week" className={fieldClass} />
          </label>
          <p className="text-xs text-ink-muted">It&apos;s kept in the visit&apos;s history with your name.</p>
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
          <p className="flex-1 basis-48 text-ink-muted">Record a patch test first, or ask a manager or owner: they can check {firstName} in with a reason.</p>
          <Button disabled={pending} onClick={onCancel}>
            Not yet
          </Button>
        </div>
      )}
    </div>
  );
}

// The cancellation policy on the visit (front of house): a card or deposit
// still needed, with a secure link to send; the client's strikes; a
// no-show's fee and what happened to it.
// `part`: the card (first of the rows), or their standing and any fee
// (after the package and membership).
function PolicyInfo({ appointment, firstName, part }: { appointment: AppointmentDetail; firstName: string; part: "card" | "standing" }) {
  const router = useRouter();
  const p = appointment.policy!;
  const client = appointment.client!;
  const strikes = p.strikes > 0 && `${p.strikes} late cancel${p.strikes === 1 ? "" : "s"} or no-show${p.strikes === 1 ? "" : "s"} in ${p.months} months`;
  const needed = p.cardNeeded || p.depositNeededCents > 0;
  return (
    <div className="contents" data-testid={part === "card" ? "policy-info" : undefined}>
      {part === "card" && <FactRow label="Card on file">
        {needed ? (
          <span className="flex flex-col items-end gap-2">
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              <span data-testid="card-needed" className="inline-flex">
                <Badge tone="warning">{p.depositNeededCents > 0 ? `Deposit needed: ${formatPrice(p.depositNeededCents)}` : "Card needed to hold this booking"}</Badge>
              </span>
              {p.linkOut && <span className="text-13 text-ink-muted">Link sent</span>}
            </span>
            <CardLinkButton clientId={client.id} appointmentId={appointment.id} phone={client.phone} email={client.email} depositCents={p.depositNeededCents} sent={p.linkOut} />
          </span>
        ) : p.cardLabel ? (
          `${p.cardLabel} on file`
        ) : (
          <span className="text-ink-muted">None</span>
        )}
      </FactRow>}
      {part === "standing" && (strikes || (needed && p.repeatAction)) && (
        <FactRow label="Late cancels">
          {strikes || "None"}
          {needed && p.repeatAction && (
            <span className="block text-13 text-ink-muted">
              {p.repeatAction === "prepay" ? `So the salon asks ${firstName} for the whole visit up front.` : `So the salon asks ${firstName} for a deposit.`}
            </span>
          )}
        </FactRow>
      )}
      {part === "standing" && p.fee && (
        <FactRow label="Fee">
          <FeeControls fee={p.fee} canWaive={p.canWaive} canRetry />
        </FactRow>
      )}
      {part === "standing" && p.fee?.graceUnsent && (
        <div>
          <dd className="min-w-0">
            <GracePrompt feeIds={[p.fee.id]} onDone={() => router.refresh()} />
          </dd>
        </div>
      )}
    </div>
  );
}

// One labeled row of what to know about the visit.
// Muted label on the left, the value on the right (red for an allergy).
// The header line's separator: a "·" before each item, 16px in.
const DOT = "relative pl-4 before:absolute before:left-[0.4rem] before:text-ink-subtle before:content-['·']";

// A value longer than this goes on its own line under its label, left-
// aligned, rather than wrapping on the right ("Color Club member · Root
// Touch-Up: 0 left · 10% off services, 15% off retail").
const STACK_AT = 28;

// A row of what to know: label, value, test id, and whether it stacks
// (left out, a long string value does).
type FactTuple = [string, React.ReactNode, string, boolean?];

function FactRow({ label, testId, danger = false, stack, children }: { label: string; testId?: string; danger?: boolean; stack?: boolean; children: React.ReactNode }) {
  const stacked = stack ?? (typeof children === "string" && children.length > STACK_AT);
  return (
    <div className={stacked ? "flex flex-col gap-0.5" : "flex items-baseline justify-between gap-4"} data-stacked={stacked || undefined}>
      <dt className={`shrink-0 text-13 ${danger ? "font-medium text-danger" : "text-ink-muted"}`}>{label}</dt>
      <dd className={`min-w-0 text-pretty wrap-anywhere ${stacked ? "" : "text-right"} ${danger ? "text-danger" : "text-ink"}`} data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

