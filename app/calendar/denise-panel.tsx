"use client";

import Link from "next/link";
import { useState } from "react";
import { DeniseAvatar, DeniseFace, DenisePose, type Pose } from "@/components/denise";
import { formatDuration } from "@/lib/duration";
import type { DeniseRun } from "@/components/denise-chat/store";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/field";
import { CheckCircleIcon, ChevronDownIcon, ClockIcon, CloseIcon } from "@/components/ui/icons";
import { noFixAdvice } from "@/lib/denise/respond";
import type { ConflictView, DeniseNotice, DeniseState, FixView, Moved, OpeningMatch, WaitlistOpening } from "@/lib/denise/types";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { MovedMessages } from "./moved-messages";
import { UndoFix } from "./undo-fix";
import { useNow } from "./now-line";
import type { BoardData } from "./types";

// What Denise said after the last approve, reject or undo.
// `moved`: the clients an applied fix moved, whose messages wait to be sent;
// `corrected`: after an undo, the clients who'd been told, whose
// corrections wait to be sent.
export type Outcome = { message: string; error: boolean; undoActionId: string | null; moved?: Moved; corrected?: Moved };

// Which fix the calendar previews: a conflict's option.
export type Preview = { subject: string; index: number };

// "Moves 2 clients · 35 min later in total"
function meta(o: FixView): string {
  const parts = [o.clientsMoved === 0 ? "Moves no one" : o.clientsMoved === 1 ? "Moves 1 client" : `Moves ${o.clientsMoved} clients`];
  if (o.shiftMinutes > 0) parts.push(`${formatDuration(o.shiftMinutes)} later${o.clientsMoved > 1 ? " in total" : ""}`);
  if (o.unresolved.length) parts.push(`${o.unresolved.length} to rebook`);
  return parts.join(" · ");
}

