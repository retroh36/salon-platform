"use client";

// The cancellation policy on a visit or a client, for the front of house:
// a card or deposit still needed (send a secure link), a fee and what
// happened to it (waive with a reason, try again), shared by booking
// details, the client profile and the policy page.

import { useState, useTransition } from "react";
import { sendCardLink, retryFee, waiveFee, type PolicyActionResult } from "@/app/policy/actions";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { FEE_KIND_LABELS, FEE_STATUS_LABELS, type FeeStatus } from "@/lib/policy";
import { formatPrice } from "@/lib/services";

export type FeeView = {
  id: string;
  kind: "late_cancel" | "no_show";
  feeCents: number;
  fromDepositCents: number;
  status: FeeStatus;
  cardLabel: string | null;
  failureReason: string | null;
  waiveReason: string | null;
};

// "No-show fee $50 · Charging soon (Visa …4242)".
export function feeText(f: FeeView): string {
  const what = `${FEE_KIND_LABELS[f.kind]} fee ${formatPrice(f.feeCents)}`;
  if (f.status === "none") return `${FEE_KIND_LABELS[f.kind]} · no fee under the policy`;
  if (f.status === "charged")
    return `${what} · ${f.fromDepositCents >= f.feeCents ? "kept from the deposit" : `charged to ${f.cardLabel ?? "the card on file"}${f.fromDepositCents ? ` (with the ${formatPrice(f.fromDepositCents)} deposit)` : ""}`}`;
  if (f.status === "pending") return `${what} · charging ${f.cardLabel ?? "the card on file"} in a few minutes`;
  if (f.status === "failed") return `${what} · didn't go through${f.failureReason ? ` (${f.failureReason.toLowerCase()})` : ""}`;
  if (f.status === "waived") return `${what} · waived${f.waiveReason ? `: ${f.waiveReason}` : ""}`;
  return `${what} · ${FEE_STATUS_LABELS[f.status].toLowerCase()}`;
}

export function FeeControls({ fee, canWaive, canRetry }: { fee: FeeView; canWaive: boolean; canRetry: boolean }) {
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<PolicyActionResult | null>(null);
  const [pending, start] = useTransition();
  const waivable = canWaive && ["pending", "charged", "failed", "no_card"].includes(fee.status);
  const tone = fee.status === "failed" || fee.status === "no_card" ? "text-status-late-ink" : "text-ink-muted";
  return (
    <div className="flex flex-col gap-2" data-testid="policy-fee" data-fee-status={fee.status}>
      <p className={tone}>{feeText(fee)}</p>
      {waiving ? (
        <form
          aria-label="Waive fee"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await waiveFee(fee.id, reason);
              setResult(r);
              if (r.ok) setWaiving(false);
            });
          }}
        >
          <label className={labelClass}>
            Why are you waiving it?
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required className={fieldClass} placeholder="e.g. family emergency" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={pending || !reason.trim()}>
              {fee.status === "charged" ? "Waive and refund" : "Waive fee"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWaiving(false)}>
              Keep it
            </Button>
          </div>
        </form>
      ) : (
        (waivable || (canRetry && (fee.status === "failed" || fee.status === "no_card"))) && (
          <div className="flex flex-wrap gap-2">
            {canRetry && (fee.status === "failed" || fee.status === "no_card") && (
              <Button size="sm" disabled={pending} onClick={() => start(async () => setResult(await retryFee(fee.id)))}>
                Try the card again
              </Button>
            )}
            {waivable && (
              <Button size="sm" variant="ghost" onClick={() => (setWaiving(true), setResult(null))}>
                {fee.status === "charged" ? "Waive and refund…" : "Waive…"}
              </Button>
            )}
          </div>
        )
      )}
      {result && <p className={`text-sm ${result.ok ? "text-ink-muted" : "text-danger"}`} role={result.ok ? "status" : "alert"}>{result.message}</p>}
    </div>
  );
}

// Sends the client a secure link to add a card (and pay a deposit).
export function CardLinkButton({
  clientId,
  appointmentId,
  phone,
  email,
  depositCents,
  sent,
}: {
  clientId: string;
  appointmentId: string | null;
  phone: string | null;
  email: string | null;
  depositCents: number;
  sent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<"sms" | "email">(phone ? "sms" : "email");
  const [to, setTo] = useState((phone ? phone : email) ?? "");
  const [result, setResult] = useState<PolicyActionResult | null>(null);
  const [pending, start] = useTransition();
  const label = depositCents > 0 ? `Send deposit link (${formatPrice(depositCents)})` : "Send card link";
  if (!open)
    return (
      <div className="flex flex-col gap-1">
        <Button size="sm" className="self-start" onClick={() => (setOpen(true), setResult(null))}>
          {sent ? `${label.replace("Send", "Send again:")}` : label}
        </Button>
        {result?.ok && <p role="status" className="text-sm text-ink-muted">{result.message}</p>}
      </div>
    );
  return (
    <form
      aria-label={label}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await sendCardLink({ clientId, appointmentId, channel, to });
          setResult(r);
          if (r.ok) setOpen(false);
        });
      }}
    >
      <div className="flex gap-3 text-sm">
        {(
          [
            ["sms", "Text"],
            ["email", "Email"],
          ] as const
        ).map(([value, text]) => (
          <label key={value} className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`card-link-channel-${appointmentId ?? clientId}`}
              checked={channel === value}
              onChange={() => {
                setChannel(value);
                setTo((value === "sms" ? phone : email) ?? "");
              }}
            />
            {text}
          </label>
        ))}
      </div>
      <label className={labelClass}>
        {channel === "sms" ? "Mobile number" : "Email"}
        <input value={to} onChange={(e) => setTo(e.target.value)} inputMode={channel === "sms" ? "tel" : "email"} className={fieldClass} required />
      </label>
      <p className="text-xs text-ink-muted">They read the cancellation policy, agree, and add their card on a secure page{depositCents > 0 ? `, paying the ${formatPrice(depositCents)} deposit` : ""}. Texts and email wait in the outbox for now.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          Send link
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Not now
        </Button>
      </div>
      {result && !result.ok && <p role="alert" className="text-sm text-danger">{result.message}</p>}
    </form>
  );
}
