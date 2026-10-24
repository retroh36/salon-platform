"use client";

import { useRef, useState, useTransition } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { Alert } from "@/components/ui/page";
import type { IntervalUnit, PlanForm as Form } from "@/lib/memberships";
import type { MembershipPlan } from "@/lib/memberships-load";
import { centsToInput } from "@/lib/services";
import { runRenewals, savePlan, type SaveResult } from "./actions";

type Row = Form["services"][number] & { key: number };

function initial(plan: MembershipPlan | null): Omit<Form, "services"> & { services: Row[] } {
  return {
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    price: plan ? centsToInput(plan.priceCents) : "",
    intervalUnit: plan?.intervalUnit ?? "month",
    intervalCount: String(plan?.intervalCount ?? 1),
    serviceDiscountPct: plan?.serviceDiscountPct ? String(plan.serviceDiscountPct) : "",
    retailDiscountPct: plan?.retailDiscountPct ? String(plan.retailDiscountPct) : "",
    minTermPeriods: plan?.minTermPeriods ? String(plan.minTermPeriods) : "",
    cancelNoticeDays: plan?.cancelNoticeDays ? String(plan.cancelNoticeDays) : "",
    allowPause: plan?.allowPause ?? true,
    maxPausePeriods: String(plan?.maxPausePeriods ?? 2),
    isActive: plan?.isActive ?? true,
    services: plan ? plan.services.map((s, n) => ({ key: -1 - n, serviceId: s.serviceId, quantity: String(s.quantity), rollover: s.rollover })) : [{ key: 0, serviceId: "", quantity: "2", rollover: false }],
  };
}

// Creating or editing a membership: price and how often, what's included
// each period (rolling over or not), member prices, and the rules for
// pausing and ending.
export function PlanForm({ plan, services }: { plan: MembershipPlan | null; services: { id: string; name: string }[] }) {
  const nextKey = useRef(1);
  const [f, setF] = useState(() => initial(plan));
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const setRow = (key: number, patch: Partial<Row>) => set({ services: f.services.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  return (
    <form
      aria-label={plan ? `Edit ${plan.name}` : "New membership"}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await savePlan(plan?.id ?? null, { ...f, services: f.services.map(({ serviceId, quantity, rollover }) => ({ serviceId, quantity, rollover })) });
          setResult(r);
          if (r.ok && !plan) setF(initial(null));
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
        <label className={labelClass}>
          Name
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} className={fieldClass} placeholder="e.g. Blowout Club" maxLength={80} required />
        </label>
        <label className={labelClass}>
          Price ($)
          <input inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value })} className={fieldClass} required />
        </label>
        <label className={labelClass}>
          Every
          <input type="number" min={1} max={12} value={f.intervalCount} onChange={(e) => set({ intervalCount: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Billed by
          <select value={f.intervalUnit} onChange={(e) => set({ intervalUnit: e.target.value as IntervalUnit })} className={selectClass}>
            <option value="month">Month</option>
            <option value="week">Week</option>
          </select>
        </label>
      </div>
      <label className={labelClass}>
        Description (optional)
        <input value={f.description} onChange={(e) => set({ description: e.target.value })} className={fieldClass} maxLength={300} />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Included each period</legend>
        {f.services.map((r, n) => (
          <div key={r.key} className="flex flex-wrap items-end gap-2">
            <select aria-label={`Included service ${n + 1}`} value={r.serviceId} onChange={(e) => setRow(r.key, { serviceId: e.target.value })} className={`${selectClass} min-w-48 flex-1`}>
              <option value="">Choose a service</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input aria-label={`How many of included service ${n + 1}`} type="number" min={1} max={20} value={r.quantity} onChange={(e) => setRow(r.key, { quantity: e.target.value })} className={`${fieldClass} w-20!`} />
            <label className="flex h-10 items-center gap-1.5 text-sm">
              <input type="checkbox" className={checkboxClass} checked={r.rollover} onChange={(e) => setRow(r.key, { rollover: e.target.checked })} />
              Unused roll over
            </label>
            <IconButton label={`Remove included service ${n + 1}`} size="sm" onClick={() => set({ services: f.services.filter((x) => x.key !== r.key) })}>
              <CloseIcon className="size-4" />
            </IconButton>
          </div>
        ))}
        <Button size="sm" className="self-start" onClick={() => set({ services: [...f.services, { key: nextKey.current++, serviceId: "", quantity: "1", rollover: false }] })}>
          <PlusIcon className="size-4" />
          Add a service
        </Button>
        <p className="text-xs text-ink-muted">Rolled-over services carry into the next period only (one period&apos;s worth at most).</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Member discount on services (%)
          <input inputMode="numeric" value={f.serviceDiscountPct} onChange={(e) => set({ serviceDiscountPct: e.target.value })} className={fieldClass} placeholder="0" />
        </label>
        <label className={labelClass}>
          Member discount on retail (%)
          <input inputMode="numeric" value={f.retailDiscountPct} onChange={(e) => set({ retailDiscountPct: e.target.value })} className={fieldClass} placeholder="0" />
        </label>
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">Ending and pausing</legend>
        <label className={labelClass}>
          Minimum term (periods)
          <input inputMode="numeric" value={f.minTermPeriods} onChange={(e) => set({ minTermPeriods: e.target.value })} className={fieldClass} placeholder="None" />
        </label>
        <label className={labelClass}>
          Notice to end (days)
          <input inputMode="numeric" value={f.cancelNoticeDays} onChange={(e) => set({ cancelNoticeDays: e.target.value })} className={fieldClass} placeholder="None" />
        </label>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className={checkboxClass} checked={f.allowPause} onChange={(e) => set({ allowPause: e.target.checked })} />
            Can be paused
          </label>
          {f.allowPause && (
            <label className={labelClass}>
              For up to (periods)
              <input type="number" min={1} max={6} value={f.maxPausePeriods} onChange={(e) => set({ maxPausePeriods: e.target.value })} className={fieldClass} />
            </label>
          )}
        </div>
        <p className="text-xs text-ink-muted sm:col-span-3">A membership always ends at the end of a period it&apos;s paid for, once the minimum term and notice are met.</p>
      </fieldset>
      {plan && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={checkboxClass} checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          On sale (current members keep it either way)
        </label>
      )}
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {plan ? "Save membership" : "Add membership"}
      </Button>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}

// Renewals and retries due now (the nightly job runs them too).
export function RunRenewals() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runRenewals();
            setMessage(
              r.ok
                ? r.summary.checked
                  ? `${r.summary.renewed} renewed, ${r.summary.failed} failed, ${r.summary.paused} paused, ${r.summary.resumed} resumed, ${r.summary.canceled} ended.`
                  : "Nothing is due right now."
                : r.message,
            );
          })
        }
      >
        {pending ? "Running…" : "Run renewals now"}
      </Button>
      {message && (
        <p role="status" className="text-sm text-ink-muted">
          {message}
        </p>
      )}
    </div>
  );
}
