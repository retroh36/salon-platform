"use client";

import { useState, useTransition } from "react";
import { inputClass, pageLead, primaryButton, sectionTitle } from "@/app/book/[slug]/styles";
import { Alert } from "@/components/ui/page";
import { CLIENT_NO_CONNECTION, reach } from "@/lib/reach";
import { answerAuthorization, type AnswerResult } from "./actions";

// The policy for their visits, the card owner's full name and a tick, then
// Approve; or Decline. Big targets, for a phone.
export function AuthorizeForm({ token, clientFirstName, lines }: { token: string; clientFirstName: string; lines: string[] }) {
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [pending, start] = useTransition();

  if (result?.ok)
    return (
      <div data-testid="authorize-done">
        <h2 className="text-xl font-semibold text-ink">{result.approved ? "Thank you" : "Declined"}</h2>
        <p className={pageLead}>{result.approved ? `${clientFirstName}'s bookings now use your card on file.` : `Your card won't be used for ${clientFirstName}'s visits.`}</p>
      </div>
    );

  const answer = (approve: boolean) =>
    start(async () => {
      setResult(await reach(answerAuthorization(token, approve, name, agreed), CLIENT_NO_CONNECTION));
    });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        answer(true);
      }}
    >
      <section aria-labelledby="policy-heading" data-testid="policy">
        <h2 id="policy-heading" className={sectionTitle}>
          {`Cancellation policy for ${clientFirstName}'s visits`}
        </h2>
        <div className="mt-3 flex flex-col gap-1.5 text-sm text-ink-muted">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </section>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Your full name
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="name" maxLength={120} />
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="size-5 shrink-0 accent-(--accent)" />
        {`I allow my card to hold ${clientFirstName}'s bookings and be charged under this policy for ${clientFirstName}'s visits`}
      </label>
      {result && !result.ok && <Alert>{result.message}</Alert>}
      <button type="submit" className={primaryButton} disabled={!agreed || pending}>
        {pending ? "Saving…" : "Approve"}
      </button>
      <button type="button" className="min-h-11 text-sm font-medium text-ink-muted underline-offset-4 hover:underline" disabled={pending} onClick={() => answer(false)}>
        Decline
      </button>
    </form>
  );
}
