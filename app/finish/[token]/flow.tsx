"use client";

import { useState } from "react";
import { pageLead, pageTitle } from "@/app/book/[slug]/styles";
import { CardForm } from "@/app/card/[token]/card-form";
import { LinkForms } from "@/app/form/[token]/forms";
import type { LinkForm } from "@/lib/form-links";
import type { CardForm as CardFormData } from "@/lib/payments/provider";
import { formatPrice } from "@/lib/services";

export type FinishCard = { token: string; lines: string[]; depositCents: number; cardForm: CardFormData };
export type FinishForms = { token: string; forms: LinkForm[] };

// The card first (with the policy and any deposit), then each form, one
// after another, ending on the forms' thank-you; with only one of them,
// just that. Each step is the card or form link's own, by its own token.
export function FinishFlow({ firstName, salon, card, forms }: { firstName: string; salon: string; card: FinishCard | null; forms: FinishForms | null }) {
  const [saved, setSaved] = useState<{ label: string; depositCents: number } | null>(null);
  const steps = (card ? 1 : 0) + (forms ? 1 : 0);

  if (card && !saved)
    return (
      <section className="flex flex-col gap-4" aria-labelledby="finish-card" data-testid="finish-card">
        <div>
          <h2 id="finish-card" className="text-xl font-semibold text-ink">
            {card.depositCents > 0 ? "Your deposit and card" : "Your card"}
          </h2>
          {steps > 1 && <p className="text-sm text-ink-muted">Step 1 of {steps}</p>}
        </div>
        <CardForm token={card.token} lines={card.lines} depositCents={card.depositCents} cardForm={card.cardForm} onSaved={setSaved} />
      </section>
    );

  const savedLine = saved && (
    <p className="text-sm text-ink-muted" data-testid="finish-card-saved">
      {saved.label} is saved{saved.depositCents > 0 ? `, and your ${formatPrice(saved.depositCents)} deposit is paid` : ""}.
    </p>
  );
  if (forms)
    return (
      <section className="flex flex-col gap-4" data-testid="finish-forms">
        {savedLine}
        {steps > 1 && <p className="text-sm text-ink-muted">Step 2 of {steps}</p>}
        <LinkForms token={forms.token} firstName={firstName} salon={salon} forms={forms.forms} />
      </section>
    );
  return (
    <div data-testid="finish-done">
      <h1 className={pageTitle}>You&rsquo;re all set, {firstName}</h1>
      <p className={pageLead}>{salon} has what it needs for your booking. See you soon.</p>
      {savedLine}
    </div>
  );
}
