"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/page";
import { formatDuration } from "@/lib/duration";
import { clockMe, type ClockResult } from "./actions";

// Clocking in and out on My day: where they stand, and the one button.
// `since`: when they clocked in, while they're in.
export function ClockCard({ since, todayMinutes, shiftText }: { since: string | null; todayMinutes: number; shiftText: string }) {
  const [result, setResult] = useState<ClockResult | null>(null);
  const [pending, start] = useTransition();
  const clockedIn = since !== null;
  return (
    <Section title="Time clock" titleId="clock-heading" className="mb-8" data-testid="time-clock">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink" data-testid="clock-status">
            {clockedIn ? `Clocked in since ${since}` : "Not clocked in"}
          </p>
          <p className="text-13 text-ink-muted">
            {shiftText}
            {todayMinutes > 0 ? ` · ${formatDuration(todayMinutes)} worked today` : ""}
          </p>
        </div>
        <Button
          variant={clockedIn ? "secondary" : "primary"}
          disabled={pending}
          onClick={() => start(async () => setResult(await clockMe(clockedIn ? "out" : "in")))}
        >
          {clockedIn ? "Clock out" : "Clock in"}
        </Button>
      </div>
      {result && (
        <p role="status" className={`mt-2 text-13 ${result.ok ? "text-ink-muted" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </Section>
  );
}
