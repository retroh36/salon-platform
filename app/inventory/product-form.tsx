"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { buttonClass } from "@/components/ui/button";
import { checkboxClass, selectClass } from "@/components/ui/field";
import { Alert, Card } from "@/components/ui/page";
import { saveProduct } from "./actions";

export type ProductFormValues = {
  product_id?: string;
  brand: string;
  line: string;
  name: string;
  sku: string;
  barcode: string;
  type: string;
  unit: string;
  size: string;
  cost: string;
  price: string;
  shelf: string;
  supplier_id: string;
  is_active: boolean;
};

export function ProductForm({ initial, suppliers }: { initial: ProductFormValues; suppliers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveProduct, undefined);
  const fields = state?.fields;
  const value = (k: keyof ProductFormValues) => (fields ? (fields[k] ?? "") : String(initial[k] ?? ""));
  const errors = state?.errors ?? {};
  const [type, setType] = useState(value("type") || "back_bar");
  const [unit, setUnit] = useState(type === "retail" ? "unit" : value("unit") || "g");

  return (
    <form action={action} onSubmit={submitWithoutReset(action)} noValidate aria-label={initial.product_id ? "Edit product" : "New product"}>
      {initial.product_id && <input type="hidden" name="product_id" value={initial.product_id} />}
      {state?.message && <Alert className="mb-4">{state.message}</Alert>}
      <Card title="Product">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Brand" error={errors.brand}>
            <input name="brand" defaultValue={value("brand")} required className={inputClass} placeholder="Goldwell" />
          </Field>
          <Field label="Line" hint="optional">
            <input name="line" defaultValue={value("line")} className={inputClass} placeholder="Topchic" />
          </Field>
          <Field label="Shade or name" error={errors.name}>
            <input name="name" defaultValue={value("name")} required className={inputClass} placeholder="7N" />
          </Field>
          <Field label="Type" error={errors.type}>
            <select
              name="type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                if (e.target.value === "retail") setUnit("unit");
              }}
              className={selectClass}
            >
              <option value="back_bar">Back bar (used in services)</option>
              <option value="retail">Retail (sold to clients)</option>
            </select>
          </Field>
          <Field label="Measured in" error={errors.unit}>
            <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={selectClass} disabled={type === "retail"}>
              <option value="g">Grams</option>
              <option value="ml">ml</option>
              <option value="unit">Units</option>
            </select>
          </Field>
          {type === "retail" && <input type="hidden" name="unit" value="unit" />}
          {unit !== "unit" ? (
            <Field label={`Container size (${unit})`} error={errors.size}>
              <input name="size" defaultValue={value("size")} inputMode="decimal" required className={inputClass} placeholder="60" />
            </Field>
          ) : (
            <div />
          )}
          <Field label="Cost per container ($)" error={errors.cost}>
            <input name="cost" defaultValue={value("cost")} inputMode="decimal" required className={inputClass} placeholder="9.50" />
          </Field>
          {type === "retail" && (
            <Field label="Retail price ($)" error={errors.price}>
              <input name="price" defaultValue={value("price")} inputMode="decimal" required className={inputClass} placeholder="30.00" />
            </Field>
          )}
          <Field label="Supplier">
            <select name="supplier_id" defaultValue={value("supplier_id")} className={selectClass}>
              <option value="">None</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="SKU" hint="optional" error={errors.sku}>
            <input name="sku" defaultValue={value("sku")} className={inputClass} />
          </Field>
          <Field label="Barcode" hint="optional" error={errors.barcode}>
            <input name="barcode" defaultValue={value("barcode")} inputMode="numeric" className={inputClass} />
          </Field>
          <Field label="Shelf" hint="for counting" error={errors.shelf}>
            <input name="shelf" defaultValue={value("shelf")} className={inputClass} placeholder="Color bar A" />
          </Field>
        </div>
        {initial.product_id && (
          <label className="mt-4 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="is_active" defaultChecked={fields ? fields.is_active === "on" : initial.is_active} className={checkboxClass} />
            In use (unticked products are hidden from the list)
          </label>
        )}
      </Card>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonClass("primary", "md")}>
          {pending ? "Saving…" : initial.product_id ? "Save product" : "Add product"}
        </button>
        <Link href={initial.product_id ? `/inventory/${initial.product_id}` : "/inventory"} className={buttonClass("secondary", "md")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
