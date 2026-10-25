"use client";

// Message client (booking details' "⋯"): a quick pick, or what the staff
// member writes (when their role may), about the visit or as an offer, on
// a channel the client allows for that kind of message. Texts show how
// many characters they are, warning past 160 (that sends as 2 texts).
// Denise never writes these.

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { withOptOut } from "@/lib/automations";
import type { Channel, Purpose } from "@/lib/messaging/consent";
import { smsCounterText, STAFF_TEMPLATES, withStopLine, type StaffTemplate } from "@/lib/messaging/templates";
import { previewClientMessage, sendClientMessage } from "./message-actions";

export type MessageChannels = { appointment: Channel[]; marketing: Channel[] };

const CHANNEL_LABELS: Record<Channel, string> = { sms: "Text", email: "Email" };

export function MessageClientForm({
  appointmentId,
  firstName,
  channels,
  freeText,
  onSent,
  onCancel,
}: {
  appointmentId: string;
  firstName: string;
  channels: MessageChannels;
  // Whether this person may write their own (the owner's setting).
  freeText: boolean;
  onSent: (message: string) => void;
  onCancel: () => void;
}) {
  const [template, setTemplate] = useState<StaffTemplate | "custom">(freeText ? "custom" : "please_call");
  const custom = template === "custom";
  const [purpose, setPurpose] = useState<Purpose>("appointment");
  const allowed = channels[custom ? purpose : "appointment"];
  const [channel, setChannel] = useState<Channel>(allowed[0] ?? "sms");
  const ch = allowed.includes(channel) ? channel : allowed[0];
  const [minutes, setMinutes] = useState("10");
  const [time, setTime] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // A quick pick's words, filled in from the visit.
  useEffect(() => {
    if (custom || !ch) return;
    let live = true;
    previewClientMessage({ appointmentId, template, channel: ch, minutes: Number(minutes), time }).then((p) => live && setPreview(p));
    return () => {
      live = false;
    };
  }, [appointmentId, template, ch, minutes, time, custom]);

  const text = custom ? body : (preview?.body ?? "");
  // What the client's phone gets: every text ends with the stop line, an
  // offer with its unsubscribe link (a 32-character token).
  const offer = custom && purpose === "marketing";
  const sent = offer ? withOptOut(text.trim(), "sms", `${typeof window === "undefined" ? "" : window.location.origin}/unsubscribe/${"x".repeat(32)}`) : withStopLine(text.trim());
  const counter = ch === "sms" && text.trim() ? smsCounterText(sent) : null;

  if (!channels.appointment.length && !channels.marketing.length) {
    return (
      <div className="flex animate-fade-in flex-col gap-3 rounded-lg border border-line-strong bg-sunken/60 p-3" aria-label="Message client" role="group">
        <p className="text-ink">{firstName} can&rsquo;t get messages by text or email. Give them a call.</p>
        <Button className="self-start" onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <form
      aria-label="Message client"
      className="flex animate-fade-in flex-col gap-3 rounded-lg border border-line-strong bg-sunken/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ch) return;
        setError(null);
        start(async () => {
          const r = await sendClientMessage({
            appointmentId,
            purpose: custom ? purpose : "appointment",
            template,
            channel: ch,
            subject: custom ? subject : undefined,
            body: custom ? body : undefined,
            minutes: Number(minutes),
            time,
          });
          if (r.ok) onSent(r.message);
          else setError(r.message);
        });
      }}
    >
      <p className="font-semibold text-ink">Message {firstName}</p>
      <label className={labelClass}>
        Message
        <select value={template} onChange={(e) => setTemplate(e.target.value as StaffTemplate | "custom")} className={selectClass}>
          {freeText && <option value="custom">Write my own</option>}
          <optgroup label="Quick picks">
            {(Object.keys(STAFF_TEMPLATES) as StaffTemplate[]).map((k) => (
              <option key={k} value={k}>
                {STAFF_TEMPLATES[k].label}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {custom && (
        <Segmented
          label="What it's about"
          value={purpose}
          onChange={setPurpose}
          options={[
            { value: "appointment", label: "Their visit" },
            { value: "marketing", label: "An offer", disabled: !channels.marketing.length, title: channels.marketing.length ? undefined : `${firstName} hasn't said yes to offers` },
          ]}
        />
      )}
      {allowed.length ? (
        <Segmented label="Send by" value={ch} onChange={setChannel} options={(["sms", "email"] as Channel[]).map((c) => ({ value: c, label: CHANNEL_LABELS[c], disabled: !allowed.includes(c) }))} />
      ) : (
        <p className="text-ink-muted">{firstName} doesn&rsquo;t get visit messages by text or email. Give them a call.</p>
      )}
      {template === "running_late" && (
        <label className={labelClass}>
          Minutes behind
          <input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" className={`${fieldClass} w-24!`} />
        </label>
      )}
      {template === "ready_early" && (
        <label className={labelClass}>
          Earlier time
          <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="1:30pm" className={`${fieldClass} w-28!`} />
        </label>
      )}
      {custom && ch === "email" && (
        <label className={labelClass}>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} className={fieldClass} />
        </label>
      )}
      {custom ? (
        <label className={labelClass}>
          Your message
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={900} className={`${fieldClass} h-auto! py-2`} />
        </label>
      ) : (
        <p className="rounded-md bg-surface p-2 text-ink whitespace-pre-line" data-testid="message-preview">
          {preview?.body ?? "…"}
        </p>
      )}
      {counter && (
        <p className={`text-xs ${counter.warn ? "font-medium text-status-late-ink" : "text-ink-muted"}`} data-testid="sms-counter" aria-live="polite">
          {counter.text}
          {custom && !offer && " · “Reply STOP to stop texts.” is added"}
        </p>
      )}
      {offer && <p className="text-xs text-ink-muted">How to stop offers, with a link, is added at the end.</p>}
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending || !ch || !text.trim()}>
          Send
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
