"use client";

import { useRef, useState, useTransition } from "react";
import { CardField, type CardFieldHandle } from "@/components/card-field";
import type { CardForm } from "@/lib/payments/provider";
import { inputClass, primaryButton } from "@/app/book/[slug]/styles";
import { Alert } from "@/components/ui/page";
import { formatPrice } from "@/lib/services";
import { acceptProposal, payShare, updateCard, type EventLinkResult } from "./actions";
import { CLIENT_NO_CONNECTION, reach } from "@/lib/reach";

// The card field's handle: the chosen test card or Stripe's confirmed form.
async function pick(card: React.RefObject<CardFieldHandle | null>, setResult: (r: EventLinkResult) => void): Promise<string | null> {
  const chosen = await card.current!.cardRef();
  if (!chosen.ok) setResult(chosen);
  return chosen.ok ? chosen.ref : null;
}

function Done({ result, testId }: { result: EventLinkResult & { ok: true }; testId: string }) {
  return (
    <div data-testid={testId}>
      <h2 className="text-xl font-semibold text-ink">Thank you</h2>
      <p className="mt-1.5 text-ink-muted">{result.message} A receipt is on its way.</p>
    </div>
  );
}

// Sign (the full name typed), agree, the card, and pay the deposit to book.
export function AgreeForm({ token, totalCents, depositCents, cardForm }: { token: string; totalCents: number; depositCents: number; cardForm: CardForm }) {
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const card = useRef<CardFieldHandle>(null);
  const [result, setResult] = useState<EventLinkResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <Done result={result} testId="event-booked" />;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const cardRef = await pick(card, setResult);
          if (cardRef) setResult(await reach(acceptProposal(token, { typedName: name, agreed, cardRef, shownTotalCents: totalCents }), CLIENT_NO_CONNECTION));
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Your full name, to sign
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} className={inputClass} />
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="size-5 shrink-0 accent-(--accent)" />
        I&rsquo;ve read and agree to the terms, and to my card being kept for the payments above
      </label>
      <CardField ref={card} form={cardForm} selectClassName={inputClass} />
      {result && !result.ok && <Alert>{result.message}</Alert>}
      <button type="submit" className={primaryButton} disabled={!agreed || name.trim().length < 2 || pending}>
        {pending ? "Booking…" : depositCents > 0 ? `Agree and pay ${formatPrice(depositCents)}` : "Agree and book"}
      </button>
    </form>
  );
}

export function ShareForm({ token, shareCents, cardForm }: { token: string; shareCents: number; cardForm: CardForm }) {
  const card = useRef<CardFieldHandle>(null);
  const [result, setResult] = useState<EventLinkResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <Done result={result} testId="share-paid" />;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const cardRef = await pick(card, setResult);
          if (cardRef) setResult(await reach(payShare(token, { cardRef, shownCents: shareCents }), CLIENT_NO_CONNECTION));
        });
      }}
    >
      <CardField ref={card} form={cardForm} selectClassName={inputClass} />
      {result && !result.ok && <Alert>{result.message}</Alert>}
      <button type="submit" className={primaryButton} disabled={pending}>
        {pending ? "Paying…" : `Pay ${formatPrice(shareCents)}`}
      </button>
    </form>
  );
}

export function NewCardForm({ token, dueCents, cardForm }: { token: string; dueCents: number; cardForm: CardForm }) {
  const card = useRef<CardFieldHandle>(null);
  const [result, setResult] = useState<EventLinkResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <Done result={result} testId="card-updated" />;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const cardRef = await pick(card, setResult);
          if (cardRef) setResult(await reach(updateCard(token, cardRef), CLIENT_NO_CONNECTION));
        });
      }}
    >
      <CardField ref={card} form={cardForm} selectClassName={inputClass} />
      {result && !result.ok && <Alert>{result.message}</Alert>}
      <button type="submit" className={primaryButton} disabled={pending}>
        {pending ? "Saving…" : dueCents > 0 ? `Save card and pay ${formatPrice(dueCents)}` : "Save card"}
      </button>
    </form>
  );
}
