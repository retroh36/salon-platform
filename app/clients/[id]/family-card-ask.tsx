"use client";

import { useState, useTransition } from "react";
import { askCardAuthorization, endCardAuthorization, type AuthorizationResult } from "@/app/clients/card-authorization-actions";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { reach } from "@/lib/reach";

export type FamilyPayer = { id: string; firstName: string; cardLabel: string; phone: string | null; email: string | null };

// On the Card on file card of a client without a card: "Use Jen's card…"
// asks a family member with a card of their own to approve it, by link.
export function FamilyCardAsk({ clientId, clientFirstName, payers }: { clientId: string; clientFirstName: string; payers: FamilyPayer[] }) {
  const [open, setOpen] = useState(false);
  const [payerId, setPayerId] = useState(payers[0].id);
  const payer = payers.find((p) => p.id === payerId) ?? payers[0];
  const [channel, setChannel] = useState<"sms" | "email">(payer.phone ? "sms" : "email");
  const [to, setTo] = useState((payer.phone ?? payer.email) ?? "");
  const [result, setResult] = useState<AuthorizationResult | null>(null);
  const [pending, start] = useTransition();

  const choose = (id: string) => {
    const next = payers.find((p) => p.id === id) ?? payers[0];
    setPayerId(next.id);
    setChannel(next.phone ? "sms" : "email");
    setTo((next.phone ?? next.email) ?? "");
  };

  if (!open)
    return (
      <div className="flex flex-col gap-1">
        <Button size="sm" className="self-start" onClick={() => (setOpen(true), setResult(null))}>
          {payers.length === 1 ? `Use ${payers[0].firstName}'s card…` : "Use a family member's card…"}
        </Button>
        {result?.ok && (
          <p role="status" className="text-13 text-ink-muted">
            {result.message}
          </p>
        )}
      </div>
    );

  return (
    <form
      aria-label="Use a family member's card"
      className="flex flex-col gap-3 rounded-lg border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await reach(askCardAuthorization({ clientId, payerId, channel, to }));
          setResult(r);
          if (r.ok) setOpen(false);
        });
      }}
    >
      {payers.length > 1 && (
        <label className={labelClass}>
          Whose card
          <select value={payerId} onChange={(e) => choose(e.target.value)} className={selectClass}>
            {payers.map((p) => (
              <option key={p.id} value={p.id}>{`${p.firstName} · ${p.cardLabel}`}</option>
            ))}
          </select>
        </label>
      )}
      <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Send by">
        {(
          [
            ["sms", "Text"],
            ["email", "Email"],
          ] as const
        ).map(([value, text]) => (
          <label key={value} className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`authorize-channel-${clientId}`}
              checked={channel === value}
              onChange={() => {
                setChannel(value);
                setTo((value === "sms" ? payer.phone : payer.email) ?? "");
              }}
            />
            {text}
          </label>
        ))}
      </div>
      <label className={labelClass}>
        {channel === "sms" ? `${payer.firstName}'s mobile number` : `${payer.firstName}'s email`}
        <input value={to} onChange={(e) => setTo(e.target.value)} inputMode={channel === "sms" ? "tel" : "email"} className={fieldClass} required />
      </label>
      <p className="text-xs text-ink-muted">{`${payer.firstName} reads the cancellation policy for ${clientFirstName}'s visits and approves ${payer.cardLabel} on a secure page. Texts and email wait in the outbox for now.`}</p>
      {result && !result.ok && <Alert>{result.message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {`Ask ${payer.firstName}`}
        </Button>
        <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// Ends an authorization in force, or cancels one still waiting.
export function EndAuthorizationButton({ id, clientId, label }: { id: string; clientId: string; label: string }) {
  const [result, setResult] = useState<AuthorizationResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="quiet" className="-ml-3 self-start" disabled={pending} onClick={() => start(async () => setResult(await reach(endCardAuthorization(id, clientId))))}>
        {label}
      </Button>
      {result && (result.ok ? <p role="status" className="text-13 text-ink-muted">{result.message}</p> : <Alert>{result.message}</Alert>)}
    </div>
  );
}
