"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/page";
import type { PaymentsStatus } from "@/lib/payments";
import { connectStripe, disconnectStripe, refreshStripe, setPaymentsLive, type PaymentsResult } from "./actions";

const TONE = { "Not connected": "neutral", "Test mode": "warning", Live: "success" } as const;

// Not connected / Test mode / Live, Connect with Stripe (owners), and Go
// live once the account is ready on the production site.
export function PaymentsConnection({ status, canChange, back }: { status: PaymentsStatus; canChange: boolean; back: string | null }) {
  const [result, setResult] = useState<PaymentsResult | null>(back ? { ok: true, message: back } : null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<PaymentsResult>) =>
    start(async () => {
      const r = await action();
      if (r.ok && r.url) window.location.assign(r.url);
      setResult(r);
    });
  return (
    <div className="flex flex-col gap-5" data-testid="payments-connection">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-sm">
        <dt className="text-ink-muted">Payments</dt>
        <dd data-testid="payments-status">
          <Badge tone={TONE[status.label]}>{status.label}</Badge>
        </dd>
        <dt className="text-ink-muted">Stripe account</dt>
        <dd data-testid="stripe-account">
          <Badge tone={!status.connected ? "neutral" : status.onboarding ? "warning" : "success"}>{!status.connected ? "None" : status.onboarding ? "Needs details" : "Ready"}</Badge>
        </dd>
      </dl>
      <p className="text-sm text-ink" data-testid="payments-summary">
        {status.summary}
      </p>
      {canChange ? (
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap gap-2">
            {!status.connected && (
              <Button variant="primary" disabled={pending || !!status.cantConnect} onClick={() => run(connectStripe)}>
                {pending ? "Opening Stripe…" : "Connect with Stripe"}
              </Button>
            )}
            {status.onboarding && (
              <Button variant="primary" disabled={pending || !!status.cantConnect} onClick={() => run(connectStripe)}>
                Finish setting up Stripe
              </Button>
            )}
            {status.connected && !status.onboarding && !status.live && (
              <Button variant="primary" disabled={pending || !!status.cantGoLive} onClick={() => run(() => setPaymentsLive(true))}>
                Go live
              </Button>
            )}
            {status.live && (
              <Button disabled={pending} onClick={() => run(() => setPaymentsLive(false))}>
                Stop taking real payments
              </Button>
            )}
            {status.connected && !status.cantConnect && (
              <Button variant="quiet" disabled={pending} onClick={() => run(refreshStripe)}>
                Check again
              </Button>
            )}
          </div>
          {!status.connected && status.cantConnect && <p className="text-13 text-ink-muted">{status.cantConnect}</p>}
          {status.connected && !status.onboarding && !status.live && status.cantGoLive && <p className="text-13 text-ink-muted">{status.cantGoLive}</p>}
          {status.connected &&
            (confirmOff ? (
              <div className="flex flex-col gap-2 rounded-lg border border-line p-3 text-sm" data-testid="disconnect-confirm">
                <p>Disconnect your Stripe account? Payments go back to test cards only. Cards clients saved stay in your Stripe account.</p>
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" disabled={pending} onClick={() => {
                      setConfirmOff(false);
                      run(disconnectStripe);
                    }}>
                    Disconnect
                  </Button>
                  <Button size="sm" onClick={() => setConfirmOff(false)}>
                    Keep it
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="quiet" size="sm" onClick={() => setConfirmOff(true)}>
                Disconnect Stripe…
              </Button>
            ))}
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Only owners connect Stripe or go live.</p>
      )}
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </div>
  );
}
