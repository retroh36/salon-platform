"use client";

import Link from "next/link";
import { useState } from "react";
import { approveDeniseFix, bookFromWaitlist, rejectDeniseFix, undoDeniseFix } from "@/app/calendar/denise-actions";
import { DeniseFace, DenisePose } from "@/components/denise";
import { Button, buttonClass } from "@/components/ui/button";
import { CheckCircleIcon, UndoIcon } from "@/components/ui/icons";
import type { DeniseState, FixResult } from "@/lib/denise/types";
import { noFixAdvice } from "@/lib/denise/respond";
import type { ConflictKind } from "@/lib/scheduling/resolve";
import { formatMinute } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";

const KINDS: Record<ConflictKind, string> = {
  likely_overrun: "Might run over",
  overrun: "Running over",
  client_late: "Client running late",
  call_out: "Out today",
  double_booking: "Double-booked",
};

const REVIEW = "/calendar?denise=1";

// Denise's brief for today as the hero card, with her open items under it
// (fixes for conflicts and likely overruns, waitlist matches, reorder
// drafts), each with its buttons. Apply, Dismiss and Book work right
// here, through the same actions as her panel on the calendar.
export function DeniseCard({ initial, today, canBook, seesMoney }: { initial: DeniseState; today: string; canBook: boolean; seesMoney: boolean }) {
  const [state, setState] = useState(initial);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<{ message: string; error: boolean; undo: string | null } | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  async function run(action: () => Promise<FixResult>, undo: string | null) {
    setWorking(true);
    setOutcome(null);
    const result = await action();
    setWorking(false);
    if (result.state) setState(result.state);
    setOutcome({ message: result.message, error: !result.ok, undo: result.ok ? undo : null });
  }

  const conflicts = state.conflicts.filter((c) => !dismissed.has(c.subject));
  const openings = state.openings.filter((o) => o.matches.length > 0);
  const count = conflicts.length + openings.length + state.reorders.length;
  const brief = state.brief;

  return (
    <section aria-labelledby="denise-brief-heading" data-testid="dashboard-denise" className="mb-6 animate-fade-in overflow-hidden rounded-2xl border border-denise-200 bg-denise-50 shadow-card">
      <div className="flex items-start gap-4 p-5 sm:gap-5 sm:p-6">
        <DenisePose pose={count ? "point" : "wave"} className="w-20 sm:w-24" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="denise-brief-heading" className="font-serif text-xl font-semibold text-denise-900">
              Denise&rsquo;s brief
            </h2>
            {brief && <span className="text-xs text-ink-muted">{brief.writtenBy === "claude" ? "Written by Denise" : "From the calendar"}</span>}
          </div>
          {brief && (
            <p className="mt-2 text-[15px] leading-relaxed text-ink" data-testid="dashboard-brief-text">
              {brief.text}
            </p>
          )}
          <p className="mt-2 font-medium text-denise-900" data-testid="dashboard-denise-says" aria-live="polite">
            {count === 0 ? "All clear today." : count === 1 ? "One thing needs a look:" : `${count} things need a look:`}
          </p>
        </div>
      </div>

      {outcome && (
        <div role="status" className={`mx-5 mb-4 flex animate-fade-in items-start gap-3 rounded-xl border p-3 text-sm sm:mx-6 ${outcome.error ? "border-danger/30 bg-danger-soft text-danger" : "border-denise-200 bg-surface text-ink"}`}>
          {!outcome.error && <CheckCircleIcon className="mt-0.5 size-5 text-denise-700" />}
          <p className="flex-1">{outcome.message}</p>
          {outcome.undo && (
            <Button size="sm" disabled={working} onClick={() => run(() => undoDeniseFix(outcome.undo!, today), null)}>
              <UndoIcon className="size-4" />
              Undo
            </Button>
          )}
        </div>
      )}

      {count > 0 && (
        <ul aria-label="Denise's open items" className="flex flex-col gap-2 border-t border-denise-200 bg-denise-50 p-3 sm:p-4">
          {conflicts.map((c) => {
            const top = c.options[0];
            return (
              <Item key={c.subject} label={KINDS[c.kind]} title={c.headline} detail={top ? top.summary : noFixAdvice(c.kind)}>
                {canBook && top?.actionId && (
                  <Button variant="primary" size="sm" disabled={working} onClick={() => run(() => approveDeniseFix(top.actionId!, today), top.actionId)}>
                    Apply
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={working}
                  onClick={() => (canBook && top?.actionId ? run(() => rejectDeniseFix(top.actionId!, today), null) : setDismissed(new Set([...dismissed, c.subject])))}
                >
                  Dismiss
                </Button>
                <Link href={REVIEW} className={buttonClass("secondary", "sm")}>
                  Review
                </Link>
              </Item>
            );
          })}
          {openings.map((o) => {
            const best = o.matches[0];
            return (
              <Item key={o.key} label="Waitlist match" title={o.headline} detail={`${best.clientName} · ${best.services} · ${formatMinute(best.startMinute)}${o.matches.length > 1 ? ` · and ${o.matches.length - 1} more` : ""}`}>
                {canBook && (
                  <Button variant="primary" size="sm" disabled={working} onClick={() => run(() => bookFromWaitlist(best.entryId, o.staffId, today, best.startMinute), null)}>
                    Book {best.clientName.split(" ")[0]}
                  </Button>
                )}
                <Link href={REVIEW} className={buttonClass("secondary", "sm")}>
                  Review
                </Link>
              </Item>
            );
          })}
          {state.reorders.map((r) => (
            <Item
              key={r.supplierId}
              label="Reorder draft"
              title={r.headline}
              detail={`An order for ${r.supplier}: ${r.lines} ${r.lines === 1 ? "product" : "products"}${seesMoney ? `, ${formatPrice(r.totalCents)}` : ""}.`}
            >
              <Link href="/inventory" className={buttonClass("secondary", "sm")}>
                Review
              </Link>
            </Item>
          ))}
        </ul>
      )}
    </section>
  );
}

function Item({ label, title, detail, children }: { label: string; title: string; detail: string; children: React.ReactNode }) {
  return (
    <li className="flex animate-fade-in flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-denise-200 bg-surface px-4 py-3" data-testid="denise-item">
      <DeniseFace size={28} />
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-xs font-semibold tracking-wide text-denise-700 uppercase">{label}</p>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-sm text-ink-muted">{detail}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </li>
  );
}
