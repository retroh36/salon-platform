"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { saveGiftCardSettings, type SettingsResult } from "./actions";

export function GiftCardSettingsForm({ initial }: { initial: { presets: string; expiryMonths: string; promoDays: string } }) {
  const [s, setS] = useState(initial);
  const [result, setResult] = useState<SettingsResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Gift card settings"
      className="flex max-w-lg flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveGiftCardSettings(s)));
      }}
    >
      <label className={labelClass}>
        Preset amounts ($, separated by commas)
        <input value={s.presets} onChange={(e) => setS({ ...s, presets: e.target.value })} className={fieldClass} />
      </label>
      <label className={labelClass}>
        Bought cards expire after (months)
        <input inputMode="numeric" value={s.expiryMonths} onChange={(e) => setS({ ...s, expiryMonths: e.target.value })} className={fieldClass} placeholder="Never" />
        <span className="text-xs font-normal text-ink-muted">Leave empty for no expiry (the default).</span>
      </label>
      <label className={labelClass}>
        Promotional cards last (days)
        <input inputMode="numeric" value={s.promoDays} onChange={(e) => setS({ ...s, promoDays: e.target.value })} className={fieldClass} />
      </label>
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        Save
      </Button>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
