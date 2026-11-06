"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { CardField, type CardFieldHandle } from "@/components/card-field";
import { Alert } from "@/components/ui/page";
import { parseDollars } from "@/lib/checkout";
import type { CardForm } from "@/lib/payments/provider";
import { CLIENT_NO_CONNECTION, reach } from "@/lib/reach";
import { formatPrice } from "@/lib/services";
import { accentLink, chipClass, inputClass, pageLead, pageTitle, primaryButton } from "../../../styles";
import { reloadGiftCard, type ReloadResult } from "../../actions";

const newAttemptKey = () => crypto.randomUUID().replaceAll("-", "");

// An amount (a preset or their own, $5 to $1,000), the card, and Reload.
export function ReloadForm({
  slug,
  card,
  presets,
  cardForm,
}: {
  slug: string;
  card: { id: string; last4: string; balanceCents: number };
  presets: number[];
  cardForm: CardForm;
}) {
  const [amount, setAmount] = useState(presets[1] ? String(presets[1] / 100) : "");
  const [result, setResult] = useState<ReloadResult | null>(null);
  const [pending, start] = useTransition();
  // One attempt charges once, however many times it's sent.
  const [attempt] = useState(newAttemptKey);
  const field = useRef<CardFieldHandle>(null);
  const cents = parseDollars(amount);
  const valid = cents !== null && cents >= 500 && cents <= 100000;
  const back = `/book/${slug}/account`;

  if (result?.ok)
    return (
      <div className="flex flex-col gap-3" data-testid="reloaded">
        <h1 className={pageTitle}>Reloaded</h1>
        <p className="text-base text-ink">
          {formatPrice(result.amountCents)} added. Your gift card ending {card.last4} now has <span className="font-semibold tabular-nums">{formatPrice(result.balanceCents)}</span>.
        </p>
        <Link href={back} className={`self-start ${accentLink}`}>
          Back to your account
        </Link>
      </div>
    );

  return (
    <form
      className="flex flex-col gap-6"
      aria-label="Reload"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        start(async () => {
          const picked = await field.current!.cardRef();
          if (!picked.ok) return setResult(picked);
          setResult(await reach(reloadGiftCard(slug, card.id, cents, picked.ref, attempt), CLIENT_NO_CONNECTION));
        });
      }}
    >
      <div>
        <h1 className={pageTitle}>Reload your gift card</h1>
        <p className={pageLead}>
          The card ending {card.last4} has <span className="tabular-nums">{formatPrice(card.balanceCents)}</span> on it.
        </p>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium text-ink">Amount</legend>
        {presets.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {presets.map((c) => (
              <button key={c} type="button" aria-pressed={cents === c} onClick={() => setAmount(String(c / 100))} className={`min-h-12 ${chipClass(cents === c)}`}>
                {formatPrice(c)}
              </button>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Another amount ($)
          <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== "" && !valid} />
        </label>
        {amount !== "" && !valid && <p className="text-sm text-danger">Choose an amount from $5 to $1,000.</p>}
      </fieldset>
      <section aria-label="Pay" className="flex flex-col gap-3">
        <CardField ref={field} form={cardForm} selectClassName={inputClass} />
        {result && !result.ok && <Alert>{result.message}</Alert>}
        <button type="submit" disabled={pending || !valid} aria-busy={pending} className={primaryButton}>
          {pending ? "Reloading…" : valid ? `Reload ${formatPrice(cents)}` : "Reload"}
        </button>
        <Link href={back} className={`self-center ${accentLink}`}>
          Cancel
        </Link>
      </section>
    </form>
  );
}
