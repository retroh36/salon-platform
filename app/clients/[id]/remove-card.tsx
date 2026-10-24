"use client";

import { useState, useTransition } from "react";
import { removeCard } from "@/app/policy/actions";
import { Button } from "@/components/ui/button";

// Takes the card off file, after asking.
export function RemoveCardButton({ clientId, label }: { clientId: string; label: string }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  if (!asking)
    return (
      <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
        Remove card
      </Button>
    );
  return (
    <div role="group" aria-label="Remove card" className="flex flex-wrap items-center gap-2 text-sm">
      Remove {label}? Fees can&rsquo;t be charged without one.
      <Button size="sm" variant="danger" disabled={pending} onClick={() => start(async () => void (await removeCard(clientId)))}>
        Remove
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Keep it
      </Button>
    </div>
  );
}
