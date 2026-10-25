// When something fails anywhere in the app: a short reference staff (or a
// client) can quote, matching the server's log line, and what's logged.
// The same reference comes from a server error's digest on both sides
// (the browser only ever sees the digest); a failure in the browser gets
// one of its own and is reported to /api/client-error. Logs carry what
// broke and where, never the request's data. Pure, so the browser can use
// it too.

export function errorRef(digest?: string | null): string {
  if (!digest) return `E-${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "0")}`;
  // FNV-1a: the same digest always gives the same reference.
  let hash = 0x811c9dc5;
  for (let i = 0; i < digest.length; i++) hash = Math.imul(hash ^ digest.charCodeAt(i), 0x01000193) >>> 0;
  return `E-${hash.toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

// One log line's details: the error's name, message and our first frames.
export function errorDetails(error: unknown): { name: string; message: string; stack?: string } {
  const e = error instanceof Error ? error : null;
  return {
    name: e?.name ?? typeof error,
    message: (e?.message ?? String(error)).slice(0, 300),
    ...(e?.stack ? { stack: e.stack.split("\n").slice(1, 6).map((l) => l.trim()).join(" | ").slice(0, 600) } : {}),
  };
}
