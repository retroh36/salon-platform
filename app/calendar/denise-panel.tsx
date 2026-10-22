"use client";

import { useState } from "react";
import { DeniseFace, DenisePose, type Pose } from "@/components/denise";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/field";
import { CheckCircleIcon, ChevronDownIcon, ClockIcon, SendIcon, UndoIcon } from "@/components/ui/icons";
import type { ChatMessage, ConflictView, DeniseState, FixView } from "@/lib/denise/types";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { useNow } from "./now-line";
import type { BoardData } from "./types";

// What Denise said after the last approve, reject or undo.
export type Outcome = { message: string; error: boolean; undoActionId: string | null };

// Which fix the calendar previews: a conflict's option.
export type Preview = { subject: string; index: number };

// "Moves 2 clients · 35 min later in total"
function meta(o: FixView): string {
  const parts = [o.clientsMoved === 0 ? "Moves no one" : o.clientsMoved === 1 ? "Moves 1 client" : `Moves ${o.clientsMoved} clients`];
  if (o.shiftMinutes > 0) parts.push(`${o.shiftMinutes} min later${o.clientsMoved > 1 ? " in total" : ""}`);
  if (o.unresolved.length) parts.push(`${o.unresolved.length} to rebook`);
  return parts.join(" · ");
}

