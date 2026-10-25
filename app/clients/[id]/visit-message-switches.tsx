"use client";

import { useState, useTransition } from "react";
import { checkboxClass } from "@/components/ui/field";
import { setVisitMessages } from "./message-actions";

// What the client told staff about messages about their visits.
export function VisitMessageSwitches({ clientId, sms, email }: { clientId: string; sms: { on: boolean; possible: boolean }; email: { on: boolean; possible: boolean } }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = (key: "appointment_sms_ok" | "appointment_email_ok", on: boolean) =>
    start(async () => {
      const r = await setVisitMessages(clientId, { [key]: on });
      setError(r.ok ? null : r.message);
    });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-medium">About their visits</legend>
      <label className="flex items-center gap-2">
        <input type="checkbox" className={checkboxClass} checked={sms.on && sms.possible} disabled={pending || !sms.possible} onChange={(e) => toggle("appointment_sms_ok", e.target.checked)} />
        Texts (confirmations, reminders, changes)
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" className={checkboxClass} checked={email.on && email.possible} disabled={pending || !email.possible} onChange={(e) => toggle("appointment_email_ok", e.target.checked)} />
        Emails
      </label>
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
