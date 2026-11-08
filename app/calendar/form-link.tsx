"use client";

import { useState, useTransition } from "react";
import { sendFormLink, type FormLinkResult } from "@/app/clients/forms-actions";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";

// "Send form link" under booking details' "Before this visit": the client
// fills in and signs the forms on their own phone before they come (a
// visit booked by phone, say). Our fixed message, through the outbox.
export function FormLinkButton({ appointmentId, phone, email }: { appointmentId: string; phone: string | null; email: string | null }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<"sms" | "email">(phone || !email ? "sms" : "email");
  const [to, setTo] = useState((phone ? phone : email) ?? "");
  const [result, setResult] = useState<FormLinkResult | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <div className="ml-6 flex flex-col gap-1">
        <Button size="sm" className="self-start" onClick={() => (setOpen(true), setResult(null))}>
          {result?.ok ? "Send form link again" : "Send form link"}
        </Button>
        {result?.ok && (
          <p role="status" className="text-sm text-ink-muted">
            {result.message}
          </p>
        )}
      </div>
    );
  return (
    <form
      aria-label="Send form link"
      className="ml-6 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await sendFormLink({ appointmentId, channel, to });
          setResult(r);
          if (r.ok) setOpen(false);
        });
      }}
    >
      <div className="flex gap-4 text-sm">
        {(
          [
            ["sms", "Text"],
            ["email", "Email"],
          ] as const
        ).map(([value, text]) => (
          <label key={value} className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`form-link-channel-${appointmentId}`}
              checked={channel === value}
              onChange={() => {
                setChannel(value);
                setTo((value === "sms" ? phone : email) ?? "");
              }}
            />
            {text}
          </label>
        ))}
      </div>
      <label className={labelClass}>
        {channel === "sms" ? "Mobile number" : "Email"}
        <input value={to} onChange={(e) => setTo(e.target.value)} inputMode={channel === "sms" ? "tel" : "email"} className={fieldClass} required />
      </label>
      <p className="text-xs text-ink-muted">They fill in and sign every form this visit still needs on a secure page, until the visit starts. Texts and email wait in the outbox for now.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          Send link
        </Button>
        <Button size="sm" onClick={() => setOpen(false)}>
          Not now
        </Button>
      </div>
      {result && !result.ok && (
        <p role="alert" className="text-sm text-danger">
          {result.message}
        </p>
      )}
    </form>
  );
}