// The Denise tab: her pose and what she has to say, her fixes for the day's
// conflicts, notices, and the Ask Denise conversation.
export function DenisePanel({
  data,
  state,
  working,
  outcome,
  chat,
  preview,
  onApprove,
  onReject,
  onUndo,
  onDismiss,
  onPreview,
  onAsk,
  onOpen,
}: {
  data: BoardData;
  state: DeniseState | null;
  // Scanning, applying, or answering.
  working: boolean;
  outcome: Outcome | null;
  chat: ChatMessage[];
  preview: Preview | null;
  onApprove: (option: FixView) => void;
  onReject: (option: FixView) => void;
  onUndo: (actionId: string) => void;
  // For a conflict with nothing to approve.
  onDismiss: (subject: string) => void;
  onPreview: (preview: Preview | null) => void;
  onAsk: (question: string) => void;
  onOpen: (appointmentId: string) => void;
}) {
  const conflicts = state?.conflicts ?? [];
  const notices = state?.notices ?? [];
  const pose: Pose = working ? "think" : conflicts.length ? "point" : "wave";
  const isToday = data.date === data.today;

  let says: string;
  if (!state) says = "Give me a second, I'm looking over the day…";
  else if (conflicts.length) says = conflicts.length === 1 ? "I spotted something." : `I spotted ${conflicts.length} things.`;
  else if (notices.length) says = "Nothing's clashing, but keep an eye on this:";
  else says = isToday ? "All clear today!" : "All clear for this day!";

  return (
    <div className="flex min-h-full flex-col gap-4 py-2 text-sm">
      <div className="flex items-end gap-3">
        <DenisePose pose={pose} className="w-20" />
        <p data-testid="denise-says" aria-live="polite" className="relative mb-3 rounded-xl rounded-bl-sm border border-denise-200 bg-denise-50 px-3 py-2 font-medium text-denise-900">
          {says}
        </p>
      </div>

      {outcome && (
        <div role="status" className={`flex animate-fade-in items-start gap-3 rounded-xl border p-3 ${outcome.error ? "border-danger/30 bg-danger-soft text-danger" : "border-denise-200 bg-denise-50 text-ink"}`}>
          {!outcome.error && <CheckCircleIcon className="mt-0.5 size-5 text-denise-700" />}
          <p className="flex-1">{outcome.message}</p>
          {outcome.undoActionId && (
            <Button size="sm" onClick={() => onUndo(outcome.undoActionId!)} disabled={working}>
              <UndoIcon className="size-4" />
              Undo
            </Button>
          )}
        </div>
      )}

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

      {notices.length > 0 && (
        <section aria-label="Notices" className="flex flex-col gap-2">
          {notices.map((n) => (
            <div key={n.id} className="flex animate-fade-in gap-3 rounded-xl border border-denise-200 bg-denise-50 p-3">
              <ClockIcon className="mt-0.5 size-4 shrink-0 text-denise-700" />
              <div className="flex flex-1 flex-col items-start gap-2">
                <p className="text-ink">{n.text}</p>
                <button type="button" className={buttonClass("secondary", "sm")} onClick={() => onOpen(n.appointmentId)}>
                  Open booking
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {!conflicts.length && !notices.length && state && <UpNext data={data} onOpen={onOpen} />}

      {chat.length > 0 && (
        <section aria-label="Conversation with Denise" className="flex flex-col gap-3">
          {chat.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="max-w-[85%] animate-fade-in self-end rounded-xl rounded-br-sm bg-plum-900 px-3 py-2 text-white">
                {m.text}
              </p>
            ) : (
              <div key={i} className="flex max-w-[92%] animate-fade-in gap-2">
                <DeniseFace size={24} className="mt-1" />
                <p className="rounded-xl rounded-tl-sm border border-denise-200 bg-denise-50 px-3 py-2 whitespace-pre-line text-ink">{m.text}</p>
              </div>
            ),
          )}
        </section>
      )}

      <AskForm onAsk={onAsk} disabled={working} />
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
    <section aria-label={conflict.headline} data-conflict={conflict.kind} className="flex animate-fade-in flex-col gap-3 rounded-xl border border-denise-200 bg-denise-50 p-4 shadow-card">
      <div className="flex items-start gap-2.5">
        <DeniseFace size={28} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-ink" data-testid="denise-message">
            <strong className="font-semibold text-denise-900">{conflict.headline}</strong> {top ? top.intro : "I couldn't find a fix that works with everyone's hours and bookings."}
          </p>
          {conflict.note && <p className="text-ink-muted">{conflict.note}</p>}
        </div>
      </div>

      {top && (
        <div {...previewProps(0)} data-previewing={previewing(0) || undefined} className="flex flex-col gap-3">
          <p className="rounded-lg bg-surface/70 px-3 py-2 text-ink-muted">
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
        <div className="flex flex-col gap-2 border-t border-denise-200 pt-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1 self-start text-xs font-semibold tracking-wider text-denise-700 uppercase hover:text-denise-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum-700"
          >
            Other options ({others.length})
            <ChevronDownIcon className={`size-3.5 transition-transform duration-(--motion-fast) ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <ul className="flex flex-col gap-2">
              {others.map((o, i) => (
                <li
                  key={o.actionId ?? i}
                  {...previewProps(i + 1)}
                  data-previewing={previewing(i + 1) || undefined}
                  className="flex animate-fade-in flex-col gap-2 rounded-lg border border-denise-200 bg-surface p-3 transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-denise-500 data-previewing:border-denise-500"
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
    <section aria-labelledby="up-next" className="rounded-xl border border-line p-4">
      <Eyebrow className="flex items-center gap-1.5">
        <ClockIcon className="size-4" />
        <span id="up-next">Up next</span>
      </Eyebrow>
      <p className="mt-2 font-serif text-xl font-semibold text-ink">
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

function AskForm({ onAsk, disabled }: { onAsk: (question: string) => void; disabled: boolean }) {
  const [question, setQuestion] = useState("");
  return (
    <form
      aria-label="Ask Denise a follow-up"
      className="sticky bottom-0 mt-auto flex items-center gap-2 rounded-xl border border-line bg-surface p-1.5 pl-2 focus-within:border-denise-500 focus-within:ring-2 focus-within:ring-denise-200"
      onSubmit={(e) => {
        e.preventDefault();
        if (!question.trim() || disabled) return;
        onAsk(question.trim());
        setQuestion("");
      }}
    >
      <DeniseFace size={24} />
      <label className="sr-only" htmlFor="denise-follow-up">
        Ask Denise
      </label>
      <input
        id="denise-follow-up"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask Denise…"
        className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
      />
      <IconButton type="submit" label="Send" variant="primary" size="sm" disabled={disabled}>
        <SendIcon className="size-4" />
      </IconButton>
    </form>
  );
}
