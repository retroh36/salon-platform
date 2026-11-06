"use client";

import { useState, useTransition } from "react";
import { checkboxClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { REMINDER_HOURS, reminderMessage, type ReminderHours } from "@/lib/reminders";
import { saveReminders } from "./actions";

const HOURS_LABEL: Record<ReminderHours, string> = { 2: "2 hours before", 4: "4 hours before", 12: "12 hours before", 24: "A day before", 48: "Two days before", 72: "Three days before" };

// Reminders before each visit: on or off, how long before, and the message
// as a client reads it (fixed words, filled in for each visit).
export function ReminderSettings({ on, hours, salon, online, phone }: { on: boolean; hours: ReminderHours; salon: string; online: boolean; phone: string | null }) {
  const [value, setValue] = useState({ on, hours });
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [, start] = useTransition();
  const save = (next: { on: boolean; hours: ReminderHours }) => {
    setValue(next);
    start(async () => setResult(await saveReminders(next.on, next.hours)));
  };
  const sample = reminderMessage({
    salon,
    firstName: "Ava",
    when: value.hours >= 24 ? "tomorrow, Tue, Nov 10 at 2:15pm" : "today at 2:15pm",
    stylists: "Bridget",
    manageUrl: online ? "(a link to their visit)" : null,
    phone,
  });
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className={checkboxClass} checked={value.on} onChange={(e) => save({ ...value, on: e.target.checked })} />
        Send clients a reminder before each visit
      </label>
      <label className={`${labelClass} max-w-xs`}>
        When
        <select className={selectClass} value={value.hours} disabled={!value.on} onChange={(e) => save({ ...value, hours: Number(e.target.value) as ReminderHours })}>
          {REMINDER_HOURS.map((h) => (
            <option key={h} value={h}>
              {HOURS_LABEL[h]}
            </option>
          ))}
        </select>
      </label>
      {value.on && (
        <p className="text-13 text-ink-muted" data-testid="reminder-sample">
          {sample.body}
        </p>
      )}
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </div>
  );
}
