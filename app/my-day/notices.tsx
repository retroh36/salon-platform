"use client";

// Notices in the app for the signed-in stylist (a client they're taking on
// while someone's out, and its undo), until they tap Got it.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markNoticesRead } from "./actions";

export function Notices({ notices }: { notices: { id: string; body: string; when: string }[] }) {
  const [shown, setShown] = useState(notices);
  const [pending, start] = useTransition();
  if (!shown.length) return null;
  return (
    <section aria-label="Notices" className="mb-6 rounded-lg border border-line bg-info-soft p-4" data-testid="notices">
      <h2 className="mb-2 text-sm font-semibold text-ink">Changes to your day</h2>
      <ul className="mb-3 flex flex-col gap-1.5 text-sm text-ink">
        {shown.map((n) => (
          <li key={n.id}>
            {n.body} <span className="text-13 text-ink-muted">{n.when}</span>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await markNoticesRead(shown.map((n) => n.id));
            setShown([]);
          })
        }
      >
        Got it
      </Button>
    </section>
  );
}
