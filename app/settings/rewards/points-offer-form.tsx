"use client";

// A points offer (owners): a multiplier for a date range, or a one-off
// bonus for buying gift cards. Off until the box is ticked.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import type { PointsOffer } from "@/lib/rewards";
import { savePointsOffer, type PointsOfferInput, type Result } from "./actions";

const MULTIPLIERS = ["1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5"];

const dollars = (cents: number | null) => (cents ? String(cents / 100) : "");

function inputOf(o: PointsOffer | null): PointsOfferInput {
  return {
    name: o?.name ?? "",
    kind: o?.kind ?? "multiplier",
    enabled: o?.enabled ?? false,
    startsOn: o?.startsOn ?? "",
    endsOn: o?.endsOn ?? "",
    multiplier: o?.multiplier ? String(o.multiplier) : "2",
    services: o?.services ?? true,
    retail: o?.retail ?? true,
    minSpend: dollars(o?.minSpendCents ?? null),
    bonusPoints: o?.bonusPoints ? String(o.bonusPoints) : "",
    minGiftCard: dollars(o?.minGiftCardCents ?? null),
  };
}

export function PointsOfferForm({ offer }: { offer: PointsOffer | null }) {
  const [v, setV] = useState(() => inputOf(offer));
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<PointsOfferInput>) => setV((x) => ({ ...x, ...patch }));
  return (
    <form
      className="flex flex-col gap-4"
      aria-label={offer ? `Edit ${offer.name}` : "New points offer"}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await savePointsOffer(offer?.id ?? null, v);
          setResult(r);
          if (r.ok && !offer) setV(inputOf(null));
        });
      }}
    >
      <Segmented
        label="Kind of offer"
        value={v.kind}
        onChange={(kind) => set({ kind })}
        options={[
          { value: "multiplier", label: "Multiply points" },
          { value: "gift_card_bonus", label: "Gift card bonus" },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Name
          <input value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} className={fieldClass} placeholder={v.kind === "multiplier" ? "Double points week" : "Holiday gift card bonus"} />
        </label>
        <label className={labelClass}>
          Starts
          <input type="date" value={v.startsOn} onChange={(e) => set({ startsOn: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Ends
          <input type="date" value={v.endsOn} onChange={(e) => set({ endsOn: e.target.value })} className={fieldClass} />
        </label>
      </div>
      {v.kind === "multiplier" ? (
        <div className="flex flex-wrap items-end gap-4">
          <label className={labelClass}>
            Points multiplied by
            <select value={v.multiplier} onChange={(e) => set({ multiplier: e.target.value })} className={`${selectClass} w-28!`}>
              {MULTIPLIERS.map((m) => (
                <option key={m} value={m}>
                  {m}x
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Minimum spend ($, blank: none)
            <input value={v.minSpend} onChange={(e) => set({ minSpend: e.target.value })} inputMode="decimal" className={`${fieldClass} w-40!`} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" className={checkboxClass} checked={v.services} onChange={(e) => set({ services: e.target.checked })} />
            Services
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" className={checkboxClass} checked={v.retail} onChange={(e) => set({ retail: e.target.checked })} />
            Retail
          </label>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <label className={labelClass}>
            Bonus points
            <input value={v.bonusPoints} onChange={(e) => set({ bonusPoints: e.target.value })} inputMode="numeric" className={`${fieldClass} w-32!`} />
          </label>
          <label className={labelClass}>
            Gift cards bought on the sale, at least ($)
            <input value={v.minGiftCard} onChange={(e) => set({ minGiftCard: e.target.value })} inputMode="decimal" className={`${fieldClass} w-40!`} />
          </label>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className={checkboxClass} checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Offer is on
      </label>
      {result && !result.ok && <Alert>{result.message}</Alert>}
      {result?.ok && (
        <p role="status" className="text-sm text-ink-muted">
          {result.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {offer ? "Save offer" : "Add offer"}
        </Button>
      </div>
    </form>
  );
}
