"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ClientPicker } from "@/app/calendar/booking-panel";
import type { ClientOption } from "@/app/calendar/actions";
import { approveDeniseFix, rejectDeniseFix } from "@/app/calendar/denise-actions";
import { bookingForm } from "@/app/denise/booking-actions";
import { confirmTask, dismissTask, undoTask } from "@/app/denise/task-actions";
import { DeniseFace } from "@/components/denise";
import { DeniseText } from "@/components/denise-text";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { SendIcon } from "@/components/ui/icons";
import { Alert } from "@/components/ui/page";
import type { BookingSuggestion, TaskCard } from "@/lib/denise/types";
import { reach } from "@/lib/reach";
import { formatLongDay } from "@/lib/schedule-format";
import { formatMinute } from "@/lib/scheduling/time";
import { BookingCardView, FormLink } from "./booking-card";
import { appendDenise, askDenise, clearPrefill, updateDenise, useDenise, type DeniseRun } from "./store";
import { setUnsaved } from "@/lib/unsaved-work";

// The input's id, so the keyboard shortcut and "Ask Denise" can put the
// cursor in it.
export const DENISE_INPUT_ID = "denise-follow-up";

// Denise's conversation: what staff asked, her answers (with any help page
// button, suggested booking or booking card), what she's doing while she
// works, and the box to ask her something. The same conversation on every
// page (./store.ts). `date` is the day on screen (today off the calendar);
// `appointmentId` the visit open on the calendar, so she knows whose it is.
// `box={false}` leaves out her message box, for a card that pins it under
// its scrolling area (`DeniseAskBox`), so it's always in view.
export function DeniseChat({
  canBook,
  today,
  date,
  appointmentId = null,
  onBooked,
  intro,
  placeholder,
  box = true,
}: {
  canBook: boolean;
  today: string;
  date: string;
  appointmentId?: string | null;
  onBooked?: (appointmentId: string, date: string) => void;
  // What shows above an empty conversation.
  intro?: React.ReactNode;
  // An example in her message box ("Find a haircut with Gil after 1 PM").
  placeholder?: string;
  box?: boolean;
}) {
  const { chat, run, focus } = useDenise();
  const path = usePathname();
  const ask = (question: string) => askDenise(question, { date, page: { path, appointmentId } });

  // Her latest words in view.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [chat.length, run.working, run.text]);

  return (
    <div className="flex min-h-full flex-col gap-3">
      {chat.length === 0 && !run.working && intro}
      {(chat.length > 0 || run.working) && (
        <section aria-label="Conversation with Denise" className="flex flex-col gap-3">
          {chat.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="max-w-[85%] animate-fade-in self-end rounded-lg rounded-br-sm bg-navy-900 px-3 py-2 break-words text-white">
                {m.text}
              </p>
            ) : (
              <div key={i} className="flex max-w-full animate-fade-in gap-2">
                <DeniseFace size={24} className="mt-1 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <DeniseText text={m.text} className="self-start rounded-lg rounded-tl-sm bg-denise-50 px-3 py-2 text-ink" />
                  {m.links?.map((l) => (
                    // A plain link: some screens start in a route handler (/checkout/new).
                    <a key={l.path} href={l.path} className={`${buttonClass("secondary", "sm")} self-start`} data-testid="denise-help-link">
                      {l.label}
                    </a>
                  ))}
                  {m.suggestions?.map((sg, j) => <SuggestionCard key={sg.actionId ?? j} suggestion={sg} today={today} canBook={canBook} />)}
                  {m.tasks?.map((t, j) => (
                    <TaskCardView key={t.actionId} task={t} onChange={(next) => updateDenise(i, { tasks: m.tasks!.map((x, k) => (k === j ? next : x)) })} />
                  ))}
                  {m.booking && <BookingCardView card={m.booking} index={i} outcome={m.outcome} today={today} onBooked={onBooked} />}
                  {m.retry && i === chat.length - 1 && !run.working && (
                    <Button size="sm" className="self-start" onClick={() => ask(m.retry!)} data-testid="denise-try-again">
                      Try again
                    </Button>
                  )}
                </div>
              </div>
            ),
          )}
          {run.working && <Thinking run={run} />}
        </section>
      )}
      <div ref={end} />
      {box && <AskForm onAsk={ask} disabled={run.working} focus={focus} canBook={canBook} placeholder={placeholder} />}
    </div>
  );
}