// The Denise tab: her pose and what she has to say, her fixes for the day's
// conflicts, notices, and the conversation with her (shared with her
// bubble on other pages).
export function DenisePanel({
  data,
  state,
  working,
  outcome,
  preview,
  onApprove,
  onReject,
  onUndo,
  onDismiss,
  onPreview,
  onOpen,
  onDismissNotice,
  onNoShow,
  onBookWaitlist,
  run,
  stuck = false,
  onRetry,
  children,
}: {
  data: BoardData;
  state: DeniseState | null;
  // Scanning, applying, or answering.
  working: boolean;
  // Her look at the day failed or is taking too long (no state yet).
  stuck?: boolean;
  onRetry?: () => void;
  // A question or report she's working on: what she's doing, her answer
  // so far.
  run: DeniseRun;
  outcome: Outcome | null;
  preview: Preview | null;
  onApprove: (option: FixView) => void;
  onReject: (option: FixView) => void;
  // `told`: visits whose clients were messaged, to send a correction.
  onUndo: (actionId: string, told: string[]) => void;
  // For a conflict with nothing to approve.
  onDismiss: (subject: string) => void;
  onPreview: (preview: Preview | null) => void;
  onOpen: (appointmentId: string) => void;
  // A "hasn't checked in" line dismissed (it stays gone today).
  onDismissNotice: (id: string) => void;
  // Marks a client who hasn't arrived as a no-show.
  onNoShow: (notice: DeniseNotice) => void;
  // Book a waitlist client into time that opened up.
  onBookWaitlist: (opening: WaitlistOpening, match: OpeningMatch) => void;
  // The conversation with her (components/denise-chat/), at the foot.
  children: React.ReactNode;
}) {
  const conflicts = state?.conflicts ?? [];
  const notices = state?.notices ?? [];
  const openings = state?.openings ?? [];
  const pose: Pose = working ? "think" : conflicts.length ? "point" : "wave";
  const isToday = data.date === data.today;
  // A not-arrived client whose "Mark no-show" was tapped: asked first.
  const [confirmingNoShow, setConfirmingNoShow] = useState<string | null>(null);

  let says: string;
  if (run.working) says = "Let me look into that…";
  else if (!state && stuck) says = "I couldn't look over the day just now. The calendar works as normal.";
  else if (!state) says = "Give me a second, I'm looking over the day…";
  else if (conflicts.length) says = conflicts.length === 1 ? "I spotted something." : `I spotted ${conflicts.length} things.`;
  else if (notices.length) says = "Nothing's clashing, but keep an eye on this:";
  else if (openings.length) says = "Some time opened up, and your waitlist could use it:";
  else if (state.reorders.length) says = state.reorders.length === 1 ? "The calendar's clear. One thing about stock:" : "The calendar's clear. A few things about stock:";
  else says = isToday ? "All clear today." : "All clear for this day.";
  const allClear = pose === "wave" && Boolean(state) && !notices.length && !openings.length && !state?.reorders.length && !outcome;

  return (
    <div className="flex min-h-full flex-col gap-4 py-2 text-sm">
      {/* All clear is an empty state, with her waving; otherwise she's her
          small avatar beside what she says. */}
      {allClear ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <DenisePose className="w-20" />
          <p data-testid="denise-says" aria-live="polite" className="font-medium text-denise-900">
            {says}
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2.5">
          <DeniseAvatar pose={pose} className="mt-1" />
          <p data-testid="denise-says" aria-live="polite" className="rounded-lg rounded-tl-sm bg-denise-50 px-3 py-2 font-medium text-denise-900">
            {says}
          </p>
        </div>
      )}

      {!state && stuck && onRetry && (
        <Button size="sm" className="self-start" onClick={onRetry}>
          Try again
        </Button>
      )}

      {outcome && (
        <div role="status" className={`flex animate-fade-in items-start gap-3 rounded-lg p-3 ${outcome.error ? "bg-danger-soft text-danger" : "bg-denise-50 text-ink"}`}>
          {!outcome.error && <CheckCircleIcon className="mt-0.5 size-5 text-denise-700" />}
          <p className="flex-1">{outcome.message}</p>
          {outcome.undoActionId && <UndoFix key={outcome.undoActionId} actionId={outcome.undoActionId} working={working} onUndo={onUndo} />}
        </div>
      )}
      {outcome?.moved && <MovedMessages moved={outcome.moved} />}
      {outcome?.corrected && <MovedMessages moved={outcome.corrected} template="visit_move_undone" />}
      {data.me.canBook && <FixesApplied data={data} hide={outcome?.undoActionId ?? null} working={working} onUndo={onUndo} />}

      {conflicts.map((c, i) => (
        <ConflictCard
          key={c.subject}
          conflict={c}
          first={i === 0}
          canApprove={data.me.canBook}
          working={working}
          preview={preview}
          onApprove={onApprove}
          onReject={onReject}
          onDismiss={onDismiss}
          onPreview={onPreview}
        />
      ))}

      {/* Clients who haven't arrived 15 minutes after they were due: one
          card, a line each, to call them or mark a no-show. Visits whose
          booked time is over (after closing, say) are their own card: to
          settle, not to chase. */}
      {(["due", "over"] as const).map((kind) => {
        const these = notices.filter((n) => n.over === (kind === "over"));
        if (!these.length) return null;
        return (
            <section key={kind} aria-label={kind === "over" ? "Never checked in" : "Not arrived"} data-testid={kind === "over" ? "denise-never-in" : "denise-late"} className="flex animate-fade-in flex-col gap-2 rounded-lg border border-denise-200 bg-surface p-3">
              <p className="flex items-center gap-2 font-semibold text-denise-900">
                <ClockIcon className="size-4 shrink-0 text-denise-700" />
                {kind === "over" ? (these.length === 1 ? "Never checked in" : `${these.length} never checked in`) : these.length === 1 ? "Not arrived yet" : `${these.length} not arrived yet`}
              </p>
              <ul className="flex flex-col gap-1.5">
                {these.map((n) => (
                  // The full name on its own line (never cut off), when they were
                  // due under it, then small actions; dismiss in the corner.
                  <li key={n.id} className="relative flex animate-fade-in flex-col gap-2 border-t border-line pt-2.5 first:border-t-0 first:pt-0">
                    <span className={data.me.canBook ? "pr-8" : ""}>
                      <span data-testid="late-name" className="block font-medium break-words text-ink">
                        {n.clientName}
                      </span>
                      <span className="block text-xs text-ink-muted">{kind === "over" ? "Booked" : "Due"} {formatMinute(n.startMinute)}</span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <Button size="xs" onClick={() => onOpen(n.appointmentId)}>
                        Open
                      </Button>
                      {data.me.canBook &&
                        (confirmingNoShow === n.id ? (
                          // Asked first: a no-show frees their time (Undo follows on the toast).
                          <>
                            <Button size="xs" variant="danger" onClick={() => onNoShow(n)}>
                              Yes, no-show
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => setConfirmingNoShow(null)}>
                              Not yet
                            </Button>
                          </>
                        ) : (
                          <Button size="xs" variant="ghost" onClick={() => setConfirmingNoShow(n.id)}>
                            Mark no-show
                          </Button>
                        ))}
                    </span>
                    {data.me.canBook && (
                      <IconButton label={`Dismiss ${n.clientName}`} size="xs" variant="ghost" className="absolute top-1.5 -right-1.5" onClick={() => onDismissNotice(n.id)}>
                        <CloseIcon className="size-3.5" />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink-muted">
                {kind === "over"
                  ? "Their booked time is over. Mark a no-show, or if they came, open the booking to check them in and out."
                  : "Give them a call (their number's in the booking), or mark a no-show. If they're on the way, open the booking and tell me how late; I'll rearrange things."}
              </p>
            </section>
        );
      })}

      {openings.length > 0 && (
        <section aria-label="Waitlist" className="flex flex-col gap-2">
          {openings.map((o) => (
            <div key={o.key} data-testid="denise-opening" className="flex animate-fade-in gap-2.5 rounded-lg border border-denise-200 bg-surface p-3">
              <DeniseFace size={24} className="mt-0.5" />
              <div className="flex flex-1 flex-col gap-2">
                <p className="font-semibold text-denise-900">{o.headline}</p>
                <ol className="flex flex-col gap-1.5" aria-label={`Waitlist matches for ${o.staffName} at ${formatMinute(o.startMinute)}`}>
                  {o.matches.map((m, i) => (
                    <li key={m.entryId} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 first:border-t-0 first:pt-0">
                      <span>
                        <span className="font-medium text-ink">
                          {i + 1}. {m.clientName}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {m.services} · {formatMinute(m.startMinute)}–{formatMinute(m.endMinute)}
                          {m.preferred ? ` · asked for ${o.staffName}` : ""}
                        </span>
                      </span>
                      {data.me.canBook && (
                        <Button size="sm" disabled={working} onClick={() => onBookWaitlist(o, m)}>
                          Book
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-ink-muted">You pick who to book; get in touch with them yourself.</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {(state?.reorders.length ?? 0) > 0 && (
        // Every reorder she's drafted in one card: a line per supplier, and
        // one way to the Inventory page to review them.
        <section aria-label="Reorders" data-testid="denise-reorders" className="flex animate-fade-in gap-2.5 rounded-lg border border-denise-200 bg-surface p-3">
          <DeniseFace size={24} className="mt-0.5" />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <p className="font-semibold text-denise-900">
              {state!.reorders.length === 1 ? "1 reorder ready to review" : `${state!.reorders.length} reorders ready to review`}
            </p>
            <ul className="flex w-full flex-col gap-1.5">
              {state!.reorders.map((r) => (
                <li key={r.supplierId} data-testid="denise-reorder" className="flex items-baseline justify-between gap-3 border-t border-line pt-2 first:border-t-0 first:pt-0">
                  <span className="min-w-0">
                    <span className="block font-medium break-words text-ink">{r.supplier}</span>
                    <span className="block text-xs text-ink-muted">
                      {r.lines} {r.lines === 1 ? "product" : "products"}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-ink tabular-nums">{formatPrice(r.totalCents)}</span>
                </li>
              ))}
            </ul>
            <Link href="/inventory" className={buttonClass("secondary", "sm")}>
              Review on Inventory
            </Link>
          </div>
        </section>
      )}

      {!conflicts.length && !notices.length && !openings.length && state && <UpNext data={data} onOpen={onOpen} />}

      {children}
    </div>
  );
}

function ConflictCard({
  conflict,
  first,
  canApprove,
  working,
  preview,
  onApprove,
  onReject,
  onDismiss,
  onPreview,
}: {
  conflict: ConflictView;
  first: boolean;
  canApprove: boolean;
  working: boolean;
  preview: Preview | null;
  onApprove: (option: FixView) => void;
  onReject: (option: FixView) => void;
  onDismiss: (subject: string) => void;
  onPreview: (preview: Preview | null) => void;
}) {
  const [top, ...others] = conflict.options;
  const [open, setOpen] = useState(first);
  const previewing = (index: number) => preview?.subject === conflict.subject && preview.index === index;
  // Hovering or focusing an option shows it on the calendar.
  const previewProps = (index: number) => ({
    onMouseEnter: () => onPreview({ subject: conflict.subject, index }),
    onMouseLeave: () => onPreview(null),
    onFocus: () => onPreview({ subject: conflict.subject, index }),
    onBlur: () => onPreview(null),
  });

  return (
    // Laid out like her other cards: her face, and everything she says and
    // offers lined up beside it.
    <section aria-label={conflict.headline} data-conflict={conflict.kind} className="flex animate-fade-in gap-2.5 rounded-lg border border-denise-200 bg-surface p-3">
      <DeniseFace size={24} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-ink" data-testid="denise-message">
          <strong className="font-semibold text-denise-900">{conflict.headline}</strong> {top ? top.intro : noFixAdvice(conflict.kind)}
        </p>
        {conflict.note && <p className="text-ink-muted">{conflict.note}</p>}
      </div>

      {top && (
        <div {...previewProps(0)} data-previewing={previewing(0) || undefined} className="flex flex-col gap-3">
          <p className="text-ink-muted">
            <span className="font-semibold text-denise-700">Why it works: </span>
            {top.reason}
          </p>
          {canApprove && top.actionId ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={working} onClick={() => onApprove(top)}>
                Apply fix
              </Button>
              <Button variant="ghost" disabled={working} onClick={() => onReject(top)}>
                Dismiss
              </Button>
            </div>
          ) : (
            !canApprove && <p className="text-xs text-ink-muted">The front desk can apply this.</p>
          )}
        </div>
      )}

      {!top && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => onDismiss(conflict.subject)}>
          Dismiss
        </Button>
      )}

      {others.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1 self-start text-xs font-medium text-denise-700 hover:text-denise-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Other options ({others.length})
            <ChevronDownIcon className={`size-3.5 ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <ul className="flex flex-col divide-y divide-line">
              {others.map((o, i) => (
                <li
                  key={o.actionId ?? i}
                  {...previewProps(i + 1)}
                  data-previewing={previewing(i + 1) || undefined}
                  className="-mx-2 flex animate-fade-in flex-col gap-2 rounded-md px-2 py-2 transition-colors duration-(--motion-fast) hover:bg-denise-50 data-previewing:bg-denise-50"
                >
                  <p className="font-medium text-ink">{o.summary}</p>
                  <p className="text-xs text-ink-muted">{meta(o)}</p>
                  {canApprove && o.actionId && (
                    <Button size="sm" className="self-start" disabled={working} onClick={() => onApprove(o)}>
                      Use this instead
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      </div>
    </section>
  );
}

// The next visit today that hasn't started, when there's nothing to fix.
function UpNext({ data, onOpen }: { data: BoardData; onOpen: (appointmentId: string) => void }) {
  const now = useNow();
  const nowMinute = now !== null && toLocal(new Date(now), data.timeZone).date === data.date ? toLocal(new Date(now), data.timeZone).minute : null;
  const next =
    nowMinute === null
      ? null
      : data.blocks.filter((b) => b.start >= nowMinute && (b.status === "booked" || b.status === "confirmed")).sort((a, b) => a.start - b.start)[0];
  const visit = next ? data.appointments[next.appointmentId] : null;
  if (!next || !visit) return null;
  return (
    <section aria-labelledby="up-next" className="rounded-lg border border-line p-4">
      <Eyebrow className="flex items-center gap-1.5">
        <ClockIcon className="size-4" />
        <span id="up-next">Up next</span>
      </Eyebrow>
      <p className="mt-2 text-base font-semibold text-ink">
        {next.clientName} · {formatMinute(next.start)}
      </p>
      <p className="text-ink-muted">{next.service}</p>
      {visit.notes && <p className="mt-3 rounded-md bg-sunken px-3 py-2 text-ink">{visit.notes}</p>}
      <button type="button" className={buttonClass("secondary", "sm", "mt-3")} onClick={() => onOpen(next.appointmentId)}>
        Open booking
      </button>
    </section>
  );
}

// Her fixes still applied on this day, each with Undo, so undoing doesn't
// depend on the card she showed when it was applied (a reload, another
// page, the next fix). They come with the day (BoardData.fixesApplied).
function FixesApplied({ data, hide, working, onUndo }: { data: BoardData; hide: string | null; working: boolean; onUndo: (actionId: string, told: string[]) => void }) {
  const shown = data.fixesApplied.filter((f) => f.actionId !== hide);
  if (!shown.length) return null;
  return (
    <section aria-label="Fixes applied" data-testid="fixes-applied" className="flex flex-col gap-2">
      <h3 className="text-13 font-medium text-ink-muted">Fixes applied ({shown.length})</h3>
      <ul className="flex flex-col gap-2">
        {shown.map((f) => (
          <li key={f.actionId} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line bg-surface p-3">
            <div className="min-w-0 flex-1">
              <p className="text-ink">{f.names.join(", ")}</p>
              <p className="text-13 text-ink-muted">
                {f.summary}
                {f.appliedBy ? ` · applied by ${f.appliedBy} at ${f.at}` : ` · applied at ${f.at}`}
              </p>
            </div>
            <UndoFix actionId={f.actionId} working={working} onUndo={onUndo} />
          </li>
        ))}
      </ul>
    </section>
  );
}
