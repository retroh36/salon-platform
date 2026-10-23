"use client";

import { useState, useTransition } from "react";
import { sendGiftCard } from "@/app/sales/actions";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { adjustCard, findCard, issuePromoCard, voidCard, type CardResult } from "./actions";

function Outcome({ result }: { result: CardResult | null }) {
  if (!result) return null;
  return <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>;
}

export function FindCardForm() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<CardResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Check a balance"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await findCard(code)));
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${labelClass} min-w-56 flex-1`}>
          Card code (enter or scan)
          <input value={code} onChange={(e) => setCode(e.target.value)} className={`${fieldClass} font-mono uppercase`} autoComplete="off" />
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          Check balance
        </Button>
      </div>
      <Outcome result={result} />
    </form>
  );
}

export function PromoForm({ defaultDays }: { defaultDays: number }) {
  const [f, setF] = useState({ amount: "", reason: "", days: String(defaultDays), recipientName: "", recipientEmail: "" });
  const [result, setResult] = useState<CardResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Issue a promotional card"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await issuePromoCard(f)));
      }}
    >
      <label className={labelClass}>
        Amount ($)
        <input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={fieldClass} required />
      </label>
      <label className={labelClass}>
        Lasts (days)
        <input inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} className={fieldClass} />
      </label>
      <label className={`${labelClass} sm:col-span-2`}>
        What it&apos;s for
        <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={fieldClass} placeholder="e.g. Referral reward" required maxLength={300} />
      </label>
      <label className={labelClass}>
        For (name, optional)
        <input value={f.recipientName} onChange={(e) => setF({ ...f, recipientName: e.target.value })} className={fieldClass} maxLength={120} />
      </label>
      <label className={labelClass}>
        Email (optional)
        <input type="email" value={f.recipientEmail} onChange={(e) => setF({ ...f, recipientEmail: e.target.value })} className={fieldClass} />
      </label>
      <p className="text-sm text-ink-muted sm:col-span-2">Promotional cards have no cash value: they can be used for services and products, but never refunded as money.</p>
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        Issue card
      </Button>
      <div className="sm:col-span-2">
        <Outcome result={result} />
      </div>
    </form>
  );
}

export function SendCardForm({ cardId, email }: { cardId: string; email: string }) {
  const [to, setTo] = useState(email);
  const [result, setResult] = useState<CardResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Email the card"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await sendGiftCard(cardId, to)));
      }}
    >
      <div className="flex gap-2">
        <input type="email" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Email address" className={`${fieldClass} min-w-0 flex-1`} required />
        <Button type="submit" disabled={pending}>
          Email card
        </Button>
      </div>
      <Outcome result={result} />
    </form>
  );
}

export function AdjustCardForm({ cardId }: { cardId: string }) {
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<CardResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Adjust balance"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await adjustCard(cardId, amount, direction, reason)));
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Change
          <select value={direction} onChange={(e) => setDirection(e.target.value as "add" | "remove")} className={selectClass}>
            <option value="add">Add</option>
            <option value="remove">Take off</option>
          </select>
        </label>
        <label className={labelClass}>
          Amount ($)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldClass} required />
        </label>
      </div>
      <label className={labelClass}>
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} required maxLength={300} />
      </label>
      <Button type="submit" disabled={pending} className="self-start">
        Adjust
      </Button>
      <Outcome result={result} />
    </form>
  );
}

export function VoidCardForm({ cardId }: { cardId: string }) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<CardResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Void card"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await voidCard(cardId, reason)));
      }}
    >
      <label className={labelClass}>
        Why it&apos;s being voided
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} required maxLength={300} />
      </label>
      <Button type="submit" variant="danger" disabled={pending} className="self-start">
        Void card
      </Button>
      <Outcome result={result} />
    </form>
  );
}
