"use client";

import { ErrorScreen } from "@/components/error-screen";

// Any page that fails: a friendly message with a reference, never a blank
// screen or a raw error.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
