"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SalonMark } from "@/components/ui/salon-mark";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/page";
import { needsCheck, type HealthStatus } from "@/lib/denise/health";
import {
  checkDenise,
  removeSalonLogo,
  saveDeniseLimit,
  saveSalonName,
  uploadSalonLogo,
  type SettingsResult,
} from "./actions";

// The salon's own brand: its name and logo, shown at the top of the
// sidebar and on messages to its clients.
export function SalonSettings({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}) {
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
      {result &&
        (result.ok ? (
          <Alert tone="success">
            {result.message}
          </Alert>
        ) : (
          <Alert>{result.message}</Alert>
        ))}

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
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={100}
            className={fieldClass}
          />
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
          {/* One control: the button opens the file chooser, and choosing a
              file uploads it. */}
          <input
            ref={file}
            type="file"
            name="logo"
            aria-label="Logo"
            accept="image/png,image/jpeg,image/webp"
            tabIndex={-1}
            className="sr-only"
            onChange={(e) => {
              if (e.currentTarget.files?.length) e.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="flex gap-2">
            <Button disabled={pending} onClick={() => file.current?.click()}>
              {pending ? "Uploading…" : logoUrl ? "Change logo" : "Upload logo"}
            </Button>
            {logoUrl && (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => run(removeSalonLogo)}
              >
                Remove logo
              </Button>
            )}
          </div>
          <p className="text-13 text-ink-muted">
            PNG, JPEG or WebP, up to 2 MB. A square image works best. Without a
            logo, the salon&apos;s initial shows.
          </p>
        </div>
      </form>
    </div>
  );
}

// Whether Denise's thinking is working (a real call's outcome, checked
// again here when nothing's been tried for an hour), her usage and the
// salon's daily limit. Changing the limit is billing (owners); managers
// see the rest.
export function DeniseUsage({
  today,
  week,
  answered,
  failed,
  limit,
  status: initial,
  timeZone,
  canChange,
}: {
  today: number;
  week: number;
  answered: number;
  failed: number;
  limit: number;
  status: HealthStatus;
  timeZone: string;
  canChange: boolean;
}) {
  const [value, setValue] = useState(String(limit));
  const [result, setResult] = useState<SettingsResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(initial);
  const [checking, startCheck] = useTransition();
  const check = useCallback(() => startCheck(async () => setStatus(await checkDenise())), []);
  // Checked once on opening when nothing's been tried for an hour.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (needsCheck(initial, Date.now())) check();
  }, [initial, check]);
  const n = (x: number) => x.toLocaleString("en-US");
  return (
    <div className="flex flex-col gap-4">
      <DeniseStatus status={status} checking={checking} timeZone={timeZone} onCheck={check} />
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
            {n(week)} tokens, {n(answered)} answered{failed > 0 ? `, ${n(failed)} failed` : ""}
          </dd>
        </div>
      </dl>
      {result &&
        (result.ok ? (
          <Alert tone="success">
            {result.message}
          </Alert>
        ) : (
          <Alert>{result.message}</Alert>
        ))}
      {!canChange && (
        <p className="text-sm text-ink-muted">
          Only an owner changes the daily limit.
        </p>
      )}
      {canChange && (
        <form
          aria-label="Denise's daily limit"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () =>
              setResult(await saveDeniseLimit(Number(value))),
            );
          }}
        >
          <label className={`${labelClass} w-56`}>
            Daily limit (tokens)
            <input
              type="number"
              min={0}
              step={10000}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={fieldClass}
            />
          </label>
          <Button type="submit" disabled={pending}>
            Save limit
          </Button>
        </form>
      )}
    </div>
  );
}

const atTime = (at: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));

// "Working · last answered Mon, Nov 2, 2:14 PM", or why not, with Check now.
function DeniseStatus({ status, checking, timeZone, onCheck }: { status: HealthStatus; checking: boolean; timeZone: string; onCheck: () => void }) {
  return (
    <div className="flex flex-col gap-2" data-testid="denise-status">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-ink-muted">Status</span>
        {checking ? (
          <Badge tone="neutral">Checking…</Badge>
        ) : status.kind === "working" ? (
          <Badge tone="success">Working</Badge>
        ) : status.kind === "failing" ? (
          <Badge tone="danger">Not working</Badge>
        ) : status.kind === "off" ? (
          <Badge tone="neutral">Not set up</Badge>
        ) : (
          <Badge tone="neutral">Not checked yet</Badge>
        )}
        {!checking && status.kind === "working" && <span className="text-ink-muted">Last answered {atTime(status.at, timeZone)}</span>}
        {status.kind !== "off" && (
          <Button size="sm" variant="quiet" disabled={checking} onClick={onCheck}>
            Check now
          </Button>
        )}
      </div>
      {!checking && status.kind === "failing" && (
        <Alert>
          {status.why} <span className="text-ink-muted">({atTime(status.at, timeZone)})</span>
        </Alert>
      )}
      {status.kind === "off" && <p className="text-sm text-ink-muted">Denise isn&rsquo;t connected to her AI service, so she uses plain wording and can&rsquo;t answer questions.</p>}
    </div>
  );
}
