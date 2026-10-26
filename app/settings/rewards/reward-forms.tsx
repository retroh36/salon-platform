"use client";

import { useRef, useState, useTransition } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { Alert } from "@/components/ui/page";
import type { Program, Reward, Tier } from "@/lib/rewards";
import { centsToInput } from "@/lib/services";
import { saveProgram, saveReward, saveTiers, type ProgramInput, type Result, type RewardInput, type TierInput } from "./actions";

type Service = { id: string; name: string };

const Check = ({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) => (
  <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" className={checkboxClass} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {children}
  </label>
);

// How clients earn: points per dollar, bonuses, expiry and the rules for
// taking rewards.
export function ProgramForm({ program }: { program: Program }) {
  const [f, setF] = useState<ProgramInput>({
    enabled: program.enabled,
    servicePoints: String(program.servicePoints),
    retailPoints: String(program.retailPoints),
    earnOnPackages: program.earnOnPackages,
    earnOnMemberships: program.earnOnMemberships,
    birthdayPoints: String(program.birthdayPoints),
    referralPoints: String(program.referralPoints),
    rebookPoints: String(program.rebookPoints),
    firstVisitPoints: String(program.firstVisitPoints),
    expiryMonths: program.expiryMonths ? String(program.expiryMonths) : "",
    minRedeemPoints: String(program.minRedeemPoints),
    stackWithPromotions: program.stackWithPromotions,
    tierBasis: program.tierBasis,
  });
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const number = (key: keyof ProgramInput, label: string, hint?: string) => (
    <label className={labelClass}>
      {label}
      <input inputMode="numeric" value={f[key] as string} onChange={(e) => setF({ ...f, [key]: e.target.value })} className={fieldClass} placeholder={hint} />
    </label>
  );
  return (
    <form
      aria-label="Rewards program"
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveProgram(f)));
      }}
    >
      <Check checked={f.enabled} onChange={(enabled) => setF({ ...f, enabled })}>
        Clients earn points
      </Check>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Points for every dollar paid</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {number("servicePoints", "On services")}
          {number("retailPoints", "On retail")}
        </div>
        <p className="text-13 text-ink-muted">After discounts, before tax. Never on tips, tax or gift cards.</p>
        <Check checked={f.earnOnPackages} onChange={(earnOnPackages) => setF({ ...f, earnOnPackages })}>
          Also on packages, and services paid with one
        </Check>
        <Check checked={f.earnOnMemberships} onChange={(earnOnMemberships) => setF({ ...f, earnOnMemberships })}>
          Also on memberships, and services they include
        </Check>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Bonus points (0 for none)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {number("firstVisitPoints", "First visit")}
          {number("rebookPoints", "Books their next visit before leaving")}
          {number("birthdayPoints", "Birthday")}
          {number("referralPoints", "Referral (each client)")}
        </div>
        <p className="text-13 text-ink-muted">A referral pays both clients once the new client&apos;s first visit is checked out.</p>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Taking rewards</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {number("minRedeemPoints", "Points needed before any reward")}
          {number("expiryMonths", "Points expire after this many months without earning", "Never")}
        </div>
        <Check checked={f.stackWithPromotions} onChange={(stackWithPromotions) => setF({ ...f, stackWithPromotions })}>
          Rewards can be used with a promotion on the same sale
        </Check>
      </fieldset>
      <label className={`${labelClass} max-w-sm`}>
        Tiers count
        <select value={f.tierBasis} onChange={(e) => setF({ ...f, tierBasis: e.target.value === "visits" ? "visits" : "spend" })} className={selectClass}>
          <option value="spend">Dollars spent in the last 12 months</option>
          <option value="visits">Visits in the last 12 months</option>
        </select>
      </label>
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        Save program
      </Button>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}

