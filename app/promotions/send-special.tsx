"use client";

// One regular for an opening: who, how the offer reaches them, the message
// (our template; their own words only when their role may write), and
// Send. Sending checks consent, hours and the one-a-week limit again.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { smsCounterText } from "@/lib/messaging/templates";
import { sendSpecial } from "./actions";

export function SendSpecial({
  promotionId,
  client,
  gap,
  draft,
  canWrite,
  sending,
}: {
  promotionId: string;
  client: { id: string; firstName: string; channel: "sms" | "email"; overdueDays: number };
  gap: { staffId: string; date: string; start: number };
  draft: string;
  canWrite: boolean;
  sending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(draft);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const counter = client.channel === "sms" ? smsCounterText(body) : null;
  return (
    <li className="rounded-lg border border-line bg-surface px-3 py-2" data-testid="idea-client">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="font-medium text-ink">{client.firstName}</span>
          <span className="text-sm text-ink-muted">
            {" "}
            · {client.overdueDays > 0 ? `${client.overdueDays} days overdue` : "due soon"} · offers by {client.channel === "sms" ? "text" : "email"}
          </span>
        </span>
        {result?.ok ? (
          <span className="text-sm font-medium text-status-checked-out-ink" role="status">
            {result.message}
          </span>
        ) : (
          <Button size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Close" : "Message"}
          </Button>
        )}
      </div>
      {open && !result?.ok && (
        <form
          className="mt-2 flex flex-col gap-2"
          aria-label={`Message ${client.firstName}`}
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await sendSpecial({ promotionId, clientId: client.id, ...gap, body });
              setResult({ ok: r.ok, message: r.message ?? "" });
              if (r.ok) setOpen(false);
            });
          }}
        >
          <textarea aria-label="Message" value={body} readOnly={!canWrite} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={800} className={`${fieldClass} h-auto! py-2`} />
          <p className="text-xs text-ink-muted">
            {counter && <span className={counter.warn ? "font-medium text-status-late-ink" : ""}>{counter.text} · </span>}
            How to stop offers is added at the end.{!canWrite && " Your role sends the message as written."}
          </p>
          {result && !result.ok && (
            <p role="alert" className="text-sm text-danger">
              {result.message}
            </p>
          )}
          <Button type="submit" size="sm" variant="primary" className="self-start" disabled={pending || !sending || !body.trim()}>
            {sending ? "Send" : "Offers go out 9am to 8pm"}
          </Button>
        </form>
      )}
    </li>
  );
}
