"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SalonMark } from "@/components/ui/salon-mark";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { removeSalonLogo, saveDeniseLimit, saveSalonName, uploadSalonLogo, type SettingsResult } from "./actions";

// The salon's own brand: its name and logo, shown at the top of the
// sidebar and on messages to its clients.
export function SalonSettings({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [value, setValue] = useState(name);
  const [result, setResult] = useState<SettingsResult | null>(null);
  const [pending, startTransition] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const run = (work: () => Promise<SettingsResult>) =>
    startTransition(async () => {
      setResult(null);
      setResult(await work());
    });

  return (
    <div className="flex flex-col gap-6">
      {result && (result.ok ? <p role="status" className="font-medium text-status-confirmed-ink">{result.message}</p> : <Alert>{result.message}</Alert>)}

      <form
        aria-label="Salon name"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveSalonName(value));
        }}
      >
        <label className={`${labelClass} min-w-64 flex-1`}>
          Salon name
          <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={100} className={fieldClass} />
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          Save name
        </Button>
      </form>

      <form
        aria-label="Salon logo"
        className="flex flex-wrap items-center gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          run(() => uploadSalonLogo(data));
          e.currentTarget.reset();
        }}
      >
        <SalonMark name={value || name} logoUrl={logoUrl} size="lg" />
        <div className="flex flex-col gap-2">
          <label className={labelClass}>
            Logo
            <input ref={file} type="file" name="logo" accept="image/png,image/jpeg,image/webp" className="text-sm" />
          </label>
          <p className="text-xs text-ink-muted">PNG, JPEG or WebP, up to 2 MB. A square image works best. Without a logo, the salon&apos;s initial shows.</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              Upload logo
            </Button>
            {logoUrl && (
              <Button variant="ghost" disabled={pending} onClick={() => run(removeSalonLogo)}>
                Remove logo
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

// Denise's Claude usage and the salon's daily limit (owners).
export function DeniseUsage({ today, week, requests, limit, connected }: { today: number; week: number; requests: number; limit: number; connected: boolean }) {
  const [value, setValue] = useState(String(limit));
  const [result, setResult] = useState<SettingsResult | null>(null);
  const [pending, startTransition] = useTransition();
  const n = (x: number) => x.toLocaleString("en-US");
  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-wrap gap-8 text-sm" data-testid="denise-usage">
        <div>
          <dt className="text-ink-muted">Today</dt>
          <dd className="font-semibold tabular-nums">
            {n(today)} of {n(limit)} tokens
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Last 7 days</dt>
          <dd className="font-semibold tabular-nums">
            {n(week)} tokens, {n(requests)} requests
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Connected</dt>
          <dd className="font-semibold">{connected ? "Yes" : "No: plain wording only"}</dd>
        </div>
      </dl>
      {result && (result.ok ? <p role="status" className="font-medium text-status-confirmed-ink">{result.message}</p> : <Alert>{result.message}</Alert>)}
      <form
        aria-label="Denise's daily limit"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => setResult(await saveDeniseLimit(Number(value))));
        }}
      >
        <label className={`${labelClass} w-56`}>
          Daily limit (tokens)
          <input type="number" min={0} step={10000} value={value} onChange={(e) => setValue(e.target.value)} className={fieldClass} />
        </label>
        <Button type="submit" disabled={pending}>
          Save limit
        </Button>
      </form>
    </div>
  );
}
