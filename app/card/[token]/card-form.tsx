"use client";

import { useRef, useState, useTransition } from "react";
import { CardField, type CardFieldHandle } from "@/components/card-field";
import { inputClass, pageLead, primaryButton, sectionTitle } from "@/app/book/[slug]/styles";
import { Alert } from "@/components/ui/page";
import type { CardForm as CardFormData } from "@/lib/payments/provider";
import { formatPrice } from "@/lib/services";
import { completeCardLink, type CardLinkResult } from "./actions";
import { CLIENT_NO_CONNECTION, reach } from "@/lib/reach";

// The policy to agree to, the card, and save (paying the deposit first,
// when there is one). Big targets, for a phone.
export function CardForm({ token, lines, depositCents, cardForm }: { token: string; lines: string[]; depositCents: number; cardForm: CardFormData }) {
  const card = useRef<CardFieldHandle>(null);
  const [agreed, setAgreed] = useState(false);
  const [result, setResult] = useState<CardLinkResult | null>(null);
  const [pending, start] = useTransition();

  if (result?.ok)
    return (
      <div data-testid="card-saved">
        <h2 className="text-xl font-semibold text-ink">You&rsquo;re all set</h2>
        <p className={pageLead}>
          {result.label} is saved{result.depositCents > 0 ? `, and your ${formatPrice(result.depositCents)} deposit is paid. It comes off your bill at the visit` : ""}. You&rsquo;ll get a receipt if the policy ever charges it.
        </p>
      </div>
    );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const chosen = await card.current!.cardRef();
          if (!chosen.ok) return setResult(chosen);
          setResult(await reach(completeCardLink(token, chosen.ref, agreed), CLIENT_NO_CONNECTION));
        });
      }}
    >
      <section aria-labelledby="policy-heading" data-testid="policy">
        <h2 id="policy-heading" className={sectionTitle}>
          Cancellation policy
        </h2>
        <div className="mt-3 flex flex-col gap-1.5 text-sm text-ink-muted">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </section>
      {depositCents > 0 && (
        <p className="flex justify-between border-y border-line py-3 font-semibold text-ink" data-testid="deposit">
          <span>Deposit, paid now</span>
          <span className="tabular-nums">{formatPrice(depositCents)}</span>
        </p>
      )}
      <CardField ref={card} form={cardForm} selectClassName={inputClass} />
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="size-5 shrink-0 accent-(--accent)" />
        I agree to the cancellation policy and to my card being saved for it
      </label>
      {result && !result.ok && <Alert>{result.message}</Alert>}
      <button type="submit" className={primaryButton} disabled={!agreed || pending}>
        {pending ? "Saving…" : depositCents > 0 ? `Pay ${formatPrice(depositCents)} and save card` : "Save card"}
      </button>
    </form>
  );
}
