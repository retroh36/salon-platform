"use client";

import { useState, useTransition } from "react";
import { UsageLinesEditor, toUsageJson, type DraftLine } from "@/components/usage-lines";
import { Button } from "@/components/ui/button";
import type { PickerProduct } from "@/lib/inventory-load";
import { saveRecipe, type RecipeResult } from "./actions";

// The service's default products, used when there's no formula for a visit.
export function RecipeEditor({ serviceId, products, initial }: { serviceId: string; products: PickerProduct[]; initial: DraftLine[] }) {
  const [lines, setLines] = useState<DraftLine[]>(initial);
  const [result, setResult] = useState<RecipeResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Product recipe"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => setResult(await saveRecipe(serviceId, toUsageJson(lines))));
      }}
    >
      <UsageLinesEditor products={products} lines={lines} onChange={setLines} label="Products and amounts" />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save recipe"}
        </Button>
        {result && (
          <span role={result.ok ? "status" : "alert"} className={`animate-fade-in text-sm ${result.ok ? "font-medium text-status-confirmed-ink" : "text-danger"}`}>
            {result.ok ? "Recipe saved." : result.message}
          </span>
        )}
      </div>
    </form>
  );
}
