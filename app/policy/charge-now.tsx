"use client";

import { useState, useTransition } from "react";
import { chargeDueFeesNow } from "@/app/settings/policies/actions";
import { Button } from "@/components/ui/button";

// Owners: charge fees whose 10 minutes are up now, rather than at the next
// run (every 15 minutes).
export function ChargeNowButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => start(async () => setMessage((await chargeDueFeesNow()).message))}>
        Charge due fees now
      </Button>
      {message && (
        <span role="status" className="text-sm text-ink-muted">
          {message}
        </span>
      )}
    </span>
  );
}
