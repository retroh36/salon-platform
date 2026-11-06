"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { useUnsavedChanges } from "@/components/unsaved";
import { formatDuration } from "@/lib/duration";
import { reach } from "@/lib/reach";
import { bundleMinutes, MAX_BUNDLE_PARTS, MAX_GAP_MINUTES, type BundlePart } from "@/lib/scheduling/bundles";
import { formatPrice, sortCategories } from "@/lib/services";
import { saveBundle } from "./bundle-actions";

export type BundleService = { id: string; name: string; category: string; minutes: number; processingMinutes: number; priceCents: number };

type Row = { key: number; serviceId: string; gap: string };
let nextKey = 0;

// A service bundle: a name, its services in order and the gap before each
// one after the first (free time for the stylist).
export function BundleForm({
  bundleId,
  initial,
  services,
  readOnly,
}: {
  bundleId?: string;
  initial: { name: string; description: string; online: boolean; parts: BundlePart[] };
  services: BundleService[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const byId = new Map(services.map((s) => [s.id, s]));
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [online, setOnline] = useState(initial.online);
  const [rows, setRows] = useState<Row[]>(() =>
    (initial.parts.length ? initial.parts : [{ serviceId: "", gapMinutes: 0 }, { serviceId: "", gapMinutes: 0 }]).map((p) => ({ key: nextKey++, serviceId: p.serviceId, gap: String(p.gapMinutes) })),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const snapshot = JSON.stringify([name, description, online, rows.map((r) => [r.serviceId, r.gap])]);
  const [opened] = useState(snapshot);
  useUnsavedChanges(snapshot !== opened && !pending);

  const parts: BundlePart[] = rows.map((r, n) => ({ serviceId: r.serviceId, gapMinutes: n === 0 ? 0 : Number(r.gap) }));
  const chosen = parts.filter((p) => byId.has(p.serviceId));
  const total = bundleMinutes(
    chosen.map((p) => ({ ...p, gapMinutes: Number.isFinite(p.gapMinutes) ? p.gapMinutes : 0 })),
    (id) => byId.get(id)!.minutes,
  );
  const free = chosen.reduce((sum, p, n) => sum + (n > 0 && Number.isFinite(p.gapMinutes) ? p.gapMinutes : 0) + byId.get(p.serviceId)!.processingMinutes, 0);
  const price = chosen.reduce((sum, p) => sum + byId.get(p.serviceId)!.priceCents, 0);

  const change = (key: number, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: -1 | 1) =>
    setRows((all) => {
      const next = [...all];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const r = await reach(saveBundle({ id: bundleId, name, description, online, parts }));
      if (!r.ok) return setMessage(r.message);
      router.push("/services");
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-5">
      <fieldset disabled={readOnly} className="flex flex-col gap-5">
        <label className={labelClass}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className={fieldClass} placeholder="Highlight, gloss and cut" />
        </label>
        <label className={labelClass}>
          Description <span className="font-normal text-ink-muted">(optional, shown on the booking site)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} className={fieldClass} />
        </label>

        <div className="flex flex-col gap-2">
          <p className="text-13 font-medium text-ink">Services, in order</p>
          <ol aria-label="Services in the bundle" className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={r.key} data-testid="bundle-part" className="flex flex-col gap-2">
                {i > 0 && (
                  <label className="flex items-center gap-2 pl-7 text-13 text-ink-muted">
                    Gap before
                    <input
                      aria-label={`Gap before service ${i + 1}`}
                      type="number"
                      min={0}
                      max={MAX_GAP_MINUTES}
                      step={5}
                      value={r.gap}
                      onChange={(e) => change(r.key, { gap: e.target.value })}
                      className={`${fieldClass} w-20!`}
                    />
                    min, the stylist free
                  </label>
                )}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                  <span className="w-5 text-13 text-ink-muted tabular-nums">{i + 1}</span>
                  <select aria-label={`Service ${i + 1}`} value={r.serviceId} onChange={(e) => change(r.key, { serviceId: e.target.value })} className={`${selectClass} min-w-48 flex-1`}>
                    <option value="">Choose a service</option>
                    {sortCategories(new Set(services.map((s) => s.category))).map((category) => (
                      <optgroup key={category} label={category}>
                        {services
                          .filter((s) => s.category === category)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  {byId.has(r.serviceId) && <span className="text-13 text-ink-muted tabular-nums">{formatDuration(byId.get(r.serviceId)!.minutes)}</span>}
                  <span className="ml-auto flex items-center">
                    <button type="button" aria-label={`Move service ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} className={buttonClass("ghost", "sm")}>
                      ↑
                    </button>
                    <button type="button" aria-label={`Move service ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} className={buttonClass("ghost", "sm")}>
                      ↓
                    </button>
                    <button type="button" aria-label={`Remove service ${i + 1}`} disabled={rows.length <= 2} onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} className={buttonClass("ghost", "sm")}>
                      ×
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ol>
          <Button size="sm" className="self-start" disabled={rows.length >= MAX_BUNDLE_PARTS} onClick={() => setRows((all) => [...all, { key: nextKey++, serviceId: "", gap: "0" }])}>
            Add a service
          </Button>
          <p data-testid="bundle-total" className="text-13 text-ink-muted">
            {chosen.length
              ? `${formatDuration(total)} in all${free > 0 ? `, the stylist free for ${formatDuration(free)}` : ""}. ${formatPrice(price)} at menu prices, each service priced on its own.`
              : "Choose the services."}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} className={checkboxClass} />
          Clients can book it online
        </label>
      </fieldset>

      {message && <Alert>{message}</Alert>}
      {!readOnly && (
        <Button type="submit" variant="primary" className="self-start" disabled={pending}>
          {pending ? "Saving…" : bundleId ? "Save bundle" : "Add bundle"}
        </Button>
      )}
    </form>
  );
}
