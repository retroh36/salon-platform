"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Badge } from "@/components/ui/page";
import { formatDate } from "@/lib/clients";
import { earliestEnd, periodName, priceText, STATUS_LABELS, type MembershipStatus } from "@/lib/memberships";
import type { ClientMembership } from "@/lib/memberships-load";
import { cancelMembership, keepMembership, pauseMembership, resumeMembership, retryMembershipPayment, updateMembershipCard, type MembershipResult } from "./actions";

const TONE: Record<MembershipStatus, "success" | "warning" | "neutral" | "danger"> = { active: "success", past_due: "danger", paused: "warning", canceled: "neutral" };

export type MembershipHistory = { id: string; at: string; text: string };

// A client's memberships: what's included this period, when it renews or
// ends, and (front of house) pausing, ending, the card, a failed payment.
export function MembershipList({
  memberships,
  history,
  today,
  canChange,
  canEndNow,
  testCards,
}: {
  memberships: ClientMembership[];
  history: Record<string, MembershipHistory[]>;
  today: string;
  canChange: boolean;
  canEndNow: boolean;
  testCards: { ref: string; label: string; outcome: string }[];
}) {
  return (
    <ul className="divide-y divide-line border-y border-line" aria-label="Memberships">
      {memberships.map((m) => (
        <li key={m.id} className="py-3" data-testid="client-membership" data-status={m.status}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-ink">{m.name}</span>
            <span className="flex items-center gap-2">
              <span className="text-sm text-ink-muted tabular-nums">{priceText(m.priceCents, m.intervalUnit, m.intervalCount)}</span>
              <Badge tone={TONE[m.status]}>{STATUS_LABELS[m.status]}</Badge>
            </span>
          </div>
          <p className="mt-1 text-13 text-ink-muted" data-testid="membership-when">
            {whenText(m)}
          </p>
          {m.status !== "canceled" && m.credits.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1 text-13" aria-label={`Included this ${periodName(m.intervalUnit, m.intervalCount)}`}>
              {m.credits.map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span className="text-ink-muted">{c.serviceName}</span>
                  <span className="text-ink-muted tabular-nums">
                    {c.used} of {c.allowance} used · <span className="font-medium text-ink">{c.allowance - c.used} left</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(m.serviceDiscountPct > 0 || m.retailDiscountPct > 0) && m.status !== "canceled" && (
            <p className="mt-1.5 text-13 text-ink-muted">
              Member prices: {[m.serviceDiscountPct && `${m.serviceDiscountPct}% off services`, m.retailDiscountPct && `${m.retailDiscountPct}% off retail`].filter(Boolean).join(", ")}
              {m.status !== "active" ? " (not while it's " + STATUS_LABELS[m.status].toLowerCase() + ")" : ""}
            </p>
          )}
          {canChange && m.status !== "canceled" && <MembershipActions m={m} today={today} canEndNow={canEndNow} testCards={testCards} />}
          {(history[m.id]?.length ?? 0) > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-13 font-medium text-ink-muted hover:text-ink">History</summary>
              <ol className="mt-2 flex flex-col gap-1 text-13" aria-label={`${m.name} history`}>
                {history[m.id].map((h) => (
                  <li key={h.id} className="flex gap-3">
                    <span className="w-24 shrink-0 text-ink-subtle tabular-nums">{formatDate(h.at)}</span>
                    <span>{h.text}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

function whenText(m: ClientMembership): string {
  const card = m.cardLabel ? ` on ${m.cardLabel}` : "";
  switch (m.status) {
    case "canceled":
      return `Ended${m.cancelsOn ? ` ${formatDate(m.cancelsOn)}` : ""}${m.cancelReason ? `: ${m.cancelReason}` : ""}. Member since ${formatDate(m.startedOn)}.`;
    case "paused":
      return `Paused until ${formatDate(m.resumeOn!)}, when it renews${card}.`;
    case "past_due":
      return `The payment due ${formatDate(m.currentPeriodEnd)} didn't go through (${m.failedAttempts} ${m.failedAttempts === 1 ? "try" : "tries"}).${
        m.nextRetryOn ? ` Next try ${formatDate(m.nextRetryOn)}.` : ""
      } No member benefits until it's paid.`;
    default:
      if (m.cancelsOn) return `Ends ${formatDate(m.cancelsOn)}, as asked; no more payments.`;
      if (m.pauseFrom) return `Pauses ${formatDate(m.pauseFrom)} until ${formatDate(m.resumeOn!)}.`;
      return `Member since ${formatDate(m.startedOn)}. Renews ${formatDate(m.currentPeriodEnd)}${card}.`;
  }
}

function MembershipActions({ m, today, canEndNow, testCards }: { m: ClientMembership; today: string; canEndNow: boolean; testCards: { ref: string; label: string; outcome: string }[] }) {
  const [open, setOpen] = useState<null | "pause" | "cancel" | "card">(null);
  const [periods, setPeriods] = useState(1);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(false);
  const [card, setCard] = useState(testCards[0]?.ref ?? "");
  const [result, setResult] = useState<MembershipResult | null>(null);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<MembershipResult>) =>
    start(async () => {
      const r = await action();
      setResult(r);
      if (r.ok) setOpen(null);
    });
  const per = periodName(m.intervalUnit, m.intervalCount);
  const ends = earliestEnd(m, today);
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {m.status === "past_due" && (
          <Button size="xs" variant="primary" disabled={pending} onClick={() => run(() => retryMembershipPayment(m.id))}>
            Try the payment again
          </Button>
        )}
        {m.status === "paused" || (m.status === "active" && m.pauseFrom) ? (
          <Button size="xs" disabled={pending} onClick={() => run(() => resumeMembership(m.id))}>
            {m.status === "paused" ? "Resume now" : "Call off the pause"}
          </Button>
        ) : (
          m.status === "active" &&
          m.allowPause &&
          !m.cancelsOn && (
            <Button size="xs" disabled={pending} onClick={() => setOpen(open === "pause" ? null : "pause")}>
              Pause
            </Button>
          )
        )}
        {m.status === "active" && m.cancelsOn ? (
          <Button size="xs" disabled={pending} onClick={() => run(() => keepMembership(m.id))}>
            Keep membership
          </Button>
        ) : (
          <Button size="xs" variant="danger-quiet" disabled={pending} onClick={() => setOpen(open === "cancel" ? null : "cancel")}>
            End membership
          </Button>
        )}
        <Button size="xs" variant="quiet" disabled={pending} onClick={() => setOpen(open === "card" ? null : "card")}>
          Update card
        </Button>
      </div>

      {open === "pause" && (
        <form
          aria-label={`Pause ${m.name}`}
          className="flex flex-wrap items-end gap-3 rounded-lg bg-sunken p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => pauseMembership(m.id, periods));
          }}
        >
          <label className={labelClass}>
            Pause for
            <select value={periods} onChange={(e) => setPeriods(Number(e.target.value))} className={`${selectClass} w-40!`}>
              {Array.from({ length: m.maxPausePeriods }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? per : `× ${per}`}
                </option>
              ))}
            </select>
          </label>
          <p className="basis-full text-sm text-ink-muted order-last">From {formatDate(m.currentPeriodEnd)}, the end of what&apos;s paid. No payments or benefits while it&apos;s paused.</p>
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            Pause
          </Button>
        </form>
      )}

      {open === "cancel" && (
        <form
          aria-label={`End ${m.name}`}
          className="flex flex-col gap-3 rounded-lg bg-sunken p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => cancelMembership(m.id, reason, now));
          }}
        >
          <p className="text-sm" data-testid="membership-ends">
            {m.status === "active"
              ? `It can end on ${formatDate(ends)}${
                  m.minTermPeriods > 0 && ends > m.currentPeriodEnd ? ` (a minimum of ${m.minTermPeriods} × ${per})` : m.cancelNoticeDays > 0 && ends > m.currentPeriodEnd ? ` (${m.cancelNoticeDays} days' notice)` : ""
                }: benefits until then, no more payments.`
              : "It ends now."}
          </p>
          <label className={labelClass}>
            Why
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} maxLength={300} required />
          </label>
          {canEndNow && m.status === "active" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className={checkboxClass} checked={now} onChange={(e) => setNow(e.target.checked)} />
              End it today instead (an exception to the rules)
            </label>
          )}
          <Button type="submit" size="sm" variant="primary" className="self-start" disabled={pending || !reason.trim()}>
            {now || m.status !== "active" ? "End it now" : `End on ${formatDate(ends)}`}
          </Button>
        </form>
      )}

      {open === "card" && (
        <form
          aria-label={`Card for ${m.name}`}
          className="flex flex-wrap items-end gap-3 rounded-lg bg-sunken p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateMembershipCard(m.id, card));
          }}
        >
          <label className={labelClass}>
            New card
            <select value={card} onChange={(e) => setCard(e.target.value)} className={`${selectClass} w-64!`}>
              {testCards.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {c.label} ({c.outcome.toLowerCase()})
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            Save card
          </Button>
          <p className="basis-full text-xs text-ink-muted">Test mode: no real card is saved or charged.{m.status === "past_due" ? " The payment is tried again on the new card straight away." : ""}</p>
        </form>
      )}

      {result && (
        <p role="status" className={`text-13 ${result.ok ? "text-ink-muted" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
