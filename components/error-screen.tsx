"use client";

import { useEffect, useState } from "react";
import { errorDetails, errorRef } from "@/lib/app-errors";
import { Button } from "@/components/ui/button";

// What anyone sees when a page fails: what happened in plain words, a
// reference to quote, Try again and Go back. A failure in the browser is
// reported so it's logged; one from the server already is (its digest
// gives the same reference as the log line).
export function ErrorScreen({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  const [ref] = useState(() => errorRef(digest));

  useEffect(() => {
    if (digest) return;
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref, path: window.location.pathname, ...errorDetails(error) }),
      keepalive: true,
    }).catch(() => {});
  }, [digest, error, ref]);

  return (
    <div role="alert" className="mx-auto my-16 max-w-md rounded-lg border border-line bg-surface p-6 text-ink" data-testid="error-screen">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-muted">
        This page couldn&apos;t finish loading or finish what you asked. Anything that was already saved is still saved. Check the connection and try again.
      </p>
      <p className="mt-3 text-sm text-ink-muted">
        If it keeps happening, quote this reference: <span className="font-mono font-medium text-ink" data-testid="error-ref">{ref}</span>
      </p>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" onClick={() => retry()}>
          Try again
        </Button>
        <Button onClick={() => history.back()}>Go back</Button>
      </div>
    </div>
  );
}
