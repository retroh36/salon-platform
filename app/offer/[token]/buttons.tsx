"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { buttonSpinner, inputClass, primaryButton, secondaryButton, sectionTitle } from "@/app/book/[slug]/styles";
import { CardField, type CardFieldHandle } from "@/components/card-field";
import type { CardForm } from "@/lib/payments/provider";
import { CLIENT_NO_CONNECTION, reach } from "@/lib/reach";
import { formatPrice } from "@/lib/services";
import { answerOffer } from "./actions";

// What the cancellation policy asks before the time is theirs: its text
// with this visit's amounts, a deposit to pay now, and the card (the one on
// file, or one entered here).
export type OfferPay = { lines: string[]; depositCents: number; cardOnFile: string | null; cardForm: CardForm };

export function OfferButtons({ token, salon, pay }: { token: string; salon: string; pay: OfferPay | null }) {
  const router = useRouter();
  const card = useRef<CardFieldHandle>(null);
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState<boolean | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function answer(take: boolean) {
    setChoice(take);
    setError(null);
    start(async () => {
      let cardRef: string | undefined;
      if (take && pay && !pay.cardOnFile) {
        const chosen = await card.current!.cardRef();
        if (!chosen.ok) return setError(chosen.message);
        cardRef = chosen.ref;
      }
      const result = await reach(answerOffer(token, take, take && pay ? { cardRef, agreed } : {}), CLIENT_NO_CONNECTION);
      if (!result.ok) setError(result.message);
      else if (result.manageUrl) router.push(`${result.manageUrl}?booked=1`);
      else router.refresh();
    });
  }

  const take = pay ? (pay.depositCents > 0 ? `Pay ${formatPrice(pay.depositCents)} and take it` : "Take it") : "Take it";
  return (
    <div className="flex flex-col gap-5">
      {pay && (
        <>
          <section aria-labelledby="policy-heading" data-testid="policy">
            <h2 id="policy-heading" className={sectionTitle}>
              Cancellation policy
            </h2>
            <div className="mt-3 flex flex-col gap-1.5 text-sm text-ink-muted">
              {pay.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </section>
          {pay.depositCents > 0 && (
            <p className="flex justify-between border-y border-line py-3 font-semibold text-ink" data-testid="deposit">
              <span>Deposit, paid now</span>
              <span className="tabular-nums">{formatPrice(pay.depositCents)}</span>
            </p>
          )}
          {pay.cardOnFile ? (
            <p className="text-sm text-ink-muted" data-testid="card-on-file">
              {pay.depositCents > 0 ? `The deposit goes on your ${pay.cardOnFile}` : `Held on your ${pay.cardOnFile}`}.
            </p>
          ) : (
            <CardField ref={card} form={pay.cardForm} selectClassName={inputClass} />
          )}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="size-5 shrink-0 accent-(--accent)" />
            {pay.cardOnFile ? "I agree to the cancellation policy" : "I agree to the cancellation policy and to my card being saved for it"}
          </label>
        </>
      )}
      <div className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button type="button" className={primaryButton} disabled={pending || (pay !== null && !agreed)} aria-busy={pending && choice === true} onClick={() => answer(true)}>
          {pending && choice === true ? <span className={buttonSpinner} aria-hidden /> : null}
          {take}
        </button>
        <button type="button" className={secondaryButton} disabled={pending} onClick={() => answer(false)}>
          No thanks
        </button>
        <p className="text-xs text-ink-muted">Taking it books the visit with {salon}. You can change or cancel it afterwards.</p>
      </div>
    </div>
  );
}
