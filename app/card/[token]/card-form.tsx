"use client";

import { useState, useTransition } from "react";
import { primaryButton } from "@/app/book/[slug]/booking-flow";
import { formatPrice } from "@/lib/services";
import { completeCardLink, type CardLinkResult } from "./actions";
import { CLIENT_NO_CONNECTION, reach } from "@/lib/reach";

// The policy to agree to, the card, and save (paying the deposit first,
// when there is one). Big targets, for a phone.
export function CardForm({ token, lines, depositCents, testMode, cards }: { token: string; lines: string[]; depositCents: number; testMode: boolean; cards: { ref: string; label: string; outcome: string }[] }) {
  const [card, setCard] = useState(cards[0]?.ref ?? "");
  const [agreed, setAgreed] = useState(false);
  const [result, setResult] = useState<CardLinkResult | null>(null);
  const [pending, start] = useTransition();

  if (result?.ok)
    return (
      <div className="flex flex-col gap-2" data-testid="card-saved">
        <h2 className="font-serif text-2xl font-semibold text-ink">You&rsquo;re all set</h2>
        <p className="text-ink-muted">
          {result.label} is saved{result.depositCents > 0 ? `, and your ${formatPrice(result.depositCents)} deposit is paid. It comes off your bill at the visit` : ""}. You&rsquo;ll get a receipt if the policy ever charges it.
        </p>
      </div>
    );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await reach(completeCardLink(token, card, agreed), CLIENT_NO_CONNECTION)));
      }}
    >
      <section aria-labelledby="policy-heading" className="rounded-xl border border-line bg-surface px-4 py-4" data-testid="policy">
        <h2 id="policy-heading" className="font-semibold text-ink">
          Cancellation policy
        </h2>
        <div className="mt-1 flex flex-col gap-1.5 text-sm text-ink-muted">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </section>
      {depositCents > 0 && (
        <p className="flex justify-between rounded-xl border border-line bg-surface px-4 py-4 font-semibold text-ink" data-testid="deposit">
          <span>Deposit, paid now</span>
          <span className="tabular-nums">{formatPrice(depositCents)}</span>
        </p>
      )}
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
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="size-5 shrink-0 accent-(--accent)" />
        I agree to the cancellation policy and to my card being saved for it
      </label>
      {result && !result.ok && (
        <p role="alert" className="font-medium text-danger">
          {result.message}
        </p>
      )}
      <button type="submit" className={primaryButton} disabled={!agreed || pending}>
        {pending ? "Saving…" : depositCents > 0 ? `Pay ${formatPrice(depositCents)} and save card` : "Save card"}
      </button>
    </form>
  );
}
