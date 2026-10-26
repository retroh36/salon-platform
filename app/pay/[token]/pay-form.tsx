"use client";

import { useState, useTransition } from "react";
import type { LinkSnapshot } from "@/lib/payment-links";
import { linkTotal, tipChoices } from "@/lib/payment-links";
import { parseDollars } from "@/lib/checkout";
import { formatPrice } from "@/lib/services";
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
      <div className="flex flex-col gap-2" data-testid="link-paid">
        <h1 className="font-serif text-3xl font-semibold text-ink">Paid. Thank you.</h1>
        <p className="text-lg tabular-nums">
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
        <h1 className="font-serif text-3xl font-semibold text-ink">{snapshot.clientFirstName ? `Thanks for coming in, ${snapshot.clientFirstName}` : "Your visit"}</h1>
        <p className="text-ink-muted">Here&apos;s your receipt from {salon}.</p>
      </div>

      <section aria-label="Receipt" className="rounded-xl border border-line bg-surface p-4">
        <ul className="flex flex-col divide-y divide-line">
          {snapshot.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3 py-2" data-testid="link-line">
              <span className="min-w-0">
                <span className="block font-medium">
                  {l.name}
                  {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                </span>
                {l.detail && <span className="block text-sm text-ink-muted">{l.detail}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{formatPrice(l.totalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-2 flex flex-col gap-1 border-t border-line pt-2 text-sm tabular-nums">
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
          <h2 className="text-sm font-semibold tracking-wide text-ink-muted uppercase">Add a tip</h2>
          {snapshot.stylists.map((s) => {
            const tip = tips[s.staffId] ?? { kind: "none" };
            const pick = (t: Tip) => setTips({ ...tips, [s.staffId]: t });
            return (
              <div key={s.staffId} role="group" aria-label={`Tip for ${s.firstName}`} className="flex flex-col gap-2">
                <p className="font-medium">For {s.firstName}</p>
                <div className="grid grid-cols-4 gap-2">
                  {tipChoices(s.servicesCents).map((c) => (
                    <button
                      key={c.percent}
                      type="button"
                      aria-pressed={tip.kind === "percent" && tip.percent === c.percent}
                      onClick={() => pick({ kind: "percent", percent: c.percent, cents: c.cents })}
                      className={`flex h-14 flex-col items-center justify-center rounded-lg border text-sm font-semibold ${tip.kind === "percent" && tip.percent === c.percent ? "border-(--accent) bg-(--accent) text-white" : "border-line-strong bg-surface"}`}
                    >
                      {c.percent}%<span className="text-xs font-normal">{formatPrice(c.cents)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={tip.kind === "custom"}
                    onClick={() => pick({ kind: "custom", text: "" })}
                    className={`h-14 rounded-lg border text-sm font-semibold ${tip.kind === "custom" ? "border-(--accent) bg-(--accent) text-white" : "border-line-strong bg-surface"}`}
                  >
                    Custom
                  </button>
                </div>
                {tip.kind === "custom" && (
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Tip for {s.firstName} ($)
                    <input inputMode="decimal" value={tip.text} onChange={(e) => pick({ kind: "custom", text: e.target.value })} className="h-12 rounded-lg border border-line-strong bg-surface px-3 text-lg" autoFocus />
                  </label>
                )}
                {tip.kind !== "none" && (
                  <button type="button" onClick={() => pick({ kind: "none" })} className="self-start text-sm font-medium text-link underline-offset-2 hover:underline">
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
          <label className="flex flex-col gap-1 text-sm font-medium">
            Card (test mode: nothing is charged)
            <select value={card} onChange={(e) => setCard(e.target.value)} className="h-12 rounded-lg border border-line-strong bg-surface px-3">
              {cards.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {c.label} ({c.outcome.toLowerCase()})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-lg font-semibold">Total{tipTotal > 0 ? ` (with ${formatPrice(tipTotal)} tip)` : ""}</span>
          <span className="font-serif text-3xl font-semibold tabular-nums" data-testid="link-total">
            {formatPrice(total)}
          </span>
        </div>
        {result && !result.ok && (
          <p role="alert" className="font-medium text-danger">
            {result.message}
          </p>
        )}
        <button type="submit" disabled={pending} className="h-14 rounded-xl bg-(--accent) text-lg font-semibold text-white disabled:opacity-60">
          {pending ? "Paying…" : `Pay ${formatPrice(total)}`}
        </button>
      </section>
    </form>
  );
}
