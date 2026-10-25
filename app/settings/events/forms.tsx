"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { PARTY_ROLE_LABELS, PARTY_ROLES, type EventPackage, type EventSettings } from "@/lib/events/types";
import { minuteToTime } from "@/lib/scheduling/time";
import { centsToInput } from "@/lib/services";
import { saveEventPackage, saveEventSettings, type EventPackageInput, type EventSettingsInput, type Result } from "./actions";

// One event package: who it's usually for, how long the hair and makeup
// take (which says who can do it), its price, and whether it's a trial.
export function EventPackageForm({ pkg }: { pkg: EventPackage | null }) {
  const blank: EventPackageInput = { id: null, name: "", partyRole: "", hairMinutes: "", makeupMinutes: "", price: "", isTrial: false, isActive: true };
  const [f, setF] = useState<EventPackageInput>(
    pkg
      ? { id: pkg.id, name: pkg.name, partyRole: pkg.partyRole ?? "", hairMinutes: String(pkg.hairMinutes), makeupMinutes: String(pkg.makeupMinutes), price: centsToInput(pkg.priceCents), isTrial: pkg.isTrial, isActive: pkg.isActive }
      : blank,
  );
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label={pkg ? `Edit ${pkg.name}` : "New event package"}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveEventPackage(f);
          setResult(r);
          if (r.ok && !pkg) setF(blank);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-6">
        <label className={`${labelClass} sm:col-span-3`}>
          Name
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={fieldClass} placeholder="e.g. Bridesmaid hair + makeup" maxLength={120} required />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Usually for
          <select value={f.partyRole} onChange={(e) => setF({ ...f, partyRole: e.target.value })} className={selectClass}>
            <option value="">Anyone</option>
            {PARTY_ROLES.map((r) => (
              <option key={r} value={r}>
                {PARTY_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Price ($)
          <input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} className={fieldClass} required />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Hair (minutes)
          <input type="number" min={0} max={480} step={5} value={f.hairMinutes} onChange={(e) => setF({ ...f, hairMinutes: e.target.value })} className={fieldClass} placeholder="0" />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Makeup (minutes)
          <input type="number" min={0} max={480} step={5} value={f.makeupMinutes} onChange={(e) => setF({ ...f, makeupMinutes: e.target.value })} className={fieldClass} placeholder="0" />
        </label>
      </div>
      <div className="flex flex-wrap gap-5">
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input type="checkbox" className={checkboxClass} checked={f.isTrial} onChange={(e) => setF({ ...f, isTrial: e.target.checked })} />
          A trial (booked as a visit before the day)
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input type="checkbox" className={checkboxClass} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          Offered
        </label>
      </div>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? "Saving…" : pkg ? "Save package" : "Add package"}
      </Button>
    </form>
  );
}

export function EventSettingsForm({ settings, terms, services }: { settings: EventSettings; terms: string; services: { id: string; name: string }[] }) {
  const [f, setF] = useState<EventSettingsInput>({
    depositPct: String(settings.depositPct),
    depositRefundable: settings.depositRefundable,
    serviceChargePct: String(settings.serviceChargePct),
    serviceChargeTeamPct: String(settings.serviceChargeTeamPct),
    travelFee: centsToInput(settings.travelFeeCents),
    travelFreeMiles: String(settings.travelFreeMiles),
    travelPerMile: centsToInput(settings.travelPerMileCents),
    travelTeamPct: String(settings.travelTeamPct),
    travelMinutes: String(settings.travelMinutes),
    earlyStart: minuteToTime(settings.earlyStartMinute),
    earlyStartFee: centsToInput(settings.earlyStartFeeCents),
    headcountCutoffDays: String(settings.headcountCutoffDays),
    secondPaymentPct: String(settings.secondPaymentPct),
    secondPaymentDays: String(settings.secondPaymentDays),
    finalPaymentDays: String(settings.finalPaymentDays),
    bufferMinutes: String(settings.bufferMinutes),
    touchUpMinutes: String(settings.touchUpMinutes),
    trialServiceId: settings.trialServiceId ?? "",
    inquiriesEnabled: settings.inquiriesEnabled,
    terms,
  });
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const num = (key: keyof EventSettingsInput, label: string, props: { step?: number; max?: number } = {}) => (
    <label className={labelClass}>
      {label}
      <input type="number" min={0} step={props.step ?? 1} max={props.max} value={f[key] as string} onChange={(e) => setF({ ...f, [key]: e.target.value })} className={fieldClass} />
    </label>
  );
  const money = (key: keyof EventSettingsInput, label: string) => (
    <label className={labelClass}>
      {label}
      <input inputMode="decimal" value={f[key] as string} onChange={(e) => setF({ ...f, [key]: e.target.value })} className={fieldClass} />
    </label>
  );
  return (
    <form
      aria-label="Bridal settings"
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveEventSettings(f)));
      }}
    >
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Deposit and payments</legend>
        {num("depositPct", "Deposit to book (%)", { max: 100 })}
        {num("secondPaymentPct", "Second payment (%, 0 for none)", { max: 100 })}
        {num("secondPaymentDays", "Second payment due (days before)")}
        {num("finalPaymentDays", "Balance charged (days before)")}
        {num("headcountCutoffDays", "Headcount cutoff (days before)")}
        <label className="flex min-h-11 items-center gap-2 self-end text-sm font-medium">
          <input type="checkbox" className={checkboxClass} checked={f.depositRefundable} onChange={(e) => setF({ ...f, depositRefundable: e.target.checked })} />
          The deposit can be given back
        </label>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Service charge</legend>
        {num("serviceChargePct", "Service charge or gratuity (%)", { max: 50 })}
        {num("serviceChargeTeamPct", "Team's share, paid as tips (%)", { max: 100 })}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">On-location travel</legend>
        {money("travelFee", "Travel fee ($)")}
        {num("travelFreeMiles", "Miles included")}
        {money("travelPerMile", "Then per mile ($)")}
        {num("travelTeamPct", "Team's share, paid as tips (%)", { max: 100 })}
        {num("travelMinutes", "Travel time each way (minutes)", { step: 5 })}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Early starts and the timeline</legend>
        <label className={labelClass}>
          Early start before
          <input type="time" step={300} value={f.earlyStart} onChange={(e) => setF({ ...f, earlyStart: e.target.value })} className={fieldClass} />
        </label>
        {money("earlyStartFee", "Early-start fee per artist ($)")}
        {num("bufferMinutes", "Buffer between people (minutes)", { step: 5, max: 60 })}
        {num("touchUpMinutes", "Touch-ups at the end (minutes)", { step: 5, max: 60 })}
        <label className={labelClass}>
          Trials are booked as
          <select value={f.trialServiceId} onChange={(e) => setF({ ...f, trialServiceId: e.target.value })} className={selectClass}>
            <option value="">Choose a service</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm font-medium">
          <input type="checkbox" className={checkboxClass} checked={f.inquiriesEnabled} onChange={(e) => setF({ ...f, inquiriesEnabled: e.target.checked })} />
          Take event inquiries on the booking site
        </label>
      </fieldset>
      <label className={labelClass}>
        Contract terms
        <span className="font-normal text-ink-muted">
          Clients agree to these when they book. A starter version to edit: have your own lawyer review it. &ldquo;{"{salon}"}&rdquo; becomes your salon&rsquo;s name. Each change is kept as a new version.
        </span>
        <textarea rows={14} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} className={fieldClass} maxLength={20000} />
      </label>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
