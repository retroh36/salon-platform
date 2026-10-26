"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import type { ProductUnit } from "@/lib/inventory";
import {
  adjustProduct,
  saveStockSettings,
  type StockResult,
} from "../actions";

function Result({ result }: { result: StockResult | null }) {
  if (!result) return null;
  return (
    <span
      role={result.ok ? "status" : "alert"}
      className={`animate-fade-in text-sm ${result.ok ? "text-ink-muted" : "text-danger"}`}
    >
      {result.message}
    </span>
  );
}

// A manual correction with a reason.
export function AdjustForm({
  productId,
  unit,
}: {
  productId: string;
  unit: ProductUnit;
}) {
  const [direction, setDirection] = useState<"add" | "remove">("remove");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<StockResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Adjust stock"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await adjustProduct(productId, amount, direction, note);
          setResult(r);
          if (r.ok) {
            setAmount("");
            setNote("");
          }
        });
      }}
    >
      <div className="self-start">
        <Segmented
          label="Add or remove"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "remove", label: "Remove" },
            { value: "add", label: "Add" },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          Amount ({unit === "unit" ? "units" : unit})
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${fieldClass} w-28`}
          />
        </label>
        <label className={`${labelClass} min-w-56 flex-1`}>
          Why
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="e.g. Dropped a tube"
            className={fieldClass}
          />
        </label>
        <Button type="submit" disabled={pending}>
          Adjust
        </Button>
      </div>
      <Result result={result} />
    </form>
  );
}

export function SettingsForm({
  productId,
  unit,
  reorderPoint,
  reorderQuantity,
  containerWord,
}: {
  productId: string;
  unit: ProductUnit;
  reorderPoint: number;
  reorderQuantity: number;
  containerWord: string;
}) {
  const [point, setPoint] = useState(String(reorderPoint));
  const [quantity, setQuantity] = useState(String(reorderQuantity));
  const [result, setResult] = useState<StockResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Reorder settings"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () =>
          setResult(await saveStockSettings(productId, point, quantity)),
        );
      }}
    >
      <label className={labelClass}>
        Reorder below ({unit === "unit" ? "units" : unit})
        <input
          inputMode="decimal"
          value={point}
          onChange={(e) => setPoint(e.target.value)}
          className={`${fieldClass} w-32`}
        />
      </label>
      <label className={labelClass}>
        Order ({containerWord}s at a time)
        <input
          type="number"
          min={1}
          max={1000}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className={`${fieldClass} w-32`}
        />
      </label>
      <Button type="submit" disabled={pending}>
        Save
      </Button>
      <Result result={result} />
    </form>
  );
}
