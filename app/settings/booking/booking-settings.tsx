"use client";

import { useActionState, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { contrast } from "@/lib/color";
import { accentReadable, ONLINE_MODE_LABELS, type DepositKind, type OnlineMode } from "@/lib/online-booking/settings";
import type { ShareLink } from "@/lib/online-booking/sources";
import { saveBookingSettings, saveServicesOnline, type BookingSettingsState } from "./actions";

function Result({ state }: { state: BookingSettingsState }) {
  if (!state) return null;
  return state.ok ? (
    <Alert tone="success">
      {state.message}
    </Alert>
  ) : (
    <Alert>{state.message}</Alert>
  );
}

const escapeAttribute = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// The booking link and a snippet for the salon's own website.
export function BookingLink({ url, name, live }: { url: string; name: string; live: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  const embed = `<iframe src="${url}" title="Book with ${escapeAttribute(name)}" style="width:100%;max-width:640px;height:820px;border:0;border-radius:12px" loading="lazy"></iframe>`;
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <p className={`flex items-center gap-2 text-sm font-medium ${live ? "text-ink" : "text-ink-muted"}`} data-testid="booking-status">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${live ? "bg-success-dot" : "bg-neutral-dot"}`} />
        {live ? "Online booking is on." : "Online booking is off: the link shows a note to call instead."}
      </p>
      <div className={labelClass}>
        <span id="booking-link-label">Booking link</span>
        <div className="flex flex-wrap gap-2">
          <input readOnly value={url} aria-labelledby="booking-link-label" className={`${fieldClass} min-w-64 flex-1 font-mono text-sm`} onFocus={(e) => e.currentTarget.select()} />
          <Button onClick={() => copy("link", url)}>{copied === "link" ? "Copied" : "Copy link"}</Button>
          <a href={url} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md")}>
            Open
          </a>
        </div>
      </div>
      <div className={labelClass}>
        <span id="embed-label">Embed on your website</span>
        <textarea readOnly value={embed} rows={3} aria-labelledby="embed-label" className={`${fieldClass} font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
        <div>
          <Button onClick={() => copy("embed", embed)}>{copied === "embed" ? "Copied" : "Copy snippet"}</Button>
        </div>
        <span className="font-normal text-ink-muted">Paste it into your website where the booking should appear. Or link a Book button to the address above.</span>
      </div>
    </div>
  );
}

type RulesFields = {
  enabled: boolean;
  slug: string;
  window_days: string;
  notice_hours: string;
  allow_new_clients: boolean;
  cancel_cutoff_hours: string;
  cancellation_policy: string;
  consultation_service_id: string;
  accent_color: string;
  welcome: string;
};

const PRESETS = ["#17273b", "#6b3f2a", "#2f4a3a", "#5b2a4a", "#1d4e5f", "#3f3f46"];

export function BookingRulesForm({ initial, services }: { initial: RulesFields; services: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveBookingSettings, undefined);
  const errors = state && !state.ok ? (state.errors ?? {}) : {};
  const [accent, setAccent] = useState(initial.accent_color);
  const readable = accentReadable(accent);
  const error = (key: keyof typeof errors) => errors[key] && <span className="animate-fade-in font-normal text-danger">{errors[key]}</span>;

  return (
    <form action={action} aria-label="Online booking rules" className="flex flex-col gap-6" noValidate>
      <Result state={state} />
      <label className="flex items-start gap-3">
        <input type="checkbox" name="enabled" defaultChecked={initial.enabled} className={`${checkboxClass} mt-0.5`} />
        <span>
          <span className="font-medium text-ink">Take bookings online</span>
          <span className="block text-13 font-normal text-ink-muted">Clients book themselves at your booking link. Bookings appear on the calendar right away, marked online.</span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>
          Booking address
          <span className="flex items-center gap-1 font-normal text-ink-muted">
            /book/
            <input name="slug" defaultValue={initial.slug} maxLength={60} className={fieldClass} aria-describedby="slug-hint" />
          </span>
          <span id="slug-hint" className="font-normal text-ink-muted">
            Lowercase letters, numbers and hyphens.
          </span>
          {error("slug")}
        </label>
        <label className={labelClass}>
          How far ahead (days)
          <input name="window_days" type="number" min={1} max={365} defaultValue={initial.window_days} className={fieldClass} />
          {error("window_days")}
        </label>
        <label className={labelClass}>
          Least notice (hours)
          <input name="notice_hours" type="number" min={0} max={168} defaultValue={initial.notice_hours} className={fieldClass} />
          {error("notice_minutes")}
        </label>
        <label className={labelClass}>
          Cancel or change online until (hours before)
          <input name="cancel_cutoff_hours" type="number" min={0} max={168} defaultValue={initial.cancel_cutoff_hours} className={fieldClass} />
          {error("cancel_cutoff_hours")}
        </label>
        <label className={labelClass}>
          &ldquo;Request a consultation&rdquo; books
          <select name="consultation_service_id" defaultValue={initial.consultation_service_id} className={selectClass}>
            <option value="">Nothing (clients call instead)</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-start gap-3">
        <input type="checkbox" name="allow_new_clients" defaultChecked={initial.allow_new_clients} className={`${checkboxClass} mt-0.5`} />
        <span>
          <span className="font-medium text-ink">New clients can book online</span>
          <span className="block text-13 font-normal text-ink-muted">Otherwise only clients already on file can book; new clients are asked to call.</span>
        </span>
      </label>

      <label className={labelClass}>
        Cancellation policy
        <textarea name="cancellation_policy" defaultValue={initial.cancellation_policy} rows={3} maxLength={2000} className={fieldClass} />
        <span className="font-normal text-ink-muted">Clients read and accept this before they book.</span>
        {error("cancellation_policy")}
      </label>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-base font-semibold text-ink">Look</legend>
        <label className={labelClass}>
          Welcome line
          <input name="welcome" defaultValue={initial.welcome} maxLength={280} className={fieldClass} />
          {error("welcome")}
        </label>
        <div className={labelClass}>
          <span id="accent-label">Your color</span>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="accent-label">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                aria-label={`Use ${p}`}
                aria-pressed={accent === p}
                onClick={() => setAccent(p)}
                className={`size-9 rounded-full outline-offset-2 ${accent === p ? "outline-2 outline-ink" : ""}`}
                style={{ backgroundColor: p }}
              />
            ))}
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} aria-label="Custom color" className="h-9 w-12 cursor-pointer rounded-md border border-line-strong" />
            <input type="hidden" name="accent_color" value={accent} />
          </div>
          <span className="flex items-center gap-3 font-normal">
            <span className="inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>
              Book appointment
            </span>
            <span className={readable ? "text-ink-muted" : "text-danger"} data-testid="accent-check">
              {readable ? `Readable (${contrast("#ffffff", accent).toFixed(1)}:1)` : "Too light for white text. Choose a darker color."}
            </span>
          </span>
          {error("accent_color")}
        </div>
      </fieldset>

      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save rules and look"}
        </Button>
      </div>
    </form>
  );
}

