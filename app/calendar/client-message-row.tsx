"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/page";
import type { Channel } from "@/lib/messaging/consent";
import { smsCounterText } from "@/lib/messaging/templates";
import { reach } from "@/lib/reach";

export type RowMessage = { appointmentId: string; clientName: string; channel: Channel | null; body: string; sent: boolean };

// One client's message after their visit changed (Mark out's plan, one of
// Denise's fixes): our template, which staff change if their role may write
// its own, then Send. "Sent" only once it's gone; with no channel they
// allow, call them.
export function ClientMessageRow({
  message: m,
  freeText,
  send,
  onSent,
}: {
  message: RowMessage;
  freeText: boolean;
  // Sends it: `edited` is their own words, or null for the template.
  send: (edited: string | null) => Promise<{ ok: boolean; message: string }>;
  onSent: () => void;
}) {
  const [body, setBody] = useState(m.body);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const edited = body.trim() !== m.body.trim();
  const counter = m.channel === "sms" ? smsCounterText(body) : null;

  function go() {
    if (!m.channel) return;
    start(async () => {
      const r = await reach(send(edited ? body : null));
      setResult(r.ok ? null : r.message);
      if (r.ok) onSent();
    });
  }

  return (
    <li className="rounded-lg border border-line bg-surface p-3" data-testid="client-message">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink">{m.clientName}</p>
        {m.sent ? <Badge tone="success">Sent</Badge> : m.channel ? <Badge>{m.channel === "sms" ? "Text" : "Email"}</Badge> : <Badge tone="warning">No messages: call</Badge>}
      </div>
      {m.sent || !m.channel ? (
        <p className="text-sm whitespace-pre-line text-ink-muted">{m.body}</p>
      ) : (
        <>
          <label className="sr-only" htmlFor={`msg-${m.appointmentId}`}>
            Message to {m.clientName}
          </label>
          <textarea id={`msg-${m.appointmentId}`} value={body} onChange={(e) => setBody(e.target.value)} readOnly={!freeText} rows={4} className={`${fieldClass} h-auto py-2`} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={go} disabled={pending || !body.trim()}>
              {pending ? "Sending…" : "Send"}
            </Button>
            {counter && <span className={`text-xs ${counter.warn ? "text-warning" : "text-ink-subtle"}`}>{counter.text}</span>}
            {!freeText && <span className="text-xs text-ink-subtle">Your role sends the template as it is.</span>}
          </div>
        </>
      )}
      {result && <Alert className="mt-2">{result}</Alert>}
    </li>
  );
}
