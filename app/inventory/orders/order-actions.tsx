"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { Alert, Card } from "@/components/ui/page";
import { deleteOrder, receiveOrder, sendOrder, undoReorder } from "./actions";

type Message = { text: string; error: boolean } | null;

// Send, delete, or (for Denise's drafts) undo a draft order.
export function DraftActions({ orderId, actionId }: { orderId: string; actionId: string | null }) {
  const router = useRouter();
  const [message, setMessage] = useState<Message>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>, leave: boolean) =>
    start(async () => {
      const r = await fn();
      if (r.ok && leave) router.push("/inventory/orders");
      else setMessage({ text: r.message, error: !r.ok });
    });
  return (
    <div className="mb-6 flex flex-col gap-3">
      {message && <Alert tone={message.error ? "error" : "success"}>{message.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending} onClick={() => run(() => sendOrder(orderId), false)}>
          Mark as sent
        </Button>
        {actionId ? (
          <Button disabled={pending} onClick={() => run(() => undoReorder(actionId), true)}>
            Undo Denise&apos;s draft
          </Button>
        ) : (
          <Button disabled={pending} onClick={() => run(() => deleteOrder(orderId), true)}>
            Delete draft
          </Button>
        )}
      </div>
    </div>
  );
}

export type ReceiveLine = { id: string; label: string; due: number; container: string };

// A delivery: how many of each arrived (everything still due, to start).
export function ReceiveForm({ orderId, lines }: { orderId: string; lines: ReceiveLine[] }) {
  const defaults = () => Object.fromEntries(lines.map((l) => [l.id, String(l.due)]));
  const [received, setReceived] = useState<Record<string, string>>(defaults);
  // After a delivery, start again from what's still due.
  const due = lines.map((l) => `${l.id}:${l.due}`).join();
  const [shownDue, setShownDue] = useState(due);
  if (due !== shownDue) {
    setShownDue(due);
    setReceived(defaults());
  }
  const [message, setMessage] = useState<Message>(null);
  const [pending, start] = useTransition();
  return (
    <Card title="Receive delivery" titleId="receive-heading" description="Check what arrived. It's added to stock, at the cost on the order.">
      <form
        aria-label="Receive delivery"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          start(async () => {
            const r = await receiveOrder(orderId, received);
            setMessage({ text: r.message, error: !r.ok });
          });
        }}
        className="flex flex-col gap-3"
      >
        {message && <Alert tone={message.error ? "error" : "success"}>{message.text}</Alert>}
        <ul className="divide-y divide-line">
          {lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="min-w-52 flex-1">
                <span className="font-medium text-ink">{l.label}</span>
                <span className="block text-sm text-ink-muted">
                  {l.due} {l.container}
                  {l.due === 1 ? "" : "s"} due
                </span>
              </span>
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                Arrived
                <input
                  type="number"
                  min={0}
                  max={l.due}
                  inputMode="numeric"
                  value={received[l.id]}
                  onChange={(e) => setReceived({ ...received, [l.id]: e.target.value })}
                  aria-label={`${l.label} arrived`}
                  className={`${fieldClass} h-12 w-24 text-center text-base`}
                />
              </label>
            </li>
          ))}
        </ul>
        <Button type="submit" variant="primary" size="lg" className="self-start" disabled={pending}>
          {pending ? "Receiving…" : "Receive into stock"}
        </Button>
      </form>
    </Card>
  );
}
