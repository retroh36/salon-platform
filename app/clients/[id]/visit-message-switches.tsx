"use client";

import { useState, useTransition } from "react";
import { setVisitMessages } from "./message-actions";

// What the client told staff about messages about their visits: a switch
// each for texts and emails (off, and greyed, when there's no number or
// address, or they replied STOP).
export function VisitMessageSwitches({ clientId, sms, email }: { clientId: string; sms: { on: boolean; possible: boolean }; email: { on: boolean; possible: boolean } }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = (key: "appointment_sms_ok" | "appointment_email_ok", on: boolean) =>
    start(async () => {
      const r = await setVisitMessages(clientId, { [key]: on });
      setError(r.ok ? null : r.message);
    });
  return (
    <>
      <SwitchRow label="Visit texts" on={sms.on && sms.possible} disabled={pending || !sms.possible} onChange={(on) => toggle("appointment_sms_ok", on)} />
      <SwitchRow label="Visit emails" on={email.on && email.possible} disabled={pending || !email.possible} onChange={(on) => toggle("appointment_email_ok", on)} />
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function SwitchRow({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-13 text-ink-muted">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className="group inline-flex items-center gap-2 rounded-md text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60"
      >
        {on ? "On" : "Off"}
        <span aria-hidden className={`relative h-5 w-9 rounded-full transition-colors duration-(--motion-fast) ${on ? "bg-active" : "bg-line-strong"}`}>
          <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-surface transition-transform duration-(--motion-fast) ${on ? "translate-x-4" : ""}`} />
        </span>
      </button>
    </div>
  );
}
