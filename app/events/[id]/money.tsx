"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { retryEventPayment, sendEventCardLink, sendMemberLink, sendProposal, setEventStatus, type MoneyResult } from "../money-actions";

type Channel = "sms" | "email";

function Status({ result }: { result: MoneyResult | null }) {
  if (!result) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-ink-muted" : "font-medium text-danger"}`}>
      {result.message}
    </p>
  );
}

// Text or email, the address (from the client's profile, editable), send.
function SendLink({ label, phone, email, send, name }: { label: string; phone: string | null; email: string | null; send: (channel: Channel, to: string) => Promise<MoneyResult>; name: string }) {
  const [channel, setChannel] = useState<Channel>(email && !phone ? "email" : phone ? "sms" : "email");
  const [to, setTo] = useState((channel === "sms" ? phone : email) ?? "");
  const [result, setResult] = useState<MoneyResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      aria-label={name}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await send(channel, to)));
      }}
    >
      <Segmented
        label="Send by"
        value={channel}
        onChange={(c) => {
          setChannel(c);
          setTo((c === "sms" ? phone : email) ?? "");
        }}
        options={[
          { value: "sms", label: "Text" },
          { value: "email", label: "Email" },
        ]}
      />
      <input aria-label={channel === "sms" ? "Mobile number" : "Email address"} value={to} onChange={(e) => setTo(e.target.value)} className={fieldClass} inputMode={channel === "sms" ? "tel" : "email"} />
      <Button type="submit" variant="secondary" disabled={pending || !to.trim()}>
        {pending ? "Sending…" : label}
      </Button>
      <Status result={result} />
    </form>
  );
}

export function ProposalSender({ eventId, phone, email, resend }: { eventId: string; phone: string | null; email: string | null; resend: boolean }) {
  return <SendLink name="Send proposal" label={resend ? "Send it again" : "Send proposal"} phone={phone} email={email} send={(c, to) => sendProposal(eventId, c, to)} />;
}

export function CardLinkSender({ eventId, phone, email }: { eventId: string; phone: string | null; email: string | null }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Ask for another card
      </Button>
    );
  return <SendLink name="Send card link" label="Send card link" phone={phone} email={email} send={(c, to) => sendEventCardLink(eventId, c, to)} />;
}

export function MemberLinkSender({ memberId, memberName, phone, email, resend }: { memberId: string; memberName: string; phone: string | null; email: string | null; resend: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label={`${resend ? "Send again" : "Send pay link"} to ${memberName}`}>
        {resend ? "Send again" : "Send pay link"}
      </Button>
    );
  return <SendLink name={`Pay link for ${memberName}`} label="Send pay link" phone={phone} email={email} send={(c, to) => sendMemberLink(memberId, c, to)} />;
}

export function RetryPayment({ paymentId }: { paymentId: string }) {
  const [result, setResult] = useState<MoneyResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => start(async () => setResult(await retryEventPayment(paymentId)))}>
        {pending ? "Trying…" : "Try again"}
      </Button>
      <Status result={result} />
    </span>
  );
}

// Lost (with a reason), or reopened.
export function StatusControls({ eventId, status }: { eventId: string; status: string }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<MoneyResult | null>(null);
  const [pending, start] = useTransition();
  if (status === "lost")
    return (
      <span className="flex items-center gap-2">
        <Button variant="secondary" size="md" disabled={pending} onClick={() => start(async () => setResult(await setEventStatus(eventId, "inquiry")))}>
          Reopen
        </Button>
        <Status result={result} />
      </span>
    );
  if (status === "completed") return null;
  if (!asking)
    return (
      <Button variant="ghost" size="md" onClick={() => setAsking(true)}>
        Mark as lost
      </Button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      aria-label="Mark as lost"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await setEventStatus(eventId, "lost", reason)));
      }}
    >
      <input aria-label="Why was it lost?" placeholder="Why? (went with another salon, date changed…)" value={reason} onChange={(e) => setReason(e.target.value)} className={`${fieldClass} w-72`} maxLength={300} />
      <Button type="submit" variant="danger" size="md" disabled={pending || !reason.trim()}>
        Mark as lost
      </Button>
      <Button type="button" variant="ghost" size="md" onClick={() => setAsking(false)}>
        Not now
      </Button>
      <Status result={result} />
    </form>
  );
}
