"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { choosePassword } from "@/app/login/actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(choosePassword, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={labelClass}>
        New password
        <input name="password" type="password" autoComplete="new-password" minLength={8} required className={`${fieldClass} h-11 text-base font-normal`} />
        <span className="text-13 font-normal text-ink-muted">At least 8 characters.</span>
      </label>
      <label className={labelClass}>
        The same again
        <input name="password_again" type="password" autoComplete="new-password" minLength={8} required className={`${fieldClass} h-11 text-base font-normal`} />
      </label>
      {state?.error && <Alert>{state.error}</Alert>}
      <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "mt-1 w-full")}>
        {pending ? "Saving…" : "Save password and sign in"}
      </button>
    </form>
  );
}
