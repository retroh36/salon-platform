"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { PlusIcon } from "@/components/ui/icons";
import { Alert, Badge, EmptyState } from "@/components/ui/page";
import { parseMoney } from "@/lib/inventory";
import { centsToInput } from "@/lib/services";
import { PAY_METHODS, payText, servicesText, type PayMethod, type RolePay, type WorkingRole } from "@/lib/working-roles";
import { archiveRole, saveRole, type RoleResult } from "./actions";

type Service = { id: string; name: string; category: string };

// The role being edited: its fields as typed (rates as text).
type Form = { id: string | null; name: string; online: boolean; only: boolean; serviceIds: string[]; method: PayMethod; hourly: string; pct: string };

const formOf = (r: WorkingRole | null): Form => ({
  id: r?.id ?? null,
  name: r?.name ?? "",
  online: r?.online ?? true,
  only: !!r?.serviceIds.length,
  serviceIds: r?.serviceIds ?? [],
  method: r?.pay?.method ?? "usual",
  hourly: centsToInput(r?.pay?.hourlyRateCents ?? null),
  pct: r?.pay?.commissionPct == null ? "" : String(r.pay.commissionPct),
});

const payOf = (f: Form): RolePay => ({
  method: f.method,
  hourlyRateCents: f.method === "hourly" ? parseMoney(f.hourly) : null,
  commissionPct: f.method === "commission" && f.pct.trim() !== "" && Number.isFinite(Number(f.pct)) ? Number(f.pct) : null,
});

// Settings → Working roles: the salon's roles, each opened to change its
// name, whether it shows online, its services and (for payroll) its pay.
export function RolesEditor({ roles, services, canPay }: { roles: WorkingRole[]; services: Service[]; canPay: boolean }) {
  const [form, setForm] = useState<Form | null>(null);
  const [result, setResult] = useState<RoleResult | null>(null);
  const [pending, start] = useTransition();
  const names = new Map(services.map((s) => [s.id, s.name]));
  const categories = [...new Set(services.map((s) => s.category))];
  const change = (patch: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setResult(null);
  };
  const open = (r: WorkingRole | null) => {
    setForm(formOf(r));
    setResult(null);
  };

  const save = () =>
    form &&
    start(async () => {
      const others = roles.filter((r) => r.id !== form.id);
      const position = form.id ? (roles.find((r) => r.id === form.id)?.position ?? 0) : roles.length;
      const saved = await saveRole(form.id, { name: form.name, online: form.online, serviceIds: form.only ? form.serviceIds : [] }, position, canPay ? payOf(form) : null, others);
      setResult(saved);
      if (saved.ok) setForm(null);
    });

  const remove = () =>
    form?.id &&
    start(async () => {
      const done = await archiveRole(form.id!, { name: form.name, online: form.online, serviceIds: form.serviceIds });
      setResult(done);
      if (done.ok) setForm(null);
    });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {roles.length === 0 && !form && (
        <EmptyState title="No working roles yet">Without roles, everyone works as they always have: all their services, online, at their usual pay.</EmptyState>
      )}

      {roles.length > 0 && (
        <ul aria-label="Working roles" className="flex flex-col gap-3">
          {roles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-ink">{r.name}</span>
                  <Badge tone={r.online ? "success" : "neutral"}>{r.online ? "Online" : "Not online"}</Badge>
                </div>
                <span className="text-13 text-ink-muted">
                  {servicesText(r.serviceIds, names)}
                  {r.pay ? ` · ${payText(r.pay)}` : ""}
                  {` · ${r.staffIds.length === 1 ? "1 person" : `${r.staffIds.length} people`}`}
                </span>
              </div>
              <Button variant="quiet" size="sm" aria-label={`Edit ${r.name}`} onClick={() => open(r)}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <section aria-label={form.id ? `Edit ${form.name || "role"}` : "New role"} className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5">
          <label className={labelClass}>
            Name
            <input value={form.name} onChange={(e) => change({ name: e.target.value })} maxLength={40} className={fieldClass} placeholder="e.g. Wash House" autoFocus />
          </label>

          <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" className={checkboxClass} checked={form.online} onChange={(e) => change({ online: e.target.checked })} />
            Clients can book this time online
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-13 font-medium text-ink">Services</legend>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input type="radio" name="only" checked={!form.only} onChange={() => change({ only: false })} />
              All their services
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input type="radio" name="only" checked={form.only} onChange={() => change({ only: true })} />
              Only these
            </label>
            {form.only && (
              <div className="flex flex-col gap-4 border-l border-line pl-4">
                {categories.map((c) => (
                  <div key={c} className="flex flex-col gap-1">
                    <span className="text-xs font-medium tracking-wide text-ink-muted uppercase">{c}</span>
                    {services
                      .filter((s) => s.category === c)
                      .map((s) => (
                        <label key={s.id} className="flex min-h-9 items-center gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={form.serviceIds.includes(s.id)}
                            onChange={(e) => change({ serviceIds: e.target.checked ? [...form.serviceIds, s.id] : form.serviceIds.filter((id) => id !== s.id) })}
                          />
                          {s.name}
                        </label>
                      ))}
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          {canPay && (
            <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
              <legend className="mb-1 text-13 font-medium text-ink">Pay</legend>
              <label className={labelClass}>
                How this time is paid
                <select value={form.method} onChange={(e) => change({ method: e.target.value as PayMethod })} className={selectClass}>
                  {PAY_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs font-normal text-ink-muted">{PAY_METHODS.find((m) => m.value === form.method)!.hint}</span>
              </label>
              {form.method === "hourly" && (
                <label className={labelClass}>
                  Hourly rate ($)
                  <input inputMode="decimal" value={form.hourly} onChange={(e) => change({ hourly: e.target.value })} className={fieldClass} placeholder="18.00" />
                </label>
              )}
              {form.method === "commission" && (
                <label className={labelClass}>
                  Commission on its services (%)
                  <input inputMode="decimal" value={form.pct} onChange={(e) => change({ pct: e.target.value })} className={fieldClass} placeholder="40" />
                </label>
              )}
              <span className="text-xs text-ink-muted">Someone can have their own rate in a role on their Team page.</span>
            </fieldset>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button variant="primary" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save role"}
            </Button>
            <Button disabled={pending} onClick={() => setForm(null)}>
              Cancel
            </Button>
            {form.id && (
              <Button variant="danger-quiet" size="sm" disabled={pending} onClick={remove}>
                Remove role
              </Button>
            )}
          </div>
        </section>
      )}

      {!form && (
        <Button className="self-start" onClick={() => open(null)}>
          <PlusIcon className="size-4" />
          Add a role
        </Button>
      )}
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </div>
  );
}
