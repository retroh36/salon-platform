import { errorDetails, errorRef } from "@/lib/app-errors";

// Every error a page, server action or route handler throws, as one log
// line with the reference the error page shows (from the digest). The path
// without its query, never headers or bodies.
export async function onRequestError(error: unknown, request: Readonly<{ path: string; method: string }>, context: Readonly<{ routeType: string; routePath: string }>) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  const ref = errorRef(typeof digest === "string" ? digest : null);
  console.error("[app]", JSON.stringify({ ref, where: context.routeType, route: context.routePath, method: request.method, path: request.path.split("?")[0], ...errorDetails(error) }));
}
