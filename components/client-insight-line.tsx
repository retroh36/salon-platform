"use client";

import { useState } from "react";
import { DeniseFace } from "@/components/denise";
import { ChevronDownIcon } from "@/components/ui/icons";

const TONES = { neutral: "bg-sunken text-ink-muted", good: "bg-status-confirmed-bg text-status-confirmed-ink", warn: "bg-status-late-bg text-status-late-ink" } as const;

// What Denise knows about a client, as one quiet line ("Every ~4 weeks with
// Gil · slightly overdue") that opens to her full sentence and tags. For
// booking details; the client profile has the card (./client-insight).
export function ClientInsightLine({ insight }: { insight: { summary: string; line?: string; tags: { label: string; tone: keyof typeof TONES }[] } }) {
  const [open, setOpen] = useState(false);
  const line = insight.line ?? insight.summary;
  return (
    <section aria-label="What Denise knows" data-testid="client-insight">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-start gap-2 rounded-md px-1.5 py-1 text-left text-ink-muted transition-colors duration-(--motion-fast) hover:bg-sunken/60 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        <DeniseFace size={20} />
        <span className="min-w-0 flex-1 text-pretty">{line}</span>
        <ChevronDownIcon className={`mt-0.5 size-4 transition-transform duration-(--motion-fast) ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="flex animate-fade-in flex-col gap-2 pt-1.5 pl-7">
          <p className="text-ink">{insight.summary}</p>
          {insight.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {insight.tags.map((t) => (
                <li key={t.label} className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONES[t.tone]}`}>
                  {t.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
