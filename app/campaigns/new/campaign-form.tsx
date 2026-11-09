"use client";

// Writing a campaign: in staff's own words, with a preview as a text and
// as an email. Sending asks once more.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { renderTemplate } from "@/lib/automations";
import { campaignProblem, CAMPAIGN_FIELDS, MAX_CAMPAIGN_BODY, STARTER } from "@/lib/campaigns";
import type { Channel } from "@/lib/messaging/consent";
import { smsCounterText } from "@/lib/messaging/templates";
import { sendCampaign } from "../actions";

export function CampaignForm({
  id,
  encoded,
  count,
  sample,
  salon,
  bookingUrl,
  bookingLive,
  canSendNow,
}: {
  id: string;
  encoded: string;
  count: number;
  sample: string;
  salon: string;
  bookingUrl: string;
  bookingLive: boolean;
  canSendNow: boolean;
}) {
  const router = useRouter();
  const [campaignId] = useState(id);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState(STARTER.subject);
  const [body, setBody] = useState(STARTER.body);
  const [prefer, setPrefer] = useState<Channel>("sms");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const problem = campaignProblem({ name, subject, body }, bookingLive);
  const values = { first_name: sample, salon, booking_link: bookingUrl };
  const preview = renderTemplate(body, values);
  const counter = smsCounterText(preview);

  const send = () =>
    start(async () => {
      setError(null);
      const r = await sendCampaign({ id: campaignId, encoded, name, subject, body, prefer });
      if (!r.ok) {
        setAsking(false);
        setError(r.message);
        return;
      }
      router.push(`/campaigns?sent=${r.sent}`);
    });

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <label className={labelClass}>
        Name (only your team sees this)
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={fieldClass} />
      </label>
      <label className={labelClass}>
        Send by
        <select value={prefer} onChange={(e) => setPrefer(e.target.value as Channel)} className={selectClass}>
          <option value="sms">Text first, else email</option>
          <option value="email">Email first, else text</option>
        </select>
      </label>
      <label className={labelClass}>
        Email subject
        <input value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} className={fieldClass} />
      </label>
      <label className={labelClass}>
        Message
        <textarea value={body} rows={5} maxLength={MAX_CAMPAIGN_BODY} onChange={(e) => setBody(e.target.value)} className={fieldClass} />
        <span className="font-normal text-ink-muted">You can use {CAMPAIGN_FIELDS.map((f) => `{${f}}`).join(", ")}. A way to opt out is added for you.</span>
      </label>
      <section aria-label="Preview" data-testid="campaign-preview" className="rounded-lg border border-line bg-surface p-4">
        <p className="text-xs font-medium text-ink-muted">Preview for {sample}</p>
        <p className="mt-1 text-sm font-medium text-ink">{renderTemplate(subject, values)}</p>
        <p className="mt-1 text-sm wrap-anywhere whitespace-pre-wrap text-ink">{preview}</p>
        <p className={`mt-2 text-xs ${counter.warn ? "text-warning-ink" : "text-ink-muted"}`}>{counter.text}</p>
      </section>
      {error && <Alert tone="error">{error}</Alert>}
      {problem && name && <p className="text-13 text-ink-muted">{problem}</p>}
      {!canSendNow && <Alert tone="info">Campaigns go out between 9am and 8pm at the salon.</Alert>}
      {asking ? (
        <div className="flex flex-wrap items-center gap-3" data-testid="campaign-confirm">
          <p className="text-sm text-ink">Send to {count} {count === 1 ? "client" : "clients"} now? This can&rsquo;t be taken back.</p>
          <Button onClick={send} disabled={pending}>
            Yes, send it
          </Button>
          <Button variant="quiet" onClick={() => setAsking(false)} disabled={pending}>
            Not yet
          </Button>
        </div>
      ) : (
        <div>
          <Button onClick={() => setAsking(true)} disabled={Boolean(problem) || !canSendNow || count === 0}>
            Send to {count} {count === 1 ? "client" : "clients"}
          </Button>
        </div>
      )}
    </div>
  );
}
