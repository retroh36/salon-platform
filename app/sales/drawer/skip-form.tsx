"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { skipDrawerCount, type DrawerResult } from "./actions";

// A manager lets today's cash go ahead without the opening count, with a
// reason. `signIn`: the person here isn't a manager, so one signs in on the
// spot.
export function SkipCountForm({ signIn, onDone }: { signIn: boolean; onDone?: () => void }) {
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<DrawerResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Skip the opening count"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await skipDrawerCount(reason, email, password);
          setResult(r);
          setPassword("");
          if (r.ok) onDone?.();
        });
      }}
    >
      <label className={labelClass}>
        Why isn&rsquo;t it being counted?
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} maxLength={300} minLength={3} required />
      </label>
      {signIn && (
        <div className="flex flex-wrap gap-3">
          <label className={`${labelClass} min-w-48 flex-1`}>
            Manager&rsquo;s email
            <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} required />
          </label>
          <label className={`${labelClass} min-w-48 flex-1`}>
            Manager&rsquo;s password
            <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} required />
          </label>
        </div>
      )}
      <div>
        <Button type="submit" disabled={pending || reason.trim().length < 3}>
          {pending ? "Saving…" : "Skip the count"}
        </Button>
      </div>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
