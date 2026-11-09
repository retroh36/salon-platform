"use client";

// A visit booked through "Find my stylist": the client's answers and photos,
// and our rule's extra-time flag for staff to accept or ignore.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/page";
import { formatDuration } from "@/lib/duration";
import type { VisitQuiz } from "@/lib/visit-quiz";
import { acceptQuizFlag, ignoreQuizFlag, type QuizFlagResult } from "./quiz-actions";

export function QuizCard({ quiz, canDecide }: { quiz: VisitQuiz; canDecide: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<QuizFlagResult>) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? null : r.message);
    });
  const flag = quiz.flag;
  return (
    <section aria-label="Find my stylist answers" data-testid="visit-quiz" className="flex flex-col gap-2">
      <p className="text-xs font-medium text-ink-muted">From Find my stylist</p>
      <dl className="flex flex-col gap-1.5 text-sm">
        {quiz.lines.map((l) => (
          <div key={l.label}>
            <dt className="text-ink-muted">{l.label}</dt>
            <dd className="wrap-anywhere text-ink">{l.value}</dd>
          </div>
        ))}
      </dl>
      {quiz.photos.length > 0 && (
        <div className="flex gap-2">
          {quiz.photos.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Client's photo" className="size-16 rounded-md bg-sunken object-cover" />
            </a>
          ))}
        </div>
      )}
      {flag && (
        <div data-testid="quiz-flag" className="flex flex-col gap-2">
          <p className="text-sm text-ink">
            May need {formatDuration(flag.minutes)} more: {flag.reasons.join(", ").toLowerCase()}.
          </p>
          {flag.status === "accepted" && <Badge tone="success">{`${formatDuration(flag.minutes)} added`}</Badge>}
          {flag.status === "ignored" && <Badge tone="neutral">Ignored</Badge>}
          {!flag.status && canDecide && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => acceptQuizFlag(quiz.id))}>
                Add {formatDuration(flag.minutes)}
              </Button>
              <Button size="sm" variant="quiet" disabled={pending} onClick={() => act(() => ignoreQuizFlag(quiz.id))}>
                Ignore
              </Button>
            </div>
          )}
          {message && (
            <p role="alert" className="text-sm text-danger">
              {message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
