"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { UsageLinesEditor, type DraftLine } from "@/components/usage-lines";
import { buttonClass } from "@/components/ui/button";
import { selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import type { PickerProduct } from "@/lib/inventory-load";
import { useCloseRecord } from "./add-record";
import { addFormula } from "./actions";

// A recent service on one of the client's visits.
export type VisitOption = { itemId: string; date: string; label: string };

function linesFrom(json: string | undefined): DraftLine[] {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.map((l) => ({ productId: String(l.productId ?? ""), amount: l.amount ? String(l.amount) : "" })) : [];
  } catch {
    return [];
  }
}

export function FormulaForm({ clientId, today, visits, products }: { clientId: string; today: string; visits: VisitOption[]; products: PickerProduct[] }) {
  const [state, action, pending] = useActionState(addFormula.bind(null, clientId), undefined);
  const failed = state && !state.saved ? state : null;
  const errors = failed?.errors ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  // Opened from "Add formula": closes once saved.
  const close = useCloseRecord();
  const [itemId, setItemId] = useState(failed?.fields.appointment_item_id ?? "");
  const [date, setDate] = useState(failed?.fields.visit_date ?? today);
  const [lines, setLines] = useState<DraftLine[]>(linesFrom(failed?.fields.lines));

  // The form isn't reset automatically (see submitWithoutReset), so clear it
  // once an entry is saved.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.saved) {
      setItemId("");
      setDate(today);
      setLines([]);
    }
  }
  useEffect(() => {
    if (!state?.saved) return;
    formRef.current?.reset();
    close?.();
  }, [state, close]);

  return (
    <form ref={formRef} action={action} onSubmit={submitWithoutReset(action)} aria-label="Add formula" className="grid gap-4 pb-4 sm:grid-cols-[11rem_1fr]" noValidate>
      {failed?.message && <Alert className="sm:col-span-2">{failed.message}</Alert>}
      <Field label="Visit date" error={errors.visit_date}>
        <input name="visit_date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} required className={inputClass} />
      </Field>
      <Field label="For service" hint="optional">
        <select
          name="appointment_item_id"
          value={itemId}
          onChange={(e) => {
            setItemId(e.target.value);
            const visit = visits.find((v) => v.itemId === e.target.value);
            if (visit) setDate(visit.date);
          }}
          className={selectClass}
        >
          <option value="">Not linked to a visit</option>
          {visits.map((v) => (
            <option key={v.itemId} value={v.itemId}>
              {v.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-start-2">
        <UsageLinesEditor products={products} lines={lines} onChange={setLines} name="lines" label="Products used (taken from stock at checkout)" />
        {errors.lines && <p className="mt-1 animate-fade-in text-sm text-danger">{errors.lines}</p>}
      </div>
      <Field label="Formula" hint={lines.length ? "optional with products" : undefined} error={errors.formula} className="sm:col-start-2">
        <textarea
          name="formula"
          defaultValue={failed?.fields.formula ?? ""}
          rows={2}
          placeholder="e.g. Roots: Topchic 6N + 6NN (1:1), 20 vol, 35 min"
          className={inputClass}
        />
      </Field>
      <Field label="Notes (optional)" className="sm:col-start-2">
        <input name="notes" defaultValue={failed?.fields.notes ?? ""} className={inputClass} />
      </Field>
      <div className="flex items-center gap-3 sm:col-start-2">
        <button type="submit" disabled={pending} className={buttonClass("primary", "md")}>
          {pending ? "Saving…" : "Save formula"}
        </button>
        {close && (
          <button type="button" onClick={close} className={buttonClass("quiet", "md")}>
            Cancel
          </button>
        )}
        {state?.saved && (
          <span role="status" className="animate-fade-in text-sm text-ink-muted">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