type ServiceRow = { id: string; name: string; category: string; mode: OnlineMode; depositKind: DepositKind; depositAmount: number };

export function ServicesOnlineForm({ services }: { services: ServiceRow[] }) {
  const [state, action, pending] = useActionState(saveServicesOnline, undefined);
  const [kinds, setKinds] = useState(() => Object.fromEntries(services.map((s) => [s.id, s.depositKind])));
  return (
    <form action={action} aria-label="Services online" className="flex flex-col">
      {state && (
        <div className="px-4 pt-4">
          <Result state={state} />
        </div>
      )}
      <ul className="divide-y divide-line">
        {services.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <input type="hidden" name="service" value={s.id} />
            <span className="min-w-48 flex-1">
              <span className="block font-medium text-ink">{s.name}</span>
              <span className="text-sm text-ink-muted">{s.category}</span>
            </span>
            <select name={`mode_${s.id}`} defaultValue={s.mode} aria-label={`${s.name}: online`} className={`${selectClass} w-48!`}>
              {(Object.keys(ONLINE_MODE_LABELS) as OnlineMode[]).map((m) => (
                <option key={m} value={m}>
                  {ONLINE_MODE_LABELS[m]}
                </option>
              ))}
            </select>
            <select
              name={`deposit_kind_${s.id}`}
              value={kinds[s.id]}
              onChange={(e) => setKinds((k) => ({ ...k, [s.id]: e.target.value as DepositKind }))}
              aria-label={`${s.name}: deposit`}
              className={`${selectClass} w-36!`}
            >
              <option value="none">No deposit</option>
              <option value="fixed">Fixed ($)</option>
              <option value="percent">Percent (%)</option>
            </select>
            <input
              name={`deposit_${s.id}`}
              defaultValue={s.depositKind === "fixed" ? String(s.depositAmount / 100) : s.depositKind === "percent" ? String(s.depositAmount) : ""}
              disabled={kinds[s.id] === "none"}
              inputMode="decimal"
              aria-label={`${s.name}: deposit amount`}
              placeholder={kinds[s.id] === "percent" ? "25" : kinds[s.id] === "fixed" ? "50" : ""}
              className={`${fieldClass} w-24!`}
            />
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-4 py-4">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save services"}
        </Button>
      </div>
    </form>
  );
}

// Booking links for Google, Instagram, Facebook and the salon's website:
// each tagged, so Reports show where online bookings came from, with the
// steps to add it there.
export function ShareLinks({ links }: { links: ShareLink[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (source: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(source);
    } catch {
      setCopied(null);
    }
  };
  return (
    <ul className="flex flex-col gap-5" aria-label="Booking links">
      {links.map((l) => (
        <li key={l.source} className="flex flex-col gap-2" data-testid="share-link" data-source={l.source}>
          <span id={`share-${l.source}`} className="font-medium">
            {l.label}
          </span>
          <div className="flex flex-wrap gap-2">
            <input readOnly value={l.url} aria-labelledby={`share-${l.source}`} className={`${fieldClass} min-w-64 flex-1 font-mono text-sm`} onFocus={(e) => e.currentTarget.select()} />
            <Button onClick={() => copy(l.source, l.url)}>{copied === l.source ? "Copied" : "Copy link"}</Button>
          </div>
          <details>
            <summary className="w-fit cursor-pointer text-13 font-medium text-ink-muted hover:text-ink">How to add it</summary>
            <ol className="mt-2 ml-5 flex list-decimal flex-col gap-1 text-sm text-ink-muted">
              {l.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </details>
        </li>
      ))}
    </ul>
  );
}
