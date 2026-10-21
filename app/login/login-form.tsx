"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={labelClass}>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state?.email}
          className={`${fieldClass} h-11 text-base font-normal`}
        />
      </label>
      <label className={labelClass}>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={`${fieldClass} h-11 text-base font-normal`}
        />
      </label>
      {state?.error && <Alert>{state.error}</Alert>}
      <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "mt-1 w-full")}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
