"use client";

// One row of the Policy page's table: the client, the day, the kind, the
// fee, its status as a tag, and what can be done about it (try the card
// again, waive with a reason) at the end, with a "⋯" menu when there's
// more than one thing to do.

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { retryFee, waiveFee, type PolicyActionResult } from "@/app/policy/actions";
import { Button, IconButton } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { MoreIcon } from "@/components/ui/icons";
import { Badge, nameLinkClass, type Tone } from "@/components/ui/page";
import { actionsClass, numClass, tdClass, trClass } from "@/components/ui/table";
import { FEE_STATUS_LABELS, type FeeStatus } from "@/lib/policy";
import { cents } from "./money";
import { useKeepOnScreen } from "@/components/ui/keep-on-screen";

export type FeeRowData = {
  id: string;
  clientId: string;
  clientName: string;
  day: string;
  kind: "late_cancel" | "no_show";
  feeCents: number;
  fromDepositCents: number;
  status: FeeStatus;
  cardLabel: string | null;
  failureReason: string | null;
  waiveReason: string | null;
};

const KIND = { late_cancel: "Late cancel", no_show: "No-show" } as const;

// The tag and the muted detail after it.
function statusOf(f: FeeRowData): { tone: Tone; label: string; detail: string | null } {
  switch (f.status) {
    case "charged":
      if (f.fromDepositCents >= f.feeCents) return { tone: "info", label: "Kept from deposit", detail: null };
      return { tone: "success", label: FEE_STATUS_LABELS.charged, detail: [f.cardLabel, f.fromDepositCents ? `with the ${cents(f.fromDepositCents)} deposit` : null].filter(Boolean).join(" · ") || null };
    case "pending":
      return { tone: "info", label: FEE_STATUS_LABELS.pending, detail: f.cardLabel };
    case "failed":
      return { tone: "danger", label: FEE_STATUS_LABELS.failed, detail: f.failureReason };
    case "no_card":
      return { tone: "warning", label: FEE_STATUS_LABELS.no_card, detail: null };
    case "waived":
      return { tone: "neutral", label: FEE_STATUS_LABELS.waived, detail: f.waiveReason };
    default:
      return { tone: "neutral", label: FEE_STATUS_LABELS[f.status], detail: null };
  }
}

export function FeeRow({ fee, canWaive }: { fee: FeeRowData; canWaive: boolean }) {
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<PolicyActionResult | null>(null);
  const [pending, start] = useTransition();
  const retryable = fee.status === "failed" || fee.status === "no_card";
  const waivable = canWaive && ["pending", "charged", "failed", "no_card"].includes(fee.status);
  const waiveLabel = fee.status === "charged" ? "Waive and refund…" : "Waive…";
  const status = statusOf(fee);
  const retry = () => start(async () => setResult(await retryFee(fee.id)));
  const openWaive = () => (setWaiving(true), setResult(null));
  return (
    <Fragment>
      <tr className={trClass} data-testid="policy-row" data-fee-status={fee.status}>
        <td className={tdClass}>
          <Link href={`/clients/${fee.clientId}`} className={nameLinkClass}>
            {fee.clientName}
          </Link>
        </td>
        <td className={`${tdClass} whitespace-nowrap text-ink-muted`}>{fee.day}</td>
        <td className={`${tdClass} whitespace-nowrap text-ink-muted`}>{KIND[fee.kind]}</td>
        <td className={`${tdClass} ${numClass}`}>{cents(fee.feeCents)}</td>
        <td className={tdClass}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={status.tone}>{status.label}</Badge>
            {status.detail && <span className="text-13 text-ink-muted">{status.detail}</span>}
          </span>
          {result && !waiving && (
            <p className={`mt-1 text-13 ${result.ok ? "text-ink-muted" : "text-danger"}`} role={result.ok ? "status" : "alert"}>
              {result.message}
            </p>
          )}
        </td>
        <td className={actionsClass}>
          {!waiving && (
            <span className="inline-flex items-center gap-1">
              {retryable ? (
                <Button size="xs" variant="quiet" disabled={pending} onClick={retry}>
                  Try the card again
                </Button>
              ) : (
                waivable && (
                  <Button size="xs" variant="quiet" onClick={openWaive}>
                    {waiveLabel}
                  </Button>
                )
              )}
              {retryable && waivable && <RowMenu label={`More for ${fee.clientName}`} items={[{ label: waiveLabel, onSelect: openWaive }]} />}
            </span>
          )}
        </td>
      </tr>
      {waiving && (
        <tr className="border-t border-line bg-sunken/40">
          <td colSpan={6} className="px-4 py-3">
            <form
              aria-label="Waive fee"
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const r = await waiveFee(fee.id, reason);
                  setResult(r);
                  if (r.ok) setWaiving(false);
                });
              }}
            >
              <label className="flex min-w-64 flex-1 flex-col gap-1 text-13 font-medium text-ink">
                Why are you waiving it?
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required autoFocus className={fieldClass} placeholder="e.g. family emergency" />
              </label>
              <Button type="submit" variant="primary" disabled={pending || !reason.trim()}>
                {fee.status === "charged" ? "Waive and refund" : "Waive fee"}
              </Button>
              <Button variant="quiet" onClick={() => setWaiving(false)}>
                Keep it
              </Button>
              {result && !result.ok && (
                <p role="alert" className="basis-full text-13 text-danger">
                  {result.message}
                </p>
              )}
            </form>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// A small "⋯" menu for a row's less common actions.
function RowMenu({ label, items }: { label: string; items: { label: string; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  useKeepOnScreen(pop, open);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <IconButton label={label} size="xs" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreIcon className="size-4" />
      </IconButton>
      {open && (
        <span ref={pop} role="menu" className="absolute top-full right-0 z-20 mt-1 flex min-w-44 flex-col rounded-lg border border-line bg-surface p-1 text-left shadow-lift">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
