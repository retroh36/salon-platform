"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonSpinner, primaryButton, secondaryButton } from "@/app/book/[slug]/styles";
import { answerOffer } from "./actions";

export function OfferButtons({ token, salon }: { token: string; salon: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  function answer(take: boolean) {
    setChoice(take);
    setError(null);
    start(async () => {
      const result = await answerOffer(token, take);
      if (!result.ok) setError(result.message);
      else if (result.manageUrl) router.push(`${result.manageUrl}?booked=1`);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button type="button" className={primaryButton} disabled={pending} aria-busy={pending && choice === true} onClick={() => answer(true)}>
        {pending && choice === true ? <span className={buttonSpinner} aria-hidden /> : null}
        Take it
      </button>
      <button type="button" className={secondaryButton} disabled={pending} onClick={() => answer(false)}>
        No thanks
      </button>
      <p className="text-xs text-ink-muted">Taking it books the visit with {salon}. You can change or cancel it afterwards.</p>
    </div>
  );
}
