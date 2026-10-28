"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { addBlackout, saveNoticeDays } from "./actions";

export function NoticeForm({ days }: { days: number }) {
  const [state, action, pending] = useActionState(saveNoticeDays, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className={labelClass}>
        Days ahead
        <input name="notice_days" type="number" min={0} max={365} defaultValue={days} className={`${fieldClass} w-28`} />
      </label>
      <Button type="submit" variant="primary" disabled={pending}>
        Save
      </Button>
      {state?.message && <Alert tone={state.ok ? "success" : "error"} className="basis-full">{state.message}</Alert>}
    </form>
  );
}

export function BlackoutForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(addBlackout, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end" aria-label="Add blackout dates">
      <label className={labelClass}>
        First day
        <input name="starts_on" type="date" min={today} required className={fieldClass} />
      </label>
      <label className={labelClass}>
        Last day
        <input name="ends_on" type="date" min={today} className={fieldClass} />
      </label>
      <label className={labelClass}>
        Name (optional)
        <input name="label" maxLength={80} className={fieldClass} placeholder="Holidays" />
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>
        Add blackout
      </Button>
      {state?.message && <Alert tone={state.ok ? "success" : "error"} className="sm:col-span-4">{state.message}</Alert>}
    </form>
  );
}
