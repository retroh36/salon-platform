"use client";

import { useState, useTransition } from "react";
import type { LinkSnapshot } from "@/lib/payment-links";
import { linkTotal, tipChoices } from "@/lib/payment-links";
import { parseDollars } from "@/lib/checkout";
import { formatPrice } from "@/lib/services";
import { accentLink, chipClass, inputClass, pageLead, pageTitle, primaryButton, sectionTitle } from "@/app/book/[slug]/styles";
import { Alert } from "@/components/ui/page";
import { payLink, type PayResult } from "./actions";
import { CLIENT_NO_CONNECTION, reach } from "@/lib/reach";

type Tip = { kind: "none" } | { kind: "percent"; percent: number; cents: number } | { kind: "custom"; text: string };

const centsOf = (t: Tip) => (t.kind === "percent" ? t.cents : t.kind === "custom" ? (parseDollars(t.text) ?? 0) : 0);

// The receipt, a tip for each stylist (the usual percents, a custom
// amount, or none), the card, and pay. Big targets, for a phone.
export function PayForm({ token, salon, snapshot, testMode, cards }: { token: string; salon: string; snapshot: LinkSnapshot; testMode: boolean; cards: { ref: string; label: string; outcome: string }[] }) {
  const [tips, setTips] = useState<Record<string, Tip>>({});
  const [card, setCard] = useState(cards[0]?.ref ?? "");
  const [result, setResult] = useState<PayResult | null>(null);
  const [pending, start] = useTransition();
  const chosen = Object.entries(tips).map(([staff_id, t]) => ({ staff_id, amount_cents: centsOf(t) }));
  const total = linkTotal(snapshot, chosen);
  const tipTotal = chosen.reduce((n, t) => n + t.amount_cents, 0);

  if (result?.ok)
    return (
      <div className="flex flex-col gap-1" data-testid="link-paid">
        <h1 className={pageTitle}>Paid. Thank you.</h1>
        <p className="mt-1.5 text-base font-medium tabular-nums">
          {formatPrice(result.totalCents)}
          {result.tipCents > 0 ? `, including ${formatPrice(result.tipCents)} in tips` : ""}
        </p>
        <p className="text-ink-muted">{salon} has your payment. See you next time.</p>
      </div>
    );

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await reach(payLink(token, Object.fromEntries(chosen.map((t) => [t.staff_id, t.amount_cents])), card), CLIENT_NO_CONNECTION)));
      }}
    >
      <div>
        <h1 className={pageTitle}>{snapshot.clientFirstName ? `Thanks for coming in, ${snapshot.clientFirstName}` : "Your visit"}</h1>
        <p className={pageLead}>Here&apos;s your receipt from {salon}.</p>
      </div>

      <section aria-label="Receipt" className="overflow-hidden rounded-lg border border-line bg-surface">
        <ul className="flex flex-col divide-y divide-line px-4">
          {snapshot.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3 py-3" data-testid="link-line">
              <span className="min-w-0">
                <span className="block font-medium">
                  {l.name}
                  {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                </span>
                {l.detail && <span className="block text-sm text-ink-muted">{l.detail}</span>}
              </span>
              <span className="shrink-0 font-medium tabular-nums">{formatPrice(l.totalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-1 border-t border-line px-4 py-3 text-sm tabular-nums">
          {snapshot.discountCents > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-muted">Discounts</dt>
              <dd>−{formatPrice(snapshot.discountCents)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-muted">Tax</dt>
            <dd>{formatPrice(snapshot.taxCents)}</dd>
          </div>
          {snapshot.coveredCents > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-muted">Paid already (package or membership)</dt>
              <dd>−{formatPrice(snapshot.coveredCents)}</dd>
            </div>
          )}
        </dl>
      </section>

      {snapshot.stylists.length > 0 && (
        <section aria-label="Tips" className="flex flex-col gap-4">
          <h2 className={sectionTitle}>Add a tip</h2>
          {snapshot.stylists.map((s) => {
            const tip = tips[s.staffId] ?? { kind: "none" };
            const pick = (t: Tip) => setTips({ ...tips, [s.staffId]: t });
            return (
              <div key={s.staffId} role="group" aria-label={`Tip for ${s.firstName}`} className="flex flex-col gap-2">
                <p className="text-sm font-medium text-ink">For {s.firstName}</p>
                <div className="grid grid-cols-4 gap-2">
                  {tipChoices(s.servicesCents).map((c) => (
                    <button
                      key={c.percent}
                      type="button"
                      aria-pressed={tip.kind === "percent" && tip.percent === c.percent}
                      onClick={() => pick({ kind: "percent", percent: c.percent, cents: c.cents })}
                      className={`${chipClass(tip.kind === "percent" && tip.percent === c.percent)} h-14 flex-col tabular-nums`}
                    >
                      {c.percent}%<span className="text-xs font-normal opacity-80">{formatPrice(c.cents)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={tip.kind === "custom"}
                    onClick={() => pick({ kind: "custom", text: "" })}
                    className={`${chipClass(tip.kind === "custom")} h-14`}
                  >
                    Custom
                  </button>
                </div>
                {tip.kind === "custom" && (
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Tip for {s.firstName} ($)
                    <input inputMode="decimal" value={tip.text} onChange={(e) => pick({ kind: "custom", text: e.target.value })} className={inputClass} autoFocus />
                  </label>
                )}
                {tip.kind !== "none" && (
                  <button type="button" onClick={() => pick({ kind: "none" })} className={`min-h-9 self-start text-sm ${accentLink}`}>
                    No tip
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section aria-label="Pay" className="flex flex-col gap-3">
        {testMode && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Card (test mode: nothing is charged)
            <select value={card} onChange={(e) => setCard(e.target.value)} className={inputClass}>
              {cards.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {c.label} ({c.outcome.toLowerCase()})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-base font-semibold">Total{tipTotal > 0 ? ` (with ${formatPrice(tipTotal)} tip)` : ""}</span>
          <span className="text-2xl font-semibold tabular-nums" data-testid="link-total">
            {formatPrice(total)}
          </span>
        </div>
        {result && !result.ok && <Alert>{result.message}</Alert>}
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Paying…" : `Pay ${formatPrice(total)}`}
        </button>
      </section>
    </form>
  );
}