// Her message box on its own, pinned at the bottom of a card.
export function DeniseAskBox({ canBook, date, appointmentId = null, placeholder }: { canBook: boolean; date: string; appointmentId?: string | null; placeholder?: string }) {
  const { run, focus } = useDenise();
  const path = usePathname();
  return (
    <div className="shrink-0 border-t border-line px-5 pt-3" data-testid="denise-ask-box">
      <AskForm
        pinned
        onAsk={(question) => askDenise(question, { date, page: { path, appointmentId } })}
        disabled={run.working}
        focus={focus}
        canBook={canBook}
        placeholder={placeholder}
      />
    </div>
  );
}

function AskForm({
  onAsk,
  disabled,
  focus,
  canBook,
  placeholder,
  pinned = false,
}: {
  onAsk: (question: string) => void;
  disabled: boolean;
  focus: number;
  canBook: boolean;
  placeholder?: string;
  pinned?: boolean;
}) {
  // A sample question from Meet Denise, typed in for them to send: on
  // opening, or straight away when the box is already showing.
  const { prefill } = useDenise();
  const [question, setQuestion] = useState(() => (prefill && prefill.at === focus ? prefill.text : ""));
  const [seenFocus, setSeenFocus] = useState(focus);
  if (focus !== seenFocus) {
    setSeenFocus(focus);
    if (prefill && prefill.at === focus) setQuestion(prefill.text);
  }
  // Typed and not yet sent: a stalled page won't reload over it.
  useEffect(() => {
    setUnsaved("denise-box", question.trim() !== "");
    return () => setUnsaved("denise-box", false);
  }, [question]);
  const input = useRef<HTMLInputElement>(null);
  const [opening, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The shortcut (or "Ask Denise" elsewhere) puts the cursor here, trying
  // for a few frames while the panel it's in appears.
  useEffect(() => {
    if (!focus) return;
    let tries = 0;
    let frame = 0;
    const put = () => {
      input.current?.focus();
      // After a typed-in question, the cursor goes at its end.
      const end = input.current?.value.length ?? 0;
      input.current?.setSelectionRange(end, end);
      if (document.activeElement !== input.current && tries++ < 20) frame = requestAnimationFrame(put);
    };
    put();
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  return (
    <div className={`flex flex-col gap-1.5 bg-surface pb-3 ${pinned ? "" : "sticky bottom-0 mt-auto pt-1"}`}>
      <form
        aria-label="Message Denise"
        className="flex items-center gap-2 rounded-lg border border-line bg-surface p-1.5 pl-2 focus-within:border-denise-500 focus-within:ring-2 focus-within:ring-denise-200"
        onSubmit={(e) => {
          e.preventDefault();
          if (!question.trim() || disabled) return;
          onAsk(question.trim());
          setQuestion("");
          clearPrefill();
        }}
      >
        <DeniseFace size={24} />
        <label className="sr-only" htmlFor={DENISE_INPUT_ID}>
          Message Denise
        </label>
        <input
          id={DENISE_INPUT_ID}
          ref={input}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={placeholder ?? (canBook ? "Ask Denise, or type a booking…" : "Ask Denise…")}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
        />
        <IconButton type="submit" label="Send" variant="primary" size="sm" disabled={disabled}>
          <SendIcon className="size-4" />
        </IconButton>
      </form>
      {canBook && (
        <p className="flex justify-end text-xs">
          <FormLink
            onOpen={() =>
              start(async () => {
                setError(null);
                const r = await reach(bookingForm(null));
                if (!r.ok) setError(r.message);
                else appendDenise({ role: "denise", text: r.reply.text, booking: r.reply.card });
              })
            }
          />
          {opening && <span className="sr-only">Opening the form…</span>}
        </p>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

// A booking Denise suggested from a question: staff choose the client and
// book it, or dismiss it.
function SuggestionCard({ suggestion, today, canBook }: { suggestion: BookingSuggestion; today: string; canBook: boolean }) {
  const router = useRouter();
  const [client, setClient] = useState<ClientOption | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const day = suggestion.date === today ? "Today" : formatLongDay(suggestion.date, false);
  const decide = (run: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await reach(run());
      setDone(r.message);
      if (r.ok) router.refresh();
    });
  return (
    <section aria-label="Suggested booking" data-testid="denise-suggestion" className="flex animate-fade-in flex-col gap-3 rounded-lg border border-denise-200 bg-surface p-4">
      <div>
        <p className="font-semibold text-ink">
          {suggestion.serviceName} with {suggestion.staffName}
        </p>
        <p className="text-ink-muted">
          {day}, {formatMinute(suggestion.startMinute)}–{formatMinute(suggestion.endMinute)}
        </p>
        {suggestion.clientHint && !client && !done && <p className="mt-1 text-xs text-denise-700">For {suggestion.clientHint}? Find them below.</p>}
      </div>
      {done ? (
        <p className="text-sm font-medium text-denise-700">{done}</p>
      ) : canBook && suggestion.actionId ? (
        <>
          <ClientPicker client={client} onChange={setClient} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={!client || pending} onClick={() => decide(() => approveDeniseFix(suggestion.actionId!, suggestion.date, client!.id))}>
              Book it
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => decide(() => rejectDeniseFix(suggestion.actionId!, suggestion.date))}>
              Dismiss
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-ink-muted">The front desk can book this.</p>
      )}
    </section>
  );
}

// A task Denise prepared ("Hannah's Blowout: 30 min"): each change before
// and after, Confirm or Dismiss, then Undo once confirmed. What came of it
// stays with the message.
function TaskCardView({ task, onChange }: { task: TaskCard; onChange: (task: TaskCard) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (run: () => Promise<{ ok: boolean; message: string }>, status: TaskCard["status"]) =>
    start(async () => {
      setError(null);
      const r = await reach(run());
      if (!r.ok) return setError(r.message);
      onChange({ ...task, status, message: r.message });
      router.refresh();
    });
  return (
    <section aria-label="Task to confirm" data-testid="denise-task" className="flex animate-fade-in flex-col gap-3 rounded-lg border border-denise-200 bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-ink">{task.summary}</p>
        <ul className="flex flex-col gap-0.5 text-ink-muted">
          {task.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="text-xs text-ink-muted">{task.reason}</p>
      </div>
      {task.status && <p className="text-sm font-medium text-denise-700">{task.message}</p>}
      {error && <Alert>{error}</Alert>}
      {!task.status ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={pending} onClick={() => act(() => confirmTask(task.actionId), "confirmed")}>
            Confirm
          </Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => act(() => dismissTask(task.actionId), "dismissed")}>
            Dismiss
          </Button>
        </div>
      ) : (
        task.status === "confirmed" && (
          <Button size="sm" className="self-start" disabled={pending} onClick={() => act(() => undoTask(task.actionId), "undone")}>
            Undo
          </Button>
        )
      )}
    </section>
  );
}

// While she works: "Denise is thinking…" (after 8 seconds, "Still
// thinking…"; at 25 seconds with no answer she stops, store.ts), what she's
// doing now, and her answer as it streams in.
function Thinking({ run }: { run: DeniseRun }) {
  return (
    <div className="flex max-w-[92%] animate-fade-in gap-2" data-testid="denise-thinking" aria-live="polite">
      <DeniseFace size={24} className="mt-1" />
      <div className="flex min-w-0 flex-col gap-1.5">
        {run.text ? (
          <DeniseText text={run.text} className="rounded-lg rounded-tl-sm bg-denise-50 px-3 py-2 text-ink" />
        ) : (
          <p className="flex items-center gap-1.5 rounded-lg rounded-tl-sm bg-denise-50 px-3 py-2 font-medium text-denise-900">
            {run.slow ? "Still thinking" : "Denise is thinking"}
            <span aria-hidden className="inline-flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1 animate-breathe rounded-full bg-denise-500" style={{ animationDelay: `${i * 200}ms` }} />
              ))}
            </span>
            <span className="sr-only">…</span>
          </p>
        )}
        {run.status && (
          <p className="text-xs text-ink-muted" data-testid="denise-status">
            {run.slow && run.text ? "Still thinking… " : ""}
            {run.status}
          </p>
        )}
      </div>
    </div>
  );
}
