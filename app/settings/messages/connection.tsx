"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import type { MessagingStatus } from "@/lib/messaging/status";
import { sendTestMessage, setMessagesLive, type LiveResult } from "./actions";

// Real texts and email: whether each is connected, whether they're going
// to clients, Go live (owners), and a test to the owner's own phone or
// inbox.
export function MessagesConnection({ status, canChange }: { status: MessagingStatus; canChange: boolean }) {
  const [result, setResult] = useState<LiveResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-5" data-testid="messages-connection">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-sm">
        <dt className="text-ink-muted">Texts</dt>
        <dd data-testid="texts-status">
          <Badge tone={status.texts.connected ? "success" : "neutral"}>{status.texts.label}</Badge>
        </dd>
        <dt className="text-ink-muted">Email</dt>
        <dd data-testid="email-status">
          <Badge tone={status.email.connected ? "success" : "neutral"}>{status.email.label}</Badge>
        </dd>
        <dt className="text-ink-muted">Clients get them</dt>
        <dd data-testid="messages-live">
          <Badge tone={status.sending ? "success" : "neutral"}>{status.sending ? "Live" : "Not yet"}</Badge>
        </dd>
      </dl>
      <p className="text-sm text-ink" data-testid="messages-summary">
        {status.summary}
      </p>
      {canChange && (
        <div className="flex flex-col items-start gap-2">
          {status.live ? (
            <Button disabled={pending} onClick={() => start(async () => setResult(await setMessagesLive(false)))}>
              Stop sending to clients
            </Button>
          ) : (
            <Button variant="primary" disabled={pending || !!status.cantGoLive} onClick={() => start(async () => setResult(await setMessagesLive(true)))}>
              Go live
            </Button>
          )}
          {!status.live && status.cantGoLive && <p className="text-13 text-ink-muted">{status.cantGoLive}</p>}
        </div>
      )}
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
      {canChange && <TestSend />}
      {!canChange && <p className="text-sm text-ink-muted">Only owners go live or send a test.</p>}
    </div>
  );
}

function TestSend() {
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<LiveResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3 border-t border-line pt-4"
      aria-label="Send a test"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await sendTestMessage(channel, to)));
      }}
    >
      <p className="text-sm font-medium text-ink">Send a test to yourself</p>
      <Segmented
        label="Test by"
        value={channel}
        onChange={(next) => {
          setChannel(next);
          setResult(null);
        }}
        options={[
          { value: "sms", label: "Text" },
          { value: "email", label: "Email" },
        ]}
      />
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${labelClass} min-w-0 flex-1 basis-56`}>
          {channel === "sms" ? "Your mobile number" : "Your email"}
          <input
            className={fieldClass}
            type={channel === "sms" ? "tel" : "email"}
            autoComplete={channel === "sms" ? "tel" : "email"}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            required
          />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send test"}
        </Button>
      </div>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
