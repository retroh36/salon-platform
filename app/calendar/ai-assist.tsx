"use client";

import { useState } from "react";
import { buttonClass, IconButton } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/field";
import { ClockIcon, SendIcon, SparkleIcon } from "@/components/ui/icons";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { useNow } from "./now-line";
import type { BoardData } from "./types";

// The AI Assist tab. A placeholder until the AI features are built: it
// makes no AI calls and changes nothing. "Up next" is plain calendar data.
export function AiAssist({
  data,
  questions,
  onAsk,
  onOpen,
}: {
  data: BoardData;
  questions: string[];
  onAsk: (question: string) => void;
  onOpen: (appointmentId: string) => void;
}) {
  const now = useNow();
  const [followUp, setFollowUp] = useState("");

  // The next visit today that hasn't started.
  const nowMinute = now !== null && toLocal(new Date(now), data.timeZone).date === data.date ? toLocal(new Date(now), data.timeZone).minute : null;
  const next =
    nowMinute === null
      ? null
      : data.blocks
          .filter((b) => b.start >= nowMinute && (b.status === "booked" || b.status === "confirmed"))
          .sort((a, b) => a.start - b.start)[0];
  const nextVisit = next ? data.appointments[next.appointmentId] : null;

  return (
    <div className="flex min-h-full flex-col gap-4 py-2 text-sm">
      <p className="rounded-lg bg-plum-100 px-3 py-2 text-plum-900">
        <strong className="font-semibold">Preview.</strong> AI Assist isn&apos;t connected yet, so it can&apos;t answer questions or change the calendar.
      </p>

      {questions.length > 0 && (
        <section aria-label="Questions" className="flex flex-col gap-3">
          {questions.map((q, i) => (
            <div key={i} className="flex animate-fade-in flex-col gap-2">
              <p className="self-end rounded-lg rounded-br-sm bg-plum-900 px-3 py-2 text-white">{q}</p>
              <p className="flex gap-2 rounded-lg rounded-bl-sm bg-sunken px-3 py-2 text-ink">
                <SparkleIcon className="mt-0.5 size-4 shrink-0 text-plum-700" />
                <span>Once AI Assist is connected, it will answer this from your calendar, and suggest bookings for you to approve.</span>
              </p>
            </div>
          ))}
        </section>
      )}

      {next && nextVisit && (
        <section aria-labelledby="up-next" className="rounded-xl border border-line p-4">
          <Eyebrow className="flex items-center gap-1.5">
            <ClockIcon className="size-4" />
            <span id="up-next">Up next</span>
          </Eyebrow>
          <p className="mt-2 font-serif text-xl font-semibold text-ink">
            {next.clientName} · {formatMinute(next.start)}
          </p>
          <p className="text-ink-muted">{next.service}</p>
          {nextVisit.notes && <p className="mt-3 rounded-md bg-sunken px-3 py-2 text-ink">{nextVisit.notes}</p>}
          <button type="button" className={buttonClass("secondary", "sm", "mt-3")} onClick={() => onOpen(next.appointmentId)}>
            Open booking
          </button>
        </section>
      )}

      <section aria-label="Coming soon" className="flex flex-col gap-3">
        {[
          ["Suggested appointments", "Free times that fit a request, checked against every booking rule."],
          ["Openings to fill", "Gaps in the day, matched with clients who are due back or on the waitlist."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-xl border border-dashed border-line-strong p-4">
            <Eyebrow className="flex items-center gap-1.5">
              <SparkleIcon className="size-4" />
              {title}
            </Eyebrow>
            <p className="mt-1 text-ink-muted">{body}</p>
            <p className="mt-2 text-xs font-medium text-ink-muted">Coming soon</p>
          </div>
        ))}
      </section>

      <form
        aria-label="Ask a follow-up"
        className="sticky bottom-0 mt-auto flex items-center gap-2 rounded-xl border border-line bg-surface p-1.5 pl-3 focus-within:border-plum-700 focus-within:ring-2 focus-within:ring-plum-200"
        onSubmit={(e) => {
          e.preventDefault();
          if (!followUp.trim()) return;
          onAsk(followUp.trim());
          setFollowUp("");
        }}
      >
        <SparkleIcon className="size-4 shrink-0 text-plum-700" />
        <label className="sr-only" htmlFor="ai-follow-up">
          Ask a follow-up
        </label>
        <input
          id="ai-follow-up"
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          placeholder="Ask a follow-up…"
          className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
        />
        <IconButton type="submit" label="Send" variant="primary" size="sm">
          <SendIcon className="size-4" />
        </IconButton>
      </form>
    </div>
  );
}
