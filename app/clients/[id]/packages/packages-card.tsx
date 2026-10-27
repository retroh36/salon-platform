"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/page";
import { proRatedRefund, usesLeft, type ClientPackage } from "@/lib/packages";
import { formatPrice } from "@/lib/services";
import { cancelClientPackage, type PackageResult } from "./actions";

const STATUS = { active: { label: "Active", tone: "success" }, canceled: { label: "Canceled", tone: "neutral" }, refunded: { label: "Refunded", tone: "warning" } } as const;

// A client's packages: what's left of each, and (managers) cancelling one
// with a pro-rated refund.
export function PackagesList({ clientId, packages, canCancel, expiresLabels }: { clientId: string; packages: ClientPackage[]; canCancel: boolean; expiresLabels: Record<string, string> }) {
  return (
    <ul className="-my-3 divide-y divide-line" aria-label="Packages">
      {packages.map((p) => {
        const expired = p.status === "active" && p.expiresAt !== null && new Date(p.expiresAt) <= new Date();
        return (
          <li key={p.id} className="py-3" data-testid="client-package">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-ink">{p.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-sm text-ink-muted tabular-nums">{formatPrice(p.priceCents)}</span>
                {expired ? <Badge tone="warning">Expired</Badge> : <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>}
              </span>
            </div>
            <ul className="mt-1.5 flex flex-col gap-1 text-13">
              {p.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span className="text-ink-muted">{i.serviceName}</span>
                  <span className="tabular-nums text-ink-muted">
                    {i.used} of {i.total} used · <span className="font-medium text-ink">{usesLeft(i)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {p.expiresAt && <p className="mt-1.5 text-xs text-ink-subtle">{expired ? "Expired" : "Use by"} {expiresLabels[p.id]}</p>}
            {canCancel && p.status === "active" && <CancelForm clientId={clientId} pkg={p} />}
          </li>
        );
      })}
    </ul>
  );
}

function CancelForm({ clientId, pkg }: { clientId: string; pkg: ClientPackage }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<"card" | "cash" | "none">("card");
  const [result, setResult] = useState<PackageResult | null>(null);
  const [pending, start] = useTransition();
  const refund = proRatedRefund(pkg);
  if (!open)
    return (
      <Button size="xs" variant="danger-quiet" className="mt-2 -ml-2.5" onClick={() => setOpen(true)}>
        Cancel package
      </Button>
    );
  return (
    <form
      aria-label={`Cancel ${pkg.name}`}
      className="mt-3 flex flex-col gap-3 rounded-lg bg-sunken p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await cancelClientPackage(clientId, pkg.id, reason, method)));
      }}
    >
      <p className="text-sm" data-testid="pro-rated-refund">
        The unused part is worth {formatPrice(refund)} (what the uses left cost, pro-rated).
      </p>
      <label className={labelClass}>
        Refund
        <select value={method} onChange={(e) => setMethod(e.target.value as "card" | "cash" | "none")} className={selectClass}>
          <option value="card">{formatPrice(refund)} back to their card</option>
          <option value="cash">{formatPrice(refund)} in cash</option>
          <option value="none">No refund</option>
        </select>
      </label>
      <label className={labelClass}>
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} required maxLength={300} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          Cancel package
        </Button>
        <Button size="sm" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
