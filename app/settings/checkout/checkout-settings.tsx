"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import type { StaffRole } from "@/lib/staff";
import { saveCheckoutSettings, type CheckoutSettingsInput, type SettingsResult } from "./actions";

export function CheckoutSettingsForm({ initial }: { initial: CheckoutSettingsInput }) {
  const [s, setS] = useState(initial);
  const [result, setResult] = useState<SettingsResult | null>(null);
  const [pending, start] = useTransition();
  const toggleRole = (role: StaffRole, on: boolean) => setS({ ...s, discountRoles: on ? [...s.discountRoles, role] : s.discountRoles.filter((r) => r !== role) });
  return (
    <form
      aria-label="Tax and receipts"
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveCheckoutSettings(s)));
      }}
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-serif text-lg font-semibold">Sales tax</legend>
        <p className="text-sm text-ink-muted">Added on top of prices at checkout. Rules differ by state and city; check what applies to you. Gift cards aren&apos;t taxed.</p>
        <div className="grid max-w-md grid-cols-2 gap-3">
          <label className={labelClass}>
            Services (%)
            <input inputMode="decimal" value={s.taxServicesPercent} onChange={(e) => setS({ ...s, taxServicesPercent: e.target.value })} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Retail products (%)
            <input inputMode="decimal" value={s.taxRetailPercent} onChange={(e) => setS({ ...s, taxRetailPercent: e.target.value })} className={fieldClass} />
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-serif text-lg font-semibold">Discounts</legend>
        <p className="text-sm text-ink-muted">Owners can always give discounts. Every discount needs a reason.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={checkboxClass} checked={s.discountRoles.includes("manager")} onChange={(e) => toggleRole("manager", e.target.checked)} />
          Managers can give discounts
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={checkboxClass} checked={s.discountRoles.includes("front_desk")} onChange={(e) => toggleRole("front_desk", e.target.checked)} />
          The front desk can give discounts
        </label>
        <label className={`${labelClass} max-w-xs`}>
          Most the front desk can take off (%)
          <input inputMode="numeric" value={s.discountMaxPercent} onChange={(e) => setS({ ...s, discountMaxPercent: e.target.value })} className={fieldClass} />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-serif text-lg font-semibold">Receipts</legend>
        <label className={labelClass}>
          A note at the bottom (optional)
          <textarea rows={2} maxLength={500} value={s.receiptFooter} onChange={(e) => setS({ ...s, receiptFooter: e.target.value })} className={fieldClass} placeholder="e.g. Thank you! Book online at …" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={checkboxClass} checked={s.receiptShowStylists} onChange={(e) => setS({ ...s, receiptShowStylists: e.target.checked })} />
          Show who did each service
        </label>
      </fieldset>

      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        Save
      </Button>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
