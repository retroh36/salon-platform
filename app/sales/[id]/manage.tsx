"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { parseDollars } from "@/lib/checkout";
import { formatPrice } from "@/lib/services";
import { emailReceipt, refundSale, voidSale, type SimpleResult } from "../actions";

export function PrintOnOpen() {
  useEffect(() => {
    window.print();
  }, []);
  return null;
}

export function ReceiptActions({ saleId, email, onSent }: { saleId: string; email: string; onSent: (message: string) => void }) {
  const [to, setTo] = useState(email);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Link href={`/sales/${saleId}?print=1`} target="_blank" className={buttonClass("secondary", "sm")}>
          Print receipt
        </Link>
      </div>
      <form
        aria-label="Email receipt"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await emailReceipt(saleId, to);
            onSent(r.message);
          });
        }}
      >
        <input type="email" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Email address" placeholder="client@example.com" className={`${fieldClass} min-w-0 flex-1`} required />
        <Button type="submit" size="sm" disabled={pending}>
          Email receipt
        </Button>
      </form>
    </div>
  );
}

export function EmailReceipt({ saleId, email }: { saleId: string; email: string }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <ReceiptActions saleId={saleId} email={email} onSent={setNote} />
      {note && <p role="status">{note}</p>}
    </div>
  );
}

function Outcome({ result }: { result: SimpleResult | null }) {
  if (!result) return null;
  return <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>;
}

// Void: the whole sale undone (managers and owners, with a reason).
export function VoidForm({ saleId }: { saleId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<SimpleResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Void sale"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await voidSale(saleId, reason);
          setResult(r);
          if (r.ok) router.refresh();
        });
      }}
    >
      <label className={labelClass}>
        Why it&apos;s being voided
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} maxLength={300} required />
      </label>
      <Button type="submit" variant="danger" disabled={pending} className="self-start">
        Void sale
      </Button>
      <Outcome result={result} />
    </form>
  );
}

// Refund: some or all of what was paid, with products returned (and back
// into stock unless they can't be sold again).
export function RefundForm({
  saleId,
  refundableCents,
  products,
  giftCards,
}: {
  saleId: string;
  refundableCents: number;
  products: { id: string; description: string; quantity: number; returned: number }[];
  // Gift cards the sale was paid with: money can go back onto them.
  giftCards: { code: string; label: string }[];
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>(giftCards.length ? `gift:${giftCards[0].code}` : "card");
  const [reason, setReason] = useState("");
  const [returns, setReturns] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState(true);
  const [result, setResult] = useState<SimpleResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Refund"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = parseDollars(amount);
        if (!cents) return setResult({ ok: false, message: "Enter how much to refund." });
        start(async () => {
          const onCard = method.startsWith("gift:");
          const r = await refundSale(saleId, {
            reason,
            payments: [onCard ? { method: "gift_card", amountCents: cents, code: method.slice(5) } : { method: method as "card" | "cash", amountCents: cents }],
            returns: Object.entries(returns)
              .map(([id, q]) => ({ saleItemId: id, quantity: Number(q) || 0 }))
              .filter((x) => x.quantity > 0),
            restock,
          });
          setResult(r);
          if (r.ok) router.refresh();
        });
      }}
    >
      <p className="text-ink-muted">Up to {formatPrice(refundableCents)} can be refunded.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Amount ($)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldClass} required />
        </label>
        <label className={labelClass}>
          Given back by
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={selectClass}>
            {giftCards.map((g) => (
              <option key={g.code} value={`gift:${g.code}`}>
                Back onto {g.label}
              </option>
            ))}
            <option value="card">Card (on the terminal)</option>
            <option value="cash">Cash</option>
          </select>
        </label>
      </div>
      {products.map((p) => (
        <label key={p.id} className="flex items-center justify-between gap-3">
          <span>
            {p.description} returned <span className="text-ink-muted">(of {p.quantity - p.returned})</span>
          </span>
          <input type="number" min={0} max={p.quantity - p.returned} value={returns[p.id] ?? "0"} onChange={(e) => setReturns({ ...returns, [p.id]: e.target.value })} className={`${fieldClass} w-20`} aria-label={`${p.description} returned`} />
        </label>
      ))}
      {products.length > 0 && (
        <label className="flex items-center gap-2">
          <input type="checkbox" className={checkboxClass} checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          Put returned products back in stock
        </label>
      )}
      <label className={labelClass}>
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} maxLength={300} required />
      </label>
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        Refund
      </Button>
      <Outcome result={result} />
    </form>
  );
}
