"use client";

import Link from "next/link";
import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert, textLinkClass } from "@/components/ui/page";
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
      {/* "Forgot password?" sits on the label's line, where people look for
          it, outside the label so tapping it doesn't focus the field. */}
      <div className="relative">
        <Link href="/login/forgot" className={`${textLinkClass} absolute top-0 right-0 text-13`}>
          Forgot password?
        </Link>
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
      </div>
      {state?.error && <Alert>{state.error}</Alert>}
      <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "mt-1 w-full")}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
