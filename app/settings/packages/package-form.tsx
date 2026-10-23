"use client";

import { useRef, useState, useTransition } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { Alert } from "@/components/ui/page";
import { LEVEL_LABELS, STAFF_LEVELS } from "@/lib/schedule-forms";
import { centsToInput } from "@/lib/services";
import type { PackageTemplate } from "@/lib/packages";
import { savePackage, type PackageInput, type SaveResult } from "./actions";

// Creating or editing a package: its services and counts, price, expiry
// and the stylist levels it covers.
export function PackageForm({ template, services, onSaved }: { template: PackageTemplate | null; services: { id: string; name: string }[]; onSaved?: () => void }) {
  const nextKey = useRef(1);
  const [f, setF] = useState<Omit<PackageInput, "items"> & { items: { key: number; serviceId: string; quantity: string }[] }>(() => ({
    id: template?.id ?? null,
    name: template?.name ?? "",
    price: template ? centsToInput(template.priceCents) : "",
    expiryMonths: template?.expiryMonths ? String(template.expiryMonths) : "",
    levels: template?.levels ?? [],
    isActive: template?.isActive ?? true,
    items: template ? template.items.map((i, n) => ({ key: -1 - n, serviceId: i.serviceId, quantity: String(i.quantity) })) : [{ key: 0, serviceId: "", quantity: "5" }],
  }));
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label={template ? `Edit ${template.name}` : "New package"}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await savePackage({ ...f, items: f.items.map((i) => ({ serviceId: i.serviceId, quantity: i.quantity })) });
          setResult(r);
          if (r.ok && !template) {
            setF({ id: null, name: "", price: "", expiryMonths: "", levels: [], isActive: true, items: [{ key: nextKey.current++, serviceId: "", quantity: "5" }] });
            onSaved?.();
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={`${labelClass} sm:col-span-2`}>
          Name
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={fieldClass} placeholder="e.g. 5 blowouts" maxLength={120} required />
        </label>
        <label className={labelClass}>
          Price ($)
          <input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} className={fieldClass} required />
        </label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Services</legend>
        {f.items.map((i, n) => (
          <div key={i.key} className="flex items-end gap-2">
            <label className={`${labelClass} flex-1`}>
              <select aria-label={`Service ${n + 1}`} value={i.serviceId} onChange={(e) => setF({ ...f, items: f.items.map((x) => (x.key === i.key ? { ...x, serviceId: e.target.value } : x)) })} className={selectClass}>
                <option value="">Choose a service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <input aria-label={`How many of service ${n + 1}`} type="number" min={1} max={100} value={i.quantity} onChange={(e) => setF({ ...f, items: f.items.map((x) => (x.key === i.key ? { ...x, quantity: e.target.value } : x)) })} className={`${fieldClass} w-20`} />
            </label>
            {f.items.length > 1 && (
              <IconButton label={`Remove service ${n + 1}`} size="sm" onClick={() => setF({ ...f, items: f.items.filter((x) => x.key !== i.key) })}>
                <CloseIcon className="size-4" />
              </IconButton>
            )}
          </div>
        ))}
        <Button size="sm" className="self-start" onClick={() => setF({ ...f, items: [...f.items, { key: nextKey.current++, serviceId: "", quantity: "3" }] })}>
          <PlusIcon className="size-4" />
          Add a service
        </Button>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Lasts (months)
          <input inputMode="numeric" value={f.expiryMonths} onChange={(e) => setF({ ...f, expiryMonths: e.target.value })} className={fieldClass} placeholder="Never expires" />
        </label>
        <fieldset>
          <legend className="text-sm font-medium">For stylists who are</legend>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {STAFF_LEVELS.map((l) => (
              <label key={l} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={f.levels.length === 0 || f.levels.includes(l)}
                  onChange={(e) => {
                    const current = f.levels.length === 0 ? [...STAFF_LEVELS] : f.levels;
                    setF({ ...f, levels: e.target.checked ? [...current, l] : current.filter((x) => x !== l) });
                  }}
                />
                {LEVEL_LABELS[l]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {template && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={checkboxClass} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          On sale (clients who have it keep it either way)
        </label>
      )}
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {template ? "Save package" : "Add package"}
      </Button>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
