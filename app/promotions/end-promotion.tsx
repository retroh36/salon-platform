"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { archivePromotion } from "./actions";

// Ending a promotion: asked first. It stays in reports.
export function EndPromotion({ id, name }: { id: string; name: string }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!asking)
    return (
      <Button size="xs" variant="danger-quiet" onClick={() => setAsking(true)}>
        End
      </Button>
    );
  return (
    <span className="flex flex-wrap items-center gap-2" role="group" aria-label={`End ${name}`}>
      <span className="text-13 text-ink">End it? It can&rsquo;t be used again.</span>
      <Button size="xs" variant="danger" disabled={pending} onClick={() => start(async () => void setError((await archivePromotion(id)).ok ? null : "Couldn't end it. Try again."))}>
        Yes, end it
      </Button>
      <Button size="xs" onClick={() => setAsking(false)}>
        Keep it
      </Button>
      {error && <span className="text-13 text-danger">{error}</span>}
    </span>
  );
}
