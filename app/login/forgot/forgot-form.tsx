"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { forgotPassword } from "../actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotPassword, undefined);
  if (state?.sent) {
    return (
      <Alert tone="success">
        If {state.email} has a Maestra login, we&apos;ve sent it a link to choose a new password. It works once, for an hour. Check spam if it doesn&apos;t arrive.
      </Alert>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={labelClass}>
        Email
        <input name="email" type="email" autoComplete="email" required defaultValue={state?.email} className={`${fieldClass} h-11 text-base font-normal`} />
      </label>
      {state?.error && <Alert>{state.error}</Alert>}
      <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "mt-1 w-full")}>
        {pending ? "Sending…" : "Send the link"}
      </button>
    </form>
  );
}