// Tiers: the whole list at once, lowest first.
export function TiersForm({ tiers, basis, services }: { tiers: Tier[]; basis: "spend" | "visits"; services: Service[] }) {
  const nextKey = useRef(1);
  const [rows, setRows] = useState<(TierInput & { key: number })[]>(() =>
    tiers.map((t, n) => ({
      key: -1 - n,
      id: t.id,
      name: t.name,
      threshold: basis === "spend" ? centsToInput(t.threshold) : String(t.threshold),
      bonusPct: String(t.bonusPct),
      freeAddonServiceId: t.freeAddonServiceId ?? "",
      priorityBooking: t.priorityBooking,
    })),
  );
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const set = (key: number, patch: Partial<TierInput>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <form
      aria-label="Tiers"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveTiers(rows, basis)));
      }}
    >
      {rows.length === 0 && <p className="text-sm text-ink-muted">No tiers: everyone earns at the same rate.</p>}
      {rows.map((r, n) => (
        <fieldset key={r.key} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <legend className="sr-only">Tier {n + 1}</legend>
          <label className={labelClass}>
            Name
            <input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} className={fieldClass} placeholder="e.g. Gold" maxLength={40} />
          </label>
          <label className={labelClass}>
            {basis === "spend" ? "From ($ in 12 months)" : "From (visits in 12 months)"}
            <input inputMode="decimal" value={r.threshold} onChange={(e) => set(r.key, { threshold: e.target.value })} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Bonus points (%)
            <input inputMode="numeric" value={r.bonusPct} onChange={(e) => set(r.key, { bonusPct: e.target.value })} className={fieldClass} />
          </label>
          <IconButton label={`Remove tier ${n + 1}`} size="sm" className="self-end" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
            <CloseIcon className="size-4" />
          </IconButton>
          <label className={`${labelClass} sm:col-span-2`}>
            Free add-on once a visit
            <select value={r.freeAddonServiceId} onChange={(e) => set(r.key, { freeAddonServiceId: e.target.value })} className={selectClass}>
              <option value="">None</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="self-end pb-2 sm:col-span-2">
            <Check checked={r.priorityBooking} onChange={(priorityBooking) => set(r.key, { priorityBooking })}>
              First on the waitlist
            </Check>
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        {rows.length < 6 && (
          <Button size="sm" onClick={() => setRows([...rows, { key: nextKey.current++, id: null, name: "", threshold: "", bonusPct: "0", freeAddonServiceId: "", priorityBooking: false }])}>
            <PlusIcon className="size-4" />
            Add a tier
          </Button>
        )}
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          Save tiers
        </Button>
      </div>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}

const EMPTY: RewardInput = { id: null, name: "", points: "", kind: "amount", amount: "", percent: "", appliesTo: "both", serviceId: "", maxPerYear: "", minTierId: "", isActive: true };

// One reward in the catalog.
export function RewardForm({ reward, services, tiers, active = true }: { reward: Reward | null; services: Service[]; tiers: Tier[]; active?: boolean }) {
  const [f, setF] = useState<RewardInput>(() =>
    reward
      ? {
          id: reward.id,
          name: reward.name,
          points: String(reward.points),
          kind: reward.kind,
          amount: reward.amountCents ? centsToInput(reward.amountCents) : "",
          percent: reward.pct ? String(reward.pct) : "",
          appliesTo: reward.services && reward.retail ? "both" : reward.services ? "services" : "retail",
          serviceId: reward.serviceIds?.[0] ?? "",
          maxPerYear: reward.maxPerYear ? String(reward.maxPerYear) : "",
          minTierId: reward.minTierId ?? "",
          isActive: active,
        }
      : EMPTY,
  );
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label={reward ? `Edit ${reward.name}` : "New reward"}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveReward(f);
          setResult(r);
          if (r.ok && !reward) setF(EMPTY);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={`${labelClass} sm:col-span-2`}>
          Name
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={fieldClass} placeholder="e.g. $25 off" maxLength={60} required />
        </label>
        <label className={labelClass}>
          Points
          <input inputMode="numeric" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} className={fieldClass} required />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          What it gives
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as RewardInput["kind"] })} className={selectClass}>
            <option value="amount">An amount off</option>
            <option value="percent">A percent off</option>
            <option value="free_service">A free service</option>
          </select>
        </label>
        {f.kind === "amount" && (
          <label className={labelClass}>
            Amount off ($)
            <input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={fieldClass} />
          </label>
        )}
        {f.kind === "percent" && (
          <label className={labelClass}>
            Percent off
            <input inputMode="numeric" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} className={fieldClass} />
          </label>
        )}
        {f.kind !== "free_service" && (
          <label className={labelClass}>
            On
            <select value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value as RewardInput["appliesTo"] })} className={selectClass}>
              <option value="both">Services and retail</option>
              <option value="services">Services only</option>
              <option value="retail">Retail only</option>
            </select>
          </label>
        )}
        {(f.kind === "free_service" || f.appliesTo === "services") && (
          <label className={labelClass}>
            {f.kind === "free_service" ? "Service" : "Only this service"}
            <select value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })} className={selectClass}>
              <option value="">{f.kind === "free_service" ? "Choose a service" : "Any service"}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Times a year
          <input inputMode="numeric" value={f.maxPerYear} onChange={(e) => setF({ ...f, maxPerYear: e.target.value })} className={fieldClass} placeholder="No limit" />
        </label>
        {tiers.length > 0 && (
          <label className={labelClass}>
            For
            <select value={f.minTierId} onChange={(e) => setF({ ...f, minTierId: e.target.value })} className={selectClass}>
              <option value="">Every client</option>
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} and up
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {reward && (
        <Check checked={f.isActive} onChange={(isActive) => setF({ ...f, isActive })}>
          In the catalog
        </Check>
      )}
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {reward ? "Save reward" : "Add reward"}
      </Button>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
