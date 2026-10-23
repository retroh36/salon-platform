"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { parseDollars } from "@/lib/checkout";
import { formatPrice } from "@/lib/services";
import { refundSale, voidSale, type SimpleResult } from "../actions";
import { ReceiptActions } from "../checkout-form";

export function PrintOnOpen() {
  useEffect(() => {
    window.print();
  }, []);
  return null;
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
}: {
  saleId: string;
  refundableCents: number;
  products: { id: string; description: string; quantity: number; returned: number }[];
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"card" | "cash">("card");
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
          const r = await refundSale(saleId, {
            reason,
            payments: [{ method, amountCents: cents }],
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
          <select value={method} onChange={(e) => setMethod(e.target.value as "card" | "cash")} className={selectClass}>
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
