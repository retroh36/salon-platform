"use client";

import { useState, useTransition } from "react";
import { inputClass, primaryButton } from "@/app/book/[slug]/styles";
import { Alert } from "@/components/ui/page";
import { formatPrice } from "@/lib/services";
import { acceptProposal, payShare, updateCard, type EventLinkResult } from "./actions";
import { CLIENT_NO_CONNECTION, reach } from "@/lib/reach";

type Card = { ref: string; label: string; outcome: string };

function CardPicker({ cards, value, onChange }: { cards: Card[]; value: string; onChange: (ref: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      Card (test mode: nothing is charged)
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {cards.map((c) => (
          <option key={c.ref} value={c.ref}>
            {c.label} ({c.outcome.toLowerCase()})
          </option>
        ))}
      </select>
    </label>
  );
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
export function AgreeForm({ token, totalCents, depositCents, testMode, cards }: { token: string; totalCents: number; depositCents: number; testMode: boolean; cards: Card[] }) {
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [card, setCard] = useState(cards[0]?.ref ?? "");
  const [result, setResult] = useState<EventLinkResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <Done result={result} testId="event-booked" />;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await reach(acceptProposal(token, { typedName: name, agreed, cardRef: card, shownTotalCents: totalCents }), CLIENT_NO_CONNECTION)));
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
      {testMode && <CardPicker cards={cards} value={card} onChange={setCard} />}
      {result && !result.ok && <Alert>{result.message}</Alert>}
      <button type="submit" className={primaryButton} disabled={!agreed || name.trim().length < 2 || pending}>
        {pending ? "Booking…" : depositCents > 0 ? `Agree and pay ${formatPrice(depositCents)}` : "Agree and book"}
      </button>
    </form>
  );
}

export function ShareForm({ token, shareCents, testMode, cards }: { token: string; shareCents: number; testMode: boolean; cards: Card[] }) {
  const [card, setCard] = useState(cards[0]?.ref ?? "");
  const [result, setResult] = useState<EventLinkResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <Done result={result} testId="share-paid" />;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await reach(payShare(token, { cardRef: card, shownCents: shareCents }), CLIENT_NO_CONNECTION)));
      }}
    >
      {testMode && <CardPicker cards={cards} value={card} onChange={setCard} />}
      {result && !result.ok && <Alert>{result.message}</Alert>}
      <button type="submit" className={primaryButton} disabled={pending}>
        {pending ? "Paying…" : `Pay ${formatPrice(shareCents)}`}
      </button>
    </form>
  );
}

export function NewCardForm({ token, dueCents, testMode, cards }: { token: string; dueCents: number; testMode: boolean; cards: Card[] }) {
  const [card, setCard] = useState(cards[0]?.ref ?? "");
  const [result, setResult] = useState<EventLinkResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <Done result={result} testId="card-updated" />;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await reach(updateCard(token, card), CLIENT_NO_CONNECTION)));
      }}
    >
      {testMode && <CardPicker cards={cards} value={card} onChange={setCard} />}
      {result && !result.ok && <Alert>{result.message}</Alert>}
      <button type="submit" className={primaryButton} disabled={pending}>
        {pending ? "Saving…" : dueCents > 0 ? `Save card and pay ${formatPrice(dueCents)}` : "Save card"}
      </button>
    </form>
  );
}
