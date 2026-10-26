"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { applySuggestedDuration, undoDuration } from "./actions";

export function DurationButton({ staffId, serviceId, suggested, undoActionId }: { staffId: string; serviceId: string; suggested: string | null; undoActionId: string | null }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (work: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await work();
      setMessage({ ok: r.ok, text: r.message });
    });
  return (
    <div className="flex flex-col items-end gap-1">
      {suggested ? (
        <Button size="xs" variant="secondary" disabled={pending} onClick={() => run(() => applySuggestedDuration(staffId, serviceId))}>
          Use {suggested}
        </Button>
      ) : undoActionId ? (
        <Button size="xs" variant="quiet" disabled={pending} onClick={() => run(() => undoDuration(undoActionId))}>
          Undo
        </Button>
      ) : (
        <span className="text-ink-subtle">—</span>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-xs ${message.ok ? "text-ink-muted" : "text-danger"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
