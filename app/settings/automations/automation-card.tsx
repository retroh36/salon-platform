"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Badge } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { AUTOMATION_DESCRIPTIONS, AUTOMATION_LABELS, automationProblems, previewMessage, TEMPLATE_FIELDS, type Automation, type AutomationSettings, type Channel } from "@/lib/automations";
import { formatPrice } from "@/lib/services";
import { decideSuggestion, saveAutomation, sendDueNow, type Result } from "./actions";

type Salon = { name: string; bookingUrl: string; bookingLive: boolean; googleUrl: string | null; yelpUrl: string | null };

// One automation: on or off, when it goes out, the message (with a live
// preview as a text and as an email), and what it's done.
export function AutomationCard({ automation, salon, results }: { automation: Automation; salon: Salon; results: { sent: number; booked: number; revenueCents: number; optedOut: number } }) {
  const [a, setA] = useState(automation);
  const [google, setGoogle] = useState(salon.googleUrl ?? "");
  const [yelp, setYelp] = useState(salon.yelpUrl ?? "");
  const [channel, setChannel] = useState<Channel>(automation.settings.prefer);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<Automation>) => setA({ ...a, ...patch });
  const setSetting = (patch: Partial<AutomationSettings>) => setA({ ...a, settings: { ...a.settings, ...patch } });
  const here = { ...salon, googleUrl: a.kind === "review" ? google.trim() || null : salon.googleUrl, yelpUrl: a.kind === "review" ? yelp.trim() || null : salon.yelpUrl };
  const problems = automationProblems(a, here);
  const preview = previewMessage(a, here, channel);
  const number = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const save = (enabled: boolean) =>
    start(async () => {
      const r = await saveAutomation(a.kind, { enabled, subject: a.subject, body: a.body, settings: a.settings, googleUrl: google, yelpUrl: yelp });
      setResult(r);
      if (r.ok) set({ enabled });
    });

  return (
    <section aria-labelledby={`automation-${a.kind}`} className="mb-6 rounded-xl border border-line bg-surface shadow-card" data-testid="automation" data-kind={a.kind}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 id={`automation-${a.kind}`} className="font-serif text-lg font-semibold text-ink">
            {AUTOMATION_LABELS[a.kind]}
          </h2>
          <p className="text-sm text-ink-muted">{AUTOMATION_DESCRIPTIONS[a.kind]}</p>
        </div>
        <Badge tone={a.enabled ? "green" : "neutral"}>{a.enabled ? "On" : "Off"}</Badge>
      </div>
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            {a.kind === "rebook" && (
              <label className={labelClass}>
                Days after they&apos;re due
                <input type="number" min={0} max={60} value={a.settings.daysAfterDue ?? ""} onChange={(e) => setSetting({ daysAfterDue: number(e.target.value) })} className={`${fieldClass} w-28!`} />
              </label>
            )}
            {a.kind === "win_back" && (
              <label className={labelClass}>
                Weeks since their last visit
                <input type="number" min={4} max={104} value={a.settings.weeks ?? ""} onChange={(e) => setSetting({ weeks: number(e.target.value) })} className={`${fieldClass} w-28!`} />
              </label>
            )}
            {a.kind === "birthday" && (
              <label className={labelClass}>
                Days before the birthday
                <input type="number" min={0} max={14} value={a.settings.daysBefore ?? ""} onChange={(e) => setSetting({ daysBefore: number(e.target.value) })} className={`${fieldClass} w-28!`} />
              </label>
            )}
            {a.kind === "review" && (
              <label className={labelClass}>
                Hours after checkout
                <input type="number" min={1} max={48} value={a.settings.hoursAfter ?? ""} onChange={(e) => setSetting({ hoursAfter: number(e.target.value) })} className={`${fieldClass} w-28!`} />
              </label>
            )}
            <label className={labelClass}>
              Send by
              <select value={a.settings.prefer} onChange={(e) => setSetting({ prefer: e.target.value as Channel })} className={`${selectClass} w-52!`}>
                <option value="sms">Text, else email</option>
                <option value="email">Email, else text</option>
              </select>
            </label>
          </div>
          {a.kind === "review" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Google review link
                <input value={google} onChange={(e) => setGoogle(e.target.value)} className={fieldClass} placeholder="https://g.page/r/…/review" />
              </label>
              <label className={labelClass}>
                Yelp page
                <input value={yelp} onChange={(e) => setYelp(e.target.value)} className={fieldClass} placeholder="https://www.yelp.com/biz/…" />
              </label>
            </div>
          )}
          {a.kind === "birthday" && (
            <label className={labelClass}>
              Offer (optional, fills in {"{offer}"})
              <input value={a.settings.offer ?? ""} onChange={(e) => setSetting({ offer: e.target.value })} className={fieldClass} maxLength={200} placeholder="e.g. Enjoy 15% off any service this month." />
            </label>
          )}
          <label className={labelClass}>
            Email subject
            <input value={a.subject} onChange={(e) => set({ subject: e.target.value })} className={fieldClass} maxLength={120} />
          </label>
          <label className={labelClass}>
            Message
            <textarea value={a.body} onChange={(e) => set({ body: e.target.value })} rows={4} className={fieldClass} maxLength={1000} />
            <span className="text-xs font-normal text-ink-muted">
              Fields our system fills in: {TEMPLATE_FIELDS[a.kind].map((f) => `{${f}}`).join(", ")}. An opt-out is added to every message.
            </span>
          </label>
          {problems.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-status-late-ink" aria-label="Before it can go on" data-testid="automation-problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {a.enabled ? (
              <>
                <Button variant="primary" disabled={pending} onClick={() => save(true)}>
                  Save
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => save(false)}>
                  Turn off
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" disabled={pending || problems.length > 0} onClick={() => save(true)}>
                  Turn on
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => save(false)}>
                  Save without turning on
                </Button>
              </>
            )}
          </div>
          {result && (
            <p role="status" className={`text-sm ${result.ok ? "text-ink-muted" : "text-danger"}`}>
              {result.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Preview</span>
            <Segmented<Channel>
              label={`Preview ${AUTOMATION_LABELS[a.kind]} as`}
              value={channel}
              onChange={setChannel}
              options={[
                { value: "sms", label: "Text" },
                { value: "email", label: "Email" },
              ]}
            />
          </div>
          <div className={`rounded-xl p-3 text-sm whitespace-pre-line ${channel === "sms" ? "bg-sunken" : "border border-line"}`} data-testid="automation-preview">
            {channel === "email" && <p className="mb-2 font-semibold">{preview.subject}</p>}
            {preview.body}
          </div>
          <p className="text-xs text-ink-muted">Shown for a sample client, Ava, whose stylist is Bridget.</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums" aria-label={`${AUTOMATION_LABELS[a.kind]} results`} data-testid="automation-results">
            <dt className="text-ink-muted">Sent (90 days)</dt>
            <dd className="text-right">{results.sent}</dd>
            <dt className="text-ink-muted">Booked from it</dt>
            <dd className="text-right">{results.booked}</dd>
            <dt className="text-ink-muted">Revenue</dt>
            <dd className="text-right">{formatPrice(results.revenueCents)}</dd>
            <dt className="text-ink-muted">Opted out</dt>
            <dd className="text-right">{results.optedOut}</dd>
          </dl>
          <p className="text-xs text-ink-muted">Booked: the client booked within 14 days of the message, any way. Revenue: those visits&apos; sales.</p>
        </div>
      </div>
    </section>
  );
}

export type Suggestion = { id: string; summary: string; reason: string; status: "proposed" | "approved" };

// Denise's suggestions, for an owner to approve (or not).
export function Suggestions({ suggestions }: { suggestions: Suggestion[] }) {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const decide = (id: string, d: "apply" | "reject" | "undo") => start(async () => setResult(await decideSuggestion(id, d)));
  if (!suggestions.length) return null;
  return (
    <section aria-label="Denise's suggestions" className="mb-6 flex flex-col gap-2 rounded-xl border border-denise-200 bg-denise-50 p-4" data-testid="automation-suggestions">
      <p className="font-semibold text-denise-900">Denise suggests</p>
      <ul className="flex flex-col gap-2">
        {suggestions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-surface px-3 py-2.5" data-testid="automation-suggestion">
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink">{s.summary}</span>
              <span className="block text-sm text-ink-muted">{s.reason}</span>
            </span>
            {s.status === "proposed" ? (
              <span className="flex gap-1.5">
                <Button size="sm" variant="primary" disabled={pending} onClick={() => decide(s.id, "apply")}>
                  Turn on
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(s.id, "reject")}>
                  Not now
                </Button>
              </span>
            ) : (
              <Button size="sm" disabled={pending} onClick={() => decide(s.id, "undo")}>
                Undo
              </Button>
            )}
          </li>
        ))}
      </ul>
      {result && (
        <p role="status" className={`text-sm ${result.ok ? "text-ink-muted" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </section>
  );
}

export function SendNow() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await sendDueNow();
            if (!r.ok) return setMessage(r.message);
            const s = r.summary;
            const total = s.rebook + s.win_back + s.birthday + s.review;
            setMessage(s.skippedQuietHours ? "It's outside sending hours (9am to 8pm); they'll go out in the morning." : total ? `Sent ${total}: ${s.rebook} rebook, ${s.win_back} win-back, ${s.birthday} birthday, ${s.review} review.` : "Nothing is due right now.");
          })
        }
      >
        {pending ? "Sending…" : "Send due messages now"}
      </Button>
      {message && (
        <p role="status" className="text-sm text-ink-muted">
          {message}
        </p>
      )}
    </div>
  );
}

