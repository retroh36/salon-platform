"use client";

// Setting up a promotion (owners and managers): how it's used (a code, by
// itself at checkout, or a last-minute special), the discount, what it
// covers and what it never does, dates, limits, who it's for and whether
// it can be used with other discounts. A line underneath says it back.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { parsePromotionInput, promotionSummary, ruleOf, type Level, type PromoKind, type PromotionInput } from "@/lib/promotions";
import { savePromotion } from "./actions";

export type FormOptions = {
  services: { id: string; name: string; category: string }[];
  staff: { id: string; name: string }[];
  products: { id: string; name: string }[];
};

const LEVELS: { value: Level; label: string }[] = [
  { value: "artisan", label: "Artisan" },
  { value: "senior", label: "Senior" },
  { value: "master", label: "Master" },
];

const KIND_HELP: Record<PromoKind, string> = {
  code: "The client gives a code, at the desk or when booking online.",
  automatic: "Offered by itself at checkout whenever its rules are met.",
  last_minute: "Open time starting soon: a badge on those times on your booking site, and taken off at checkout.",
};

export function PromotionForm({ id, initial, options }: { id: string | null; initial: PromotionInput; options: FormOptions }) {
  const router = useRouter();
  const [p, setP] = useState<PromotionInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<PromotionInput>) => setP((x) => ({ ...x, ...patch }));
  const toggle = <K extends "serviceIds" | "categories" | "staffIds" | "levels" | "productIds">(key: K, value: PromotionInput[K][number]) =>
    setP((x) => {
      const list = x[key] as string[];
      return { ...x, [key]: list.includes(value as string) ? list.filter((v) => v !== value) : [...list, value] };
    });
  const categories = [...new Set(options.services.map((s) => s.category))];
  const parsed = parsePromotionInput(p);
  const summary = parsed.ok
    ? promotionSummary(ruleOf({ id: "preview", ...parsed.row } as never), {
        services: Object.fromEntries(options.services.map((s) => [s.id, s.name])),
        staff: Object.fromEntries(options.staff.map((s) => [s.id, s.name])),
      })
    : null;

  return (
    <form
      className="flex max-w-3xl flex-col gap-6"
      aria-label="Promotion"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await savePromotion(id, p);
          if (!r.ok) return setError(r.message);
          router.push("/promotions");
        });
      }}
    >
      <label className={labelClass}>
        Name
        <input value={p.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} className={fieldClass} placeholder="Welcome 15" />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">How it&rsquo;s used</span>
        <Segmented
          label="How it's used"
          value={p.kind}
          onChange={(kind) => set({ kind, ...(kind === "last_minute" ? { services: true, retail: false, online: true } : {}) })}
          options={[
            { value: "code", label: "Promo code" },
            { value: "automatic", label: "Automatic" },
            { value: "last_minute", label: "Last-minute special" },
          ]}
        />
        <p className="text-sm text-ink-muted">{KIND_HELP[p.kind]}</p>
      </div>

      {p.kind === "code" && (
        <label className={`${labelClass} max-w-xs`}>
          Code
          <input value={p.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} maxLength={24} className={`${fieldClass} uppercase`} placeholder="WELCOME15" autoCapitalize="characters" />
        </label>
      )}
      {p.kind === "last_minute" && (
        <label className={`${labelClass} max-w-xs`}>
          For open time starting within (hours)
          <input value={p.hoursAhead} onChange={(e) => set({ hoursAhead: e.target.value })} inputMode="numeric" className={fieldClass} />
        </label>
      )}

      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="mb-1.5 text-sm font-medium text-ink">Discount</legend>
        <select aria-label="Discount type" value={p.discountKind} onChange={(e) => set({ discountKind: e.target.value as "percent" | "amount" })} className={`${selectClass} w-40`}>
          <option value="percent">Percent off</option>
          <option value="amount">Amount off</option>
        </select>
        <input aria-label={p.discountKind === "percent" ? "Percent off" : "Amount off ($)"} value={p.value} onChange={(e) => set({ value: e.target.value })} inputMode="decimal" className={`${fieldClass} w-28`} placeholder={p.discountKind === "percent" ? "15" : "10.00"} />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1.5 text-sm font-medium text-ink">What it covers</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className={checkboxClass} checked={p.services} disabled={p.kind === "last_minute"} onChange={(e) => set({ services: e.target.checked })} />
            Services
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className={checkboxClass} checked={p.retail} disabled={p.kind === "last_minute"} onChange={(e) => set({ retail: e.target.checked })} />
            Retail
          </label>
        </div>
        {p.services && (
          <>
            <CheckGroup label="Only these categories (none ticked: all)" items={categories.map((c) => ({ value: c, label: c }))} selected={p.categories} onToggle={(v) => toggle("categories", v)} />
            <label className={labelClass}>
              Only these services (none chosen: all)
              <select multiple value={p.serviceIds} onChange={(e) => set({ serviceIds: [...e.target.selectedOptions].map((o) => o.value) })} className={`${fieldClass} h-32! py-1`}>
                {options.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <CheckGroup label="Only with these stylists (none ticked: anyone)" items={options.staff.map((s) => ({ value: s.id, label: s.name }))} selected={p.staffIds} onToggle={(v) => toggle("staffIds", v)} />
            <CheckGroup label="Only these levels (none ticked: any)" items={LEVELS} selected={p.levels} onToggle={(v) => toggle("levels", v as Level)} />
            <Exclusions value={p.exclusions} categories={categories} onChange={(exclusions) => set({ exclusions })} />
          </>
        )}
        {p.retail && (
          <label className={labelClass}>
            Only these products (none chosen: all retail)
            <select multiple value={p.productIds} onChange={(e) => set({ productIds: [...e.target.selectedOptions].map((o) => o.value) })} className={`${fieldClass} h-32! py-1`}>
              {options.products.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1.5 text-sm font-medium text-ink">When and how often</legend>
        <label className={labelClass}>
          Starts
          <input type="date" value={p.startsOn} onChange={(e) => set({ startsOn: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Ends
          <input type="date" value={p.endsOn} onChange={(e) => set({ endsOn: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Uses in all (blank: no limit)
          <input value={p.maxUses} onChange={(e) => set({ maxUses: e.target.value })} inputMode="numeric" className={fieldClass} />
        </label>
        <label className={labelClass}>
          Uses per client (blank: no limit)
          <input value={p.maxPerClient} onChange={(e) => set({ maxPerClient: e.target.value })} inputMode="numeric" className={fieldClass} />
        </label>
        <label className={labelClass}>
          Minimum spend ($, blank: none)
          <input value={p.minSpend} onChange={(e) => set({ minSpend: e.target.value })} inputMode="decimal" className={fieldClass} />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-ink">Who and with what</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={checkboxClass} checked={p.newClientsOnly} onChange={(e) => set({ newClientsOnly: e.target.checked })} />
          New clients only (added on or after the start date)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={checkboxClass} checked={p.firstVisitOnly} onChange={(e) => set({ firstVisitOnly: e.target.checked })} />
          A client&rsquo;s first visit only
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={checkboxClass} checked={p.stackable} onChange={(e) => set({ stackable: e.target.checked })} />
          Can be used with other promotions and discounts
        </label>
        {p.kind === "code" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className={checkboxClass} checked={p.online} onChange={(e) => set({ online: e.target.checked })} />
            Can be used on the booking site
          </label>
        )}
      </fieldset>

      {summary && (
        <p className="rounded-lg bg-sunken px-4 py-3 text-sm text-ink" data-testid="promotion-summary">
          {summary}
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {id ? "Save changes" : "Create promotion"}
        </Button>
        <Button onClick={() => router.push("/promotions")}>Cancel</Button>
      </div>
    </form>
  );
}

function CheckGroup({ label, items, selected, onToggle }: { label: string; items: { value: string; label: string }[]; selected: readonly string[]; onToggle: (v: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm text-ink-muted">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {items.map((i) => (
          <label key={i.value} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className={checkboxClass} checked={selected.includes(i.value)} onChange={() => onToggle(i.value)} />
            {i.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// "Never": a level, a category, or a level's work in a category (never
// Master color).
function Exclusions({ value, categories, onChange }: { value: PromotionInput["exclusions"]; categories: string[]; onChange: (v: PromotionInput["exclusions"]) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm text-ink-muted">Never (for example, never Master stylists&rsquo; color)</legend>
      {value.map((e, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2" data-testid="exclusion">
          <select aria-label="Never this level" value={e.level ?? ""} onChange={(x) => onChange(value.map((v, j) => (j === i ? { ...v, level: (x.target.value || null) as Level | null } : v)))} className={`${selectClass} w-40`}>
            <option value="">Any level</option>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <select aria-label="Never this category" value={e.category ?? ""} onChange={(x) => onChange(value.map((v, j) => (j === i ? { ...v, category: x.target.value || null } : v)))} className={`${selectClass} w-48`}>
            <option value="">Any category</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <Button size="sm" className="self-start" onClick={() => onChange([...value, { level: null, category: null }])}>
        Add a &ldquo;never&rdquo;
      </Button>
    </fieldset>
  );
}
