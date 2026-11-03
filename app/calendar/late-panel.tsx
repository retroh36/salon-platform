"use client";

// "Running late…" on a stylist's column (and Denise's link for "Gil is
// running 20 minutes late"): how late, then what that means for their day
// (lib/running-late.ts). With a client in the chair, Denise looks at what
// it pushes into and suggests fixes in her tab, previewed on the calendar;
// with nobody in it yet, Mark out's "Coming in late…" plans each client.
// Nothing moves and no client is messaged until someone applies a fix.

import { useState } from "react";
import { DeniseFace } from "@/components/denise";
import { Button, IconButton } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { arrivesAt, LATE_CHOICES, type LateTarget } from "@/lib/running-late";
import { formatMinute } from "@/lib/scheduling/time";

export function LatePanel({
  firstName,
  self,
  target,
  nowMinute,
  minutes: said,
  onReport,
  onComingInLate,
  onClose,
}: {
  firstName: string;
  self: boolean;
  target: LateTarget;
  nowMinute: number | null;
  minutes: number | null;
  onReport: (itemId: string, minutes: number) => void;
  onComingInLate: (minute: number) => void;
  onClose: () => void;
}) {
  const [minutes, setMinutes] = useState<number | null>(said);
  const who = self ? "You" : firstName;
  const title = self ? "You're running late" : `${firstName} is running late`;
  const client = (name: string) => name.split(" ")[0];
  const arrives = minutes ? arrivesAt(target, nowMinute, minutes) : null;
  const line =
    target.kind === "in_chair"
      ? `${client(target.clientName)}'s ${target.service} is booked until ${formatMinute(target.end)}. How far over is it running?`
      : target.kind === "next"
        ? `${self ? "You aren't" : `${firstName} isn't`} with a client yet. Next is ${client(target.clientName)} at ${formatMinute(target.start)}. How late will ${self ? "you" : firstName} be?`
        : `${who === "You" ? "You have" : `${firstName} has`} no more clients that day, so nothing needs to move.`;

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label={title} role="region">
      <div className="flex items-start gap-3">
        <DeniseFace className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="text-sm text-ink-muted" data-testid="late-denise">
            {line}
          </p>
        </div>
        <IconButton label="Close panel" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      {target.kind === "none" ? (
        <div className="mt-6">
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <form
          aria-label="How late"
          className="mt-5 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!minutes) return;
            if (target.kind === "in_chair") onReport(target.itemId, minutes);
            else if (arrives !== null) onComingInLate(arrives);
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">How late</legend>
            <div className="flex flex-wrap gap-1.5">
              {LATE_CHOICES.map((m) => (
                <label key={m} className="cursor-pointer">
                  <input type="radio" name="stylist-late-minutes" value={m} checked={minutes === m} onChange={() => setMinutes(m)} className="peer sr-only" />
                  <span className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-sm transition-colors duration-(--motion-fast) peer-checked:border-navy-900 peer-checked:bg-navy-900 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus hover:bg-sunken peer-checked:hover:bg-navy-800">
                    {m} min
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-13 text-ink-muted">
            {target.kind === "in_chair"
              ? "I'll show what it pushes into and suggest fixes on the calendar. Nothing moves, and no client is messaged, until you apply one."
              : arrives !== null
                ? `I'll plan each client around ${self ? "you" : firstName} coming in at ${formatMinute(arrives)}. Nothing moves until you apply the plan.`
                : "Choose how late, and I'll plan each client around it. Nothing moves until you apply the plan."}
          </p>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={!minutes}>
              {target.kind === "in_chair" ? "Show what it pushes into" : arrives !== null ? `Plan for ${formatMinute(arrives)}` : "Plan for coming in late"}
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
