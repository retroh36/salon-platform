"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert, Section } from "@/components/ui/page";
import { Sheet } from "@/components/ui/sheet";
import type { ShiftSwap } from "@/lib/shift-swaps-load";
import { decideSwap, type SwapState } from "../../shift-swaps/actions";
import { swapText } from "../../shift-swaps/swaps-view";

// Swaps both people have agreed to, for an owner or manager to approve
// (the hours change at once) or decline with a reason.
export function SwapApprovals({ swaps }: { swaps: ShiftSwap[] }) {
  const [notice, setNotice] = useState<SwapState>(undefined);
  const [declining, setDeclining] = useState<ShiftSwap | null>(null);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<SwapState>, after?: () => void) =>
    start(async () => {
      const r = await action();
      setNotice(r);
      if (r?.ok) after?.();
    });
  return (
    <Section title={`Shift swaps (${swaps.length})`} titleId="requests-swaps">
      {notice?.message && <Alert tone={notice.ok ? "success" : "error"} className="mb-3">{notice.message}</Alert>}
      {swaps.length === 0 ? (
        <p className="text-sm text-ink-muted">No swaps waiting.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-labelledby="requests-swaps">
          {swaps.map((s) => (
            <li key={s.id} className="rounded-lg border border-line bg-surface p-4" data-swap={s.id}>
              <p className="text-base font-semibold text-ink">
                {s.fromName} and {s.toName}
              </p>
              <p className="text-sm text-ink">{swapText(s, "")}</p>
              {s.note && <p className="mt-1 text-sm text-ink-muted">&ldquo;{s.note}&rdquo;</p>}
              <p className="mt-1 text-13 text-ink-muted">Both have agreed. Approving changes their hours straight away.</p>
              <div className="mt-3 flex gap-2 border-t border-line pt-3">
                <Button variant="primary" disabled={pending} onClick={() => run(() => decideSwap(s.id, true))}>
                  Approve swap
                </Button>
                <Button variant="secondary" disabled={pending} onClick={() => setDeclining(s)}>
                  Decline…
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {declining && (
        <Sheet title="Decline the swap" onClose={() => setDeclining(null)}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
              run(() => decideSwap(declining.id, false, reason), () => setDeclining(null));
            }}
          >
            <p className="text-sm text-ink">{swapText(declining, "")}</p>
            <label className={labelClass}>
              Why (they&rsquo;ll both see this)
              <textarea name="reason" rows={3} maxLength={300} required className={fieldClass} />
            </label>
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button type="button" variant="secondary" onClick={() => setDeclining(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={pending}>
                Decline swap
              </Button>
            </div>
          </form>
        </Sheet>
      )}
    </Section>
  );
}
