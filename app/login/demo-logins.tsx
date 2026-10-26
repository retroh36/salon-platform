"use client";

import { useActionState } from "react";
import { demoSignIn } from "@/app/demo/actions";
import { Alert } from "@/components/ui/page";
import { DEMO_CLIENT, DEMO_LOGINS } from "@/lib/demo";

// The demo's sign-in: one tap for each role (app/demo/actions.ts).
export function DemoLogins() {
  const [state, action, pending] = useActionState(demoSignIn, undefined);
  const options = [
    ...DEMO_LOGINS.map((l) => ({ key: l.key, role: l.role, who: `${l.name} · ${l.salon}` })),
    { key: "client", role: "Client", who: `${DEMO_CLIENT.name} · Maple & Ash's booking site` },
  ];
  return (
    <form action={action} aria-label="Demo sign-in" className="flex flex-col gap-2">
      {options.map((o) => (
        <button
          key={o.key}
          type="submit"
          name="account"
          value={o.key}
          disabled={pending}
          className="touch-target flex min-h-12 w-full items-center gap-3 rounded-md border border-line-strong bg-surface px-4 py-2 text-left transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-55"
        >
          <span className="w-24 shrink-0 text-sm font-medium text-ink">{o.role}</span>
          <span className="min-w-0 text-sm font-normal text-ink-muted">{o.who}</span>
        </button>
      ))}
      {state?.error && <Alert>{state.error}</Alert>}
    </form>
  );
}
