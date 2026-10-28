"use client";

import { useState, useTransition } from "react";
import { DenisePose } from "@/components/denise";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/page";
import type { CoverageFlag } from "@/lib/coverage";
import { decideMonthDraft, draftNextMonth, type DraftResult } from "./denise-actions";

export type MonthDraft = { id: string; status: "proposed" | "approved"; summary: string; reason: string; filled: string[]; left: string[] };

const SHOWN = 5;

function Lines({ items, label, testId }: { items: string[]; label: string; testId: string }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-13 font-semibold text-denise-900">{label}</p>
      <ul className="flex flex-col gap-1 text-sm text-ink" data-testid={testId}>
        {(all ? items : items.slice(0, SHOWN)).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {items.length > SHOWN && !all && (
        <Button variant="quiet" size="sm" className="self-start" onClick={() => setAll(true)}>
          {items.length - SHOWN} more
        </Button>
      )}
    </div>
  );
}

// Denise on the team schedule, for owners and managers: what she'd flag in
// the week shown (our checks, lib/coverage.ts), and her draft of next
// month, applied into the draft through the AI action log.
export function DeniseSchedule({ flags, draft, monthName }: { flags: CoverageFlag[]; draft: MonthDraft | null; monthName: string }) {
  const [notice, setNotice] = useState<DraftResult | null>(null);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<DraftResult>) => start(async () => setNotice(await action()));

  return (
    <section aria-labelledby="denise-schedule-heading" data-testid="denise-schedule" className="mb-6 flex flex-col gap-4 rounded-lg border border-denise-200 bg-denise-50 p-4">
      <div className="flex items-center gap-3">
        <DenisePose pose={flags.length || draft ? "point" : "wave"} className="w-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id="denise-schedule-heading" className="text-base font-semibold text-denise-900">
            {flags.length ? `I spotted ${flags.length === 1 ? "one thing" : `${flags.length} things`} this week` : "This week looks covered"}
          </h2>
          {!flags.length && <p className="text-sm text-ink-muted">Front desk, stylists, a Master each day, and nobody sharing a chair.</p>}
        </div>
        {!draft && (
          <Button variant="secondary" disabled={pending} onClick={() => run(draftNextMonth)}>
            Draft {monthName}
          </Button>
        )}
      </div>
      {flags.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-ink" data-testid="coverage-flags">
          {flags.map((f) => (
            <li key={`${f.kind}:${f.text}`} data-flag={f.kind}>
              {f.text}
            </li>
          ))}
        </ul>
      )}
      {draft && (
        <div className="flex flex-col gap-3 border-t border-denise-200 pt-4" data-testid="month-draft">
          <div>
            <p className="text-sm font-semibold text-ink">{draft.summary}</p>
            <p className="text-sm text-ink-muted">{draft.reason}</p>
          </div>
          <Lines items={draft.filled} label="Gaps I covered" testId="month-draft-filled" />
          <Lines items={draft.left} label="Still to sort out" testId="month-draft-left" />
          <div className="flex gap-2">
            {draft.status === "proposed" ? (
              <>
                <Button variant="primary" disabled={pending} onClick={() => run(() => decideMonthDraft(draft.id, "apply"))}>
                  Add to the draft
                </Button>
                <Button variant="quiet" disabled={pending} onClick={() => run(() => decideMonthDraft(draft.id, "dismiss"))}>
                  Dismiss
                </Button>
              </>
            ) : (
              <Button variant="secondary" disabled={pending} onClick={() => run(() => decideMonthDraft(draft.id, "undo"))}>
                Undo
              </Button>
            )}
          </div>
        </div>
      )}
      {notice && <Alert tone={notice.ok ? "success" : "error"}>{notice.message}</Alert>}
    </section>
  );
}
