"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ClientPicker } from "@/app/calendar/booking-panel";
import type { ClientOption } from "@/app/calendar/actions";
import { approveDeniseFix, rejectDeniseFix } from "@/app/calendar/denise-actions";
import { bookingForm } from "@/app/denise/booking-actions";
import { DeniseFace } from "@/components/denise";
import { DeniseText } from "@/components/denise-text";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { SendIcon } from "@/components/ui/icons";
import { Alert } from "@/components/ui/page";
import type { BookingSuggestion } from "@/lib/denise/types";
import { reach } from "@/lib/reach";
import { formatLongDay } from "@/lib/schedule-format";
import { formatMinute } from "@/lib/scheduling/time";
import { BookingCardView, FormLink } from "./booking-card";
import { appendDenise, askDenise, useDenise, type DeniseRun } from "./store";

// The input's id, so the keyboard shortcut and "Ask Denise" can put the
// cursor in it.
export const DENISE_INPUT_ID = "denise-follow-up";

// Denise's conversation: what staff asked, her answers (with any help page
// button, suggested booking or booking card), what she's doing while she
// works, and the box to ask her something. The same conversation on every
// page (./store.ts). `date` is the day on screen (today off the calendar);
// `appointmentId` the visit open on the calendar, so she knows whose it is.
export function DeniseChat({
  canBook,
  today,
  date,
  appointmentId = null,
  onBooked,
  intro,
  placeholder,
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
                  {m.booking && <BookingCardView card={m.booking} index={i} outcome={m.outcome} today={today} onBooked={onBooked} />}
                </div>
              </div>
            ),
          )}
          {run.working && <Thinking run={run} />}
        </section>
      )}
      <div ref={end} />
      <AskForm onAsk={ask} disabled={run.working} focus={focus} canBook={canBook} placeholder={placeholder} />
    </div>
  );
}

function AskForm({ onAsk, disabled, focus, canBook, placeholder }: { onAsk: (question: string) => void; disabled: boolean; focus: number; canBook: boolean; placeholder?: string }) {
  const [question, setQuestion] = useState("");
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
      if (document.activeElement !== input.current && tries++ < 20) frame = requestAnimationFrame(put);
    };
    put();
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  return (
    <div className="sticky bottom-0 mt-auto flex flex-col gap-1.5 bg-surface pt-1 pb-3">
      <form
        aria-label="Message Denise"
        className="flex items-center gap-2 rounded-lg border border-line bg-surface p-1.5 pl-2 focus-within:border-denise-500 focus-within:ring-2 focus-within:ring-denise-200"
        onSubmit={(e) => {
          e.preventDefault();
          if (!question.trim() || disabled) return;
          onAsk(question.trim());
          setQuestion("");
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
    <section aria-label="Suggested booking" data-testid="denise-suggestion" className="flex animate-fade-in flex-col gap-3 rounded-lg border border-denise-200 bg-surface p-3">
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

// While she works: "Denise is thinking…" (after 20 seconds, "Still working
// on it…"), what she's doing now, and her answer as it streams in.
function Thinking({ run }: { run: DeniseRun }) {
  return (
    <div className="flex max-w-[92%] animate-fade-in gap-2" data-testid="denise-thinking" aria-live="polite">
      <DeniseFace size={24} className="mt-1" />
      <div className="flex min-w-0 flex-col gap-1.5">
        {run.text ? (
          <DeniseText text={run.text} className="rounded-lg rounded-tl-sm bg-denise-50 px-3 py-2 text-ink" />
        ) : (
          <p className="flex items-center gap-1.5 rounded-lg rounded-tl-sm bg-denise-50 px-3 py-2 font-medium text-denise-900">
            {run.slow ? "Still working on it" : "Denise is thinking"}
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
            {run.slow && run.text ? "Still working on it… " : ""}
            {run.status}
          </p>
        )}
      </div>
    </div>
  );
}
