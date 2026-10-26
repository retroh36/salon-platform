"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { forgetThisDevice, removeDevice, saveAutoLock, shareThisDevice, type DeviceResult } from "./actions";

function Result({ result }: { result: DeviceResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <Alert tone="success">
      {result.message}
    </Alert>
  ) : (
    <Alert>{result.message}</Alert>
  );
}

export function ShareThisDevice({ shared }: { shared: boolean }) {
  const [name, setName] = useState("Front desk iPad");
  const [result, setResult] = useState<DeviceResult | null>(null);
  const [pending, start] = useTransition();
  if (shared)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">This device is shared: signed out, it shows the PIN screen.</p>
        <Button className="self-start" disabled={pending} onClick={() => start(async () => setResult(await forgetThisDevice()))}>
          Stop sharing this device
        </Button>
        <Result result={result} />
      </div>
    );
  return (
    <form
      aria-label="Share this device"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await shareThisDevice(name)));
      }}
    >
      <label className={`${labelClass} max-w-xs`}>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className={fieldClass} />
      </label>
      <Button type="submit" variant="primary" className="self-start" disabled={pending}>
        Use this device as a shared device
      </Button>
      <Result result={result} />
    </form>
  );
}

export function RemoveDevice({ id, name }: { id: string; name: string }) {
  const [result, setResult] = useState<DeviceResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" aria-label={`Remove ${name}`} disabled={pending} onClick={() => start(async () => setResult(await removeDevice(id)))}>
        Remove
      </Button>
      <Result result={result} />
    </span>
  );
}

const MINUTES = [1, 2, 5, 10, 15, 30, 60];

export function AutoLockPicker({ value }: { value: number }) {
  const [current, setCurrent] = useState(value);
  const [result, setResult] = useState<DeviceResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <label className={`${labelClass} max-w-xs`}>
        Lock after nobody uses it for
        <select
          value={current}
          disabled={pending}
          onChange={(e) => {
            const v = Number(e.target.value);
            setCurrent(v);
            start(async () => setResult(await saveAutoLock(v)));
          }}
          className={selectClass}
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m} {m === 1 ? "minute" : "minutes"}
            </option>
          ))}
        </select>
      </label>
      <Result result={result} />
    </div>
  );
}
