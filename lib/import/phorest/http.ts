// Read-only HTTP client for the Phorest API.
//
// Phorest has no sandbox, so the importer must never change anything there.
// This client is the only code that talks to Phorest, and it only sends GET:
//   1. `get()` is the only request method it exposes, and
//   2. every request goes through `readOnlyFetch`, which refuses any other
//      method before anything is sent, whatever the caller passes.
// tests/unit/phorest/http.test.ts proves both.
//
// It also spaces out requests (Phorest allows 100 per second; we stay well
// under), retries rate-limit (429) and server errors with backoff, and keeps
// credentials and IDs out of every error message.

import type { PhorestConfig } from "./config.ts";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class ReadOnlyViolationError extends Error {
  name = "ReadOnlyViolationError";
}

// Status and endpoint only: response bodies can contain client data.
// (Plain fields rather than constructor parameter properties, which Node's
// built-in TypeScript support doesn't accept.)
export class PhorestApiError extends Error {
  name = "PhorestApiError";
  readonly status: number;
  readonly endpoint: string;
  readonly errorCode?: string;

  constructor(status: number, endpoint: string, errorCode?: string) {
    super(`Phorest API ${status} on GET ${endpoint}${errorCode ? ` (${errorCode})` : ""}`);
    this.status = status;
    this.endpoint = endpoint;
    this.errorCode = errorCode;
  }
}

export type RequestStats = { requests: number; retries: number; rateLimited: number };

export type PhorestClientOptions = {
  fetch?: Fetch;
  // Minimum gap between requests. 100ms is 10 per second.
  minIntervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type Query = Record<string, string | number | boolean | undefined>;

export type PhorestClient = {
  // `path` is relative to the business, e.g. "/branch" or
  // "/branch/{branchId}/staff" with `params` filling the placeholders.
  get<T>(path: string, options?: { params?: Record<string, string>; query?: Query }): Promise<T>;
  readonly stats: Readonly<RequestStats>;
};

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// Wraps fetch so that only GET can ever be sent.
export function readOnlyFetch(fetchImpl: Fetch): Fetch {
  return (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      return Promise.reject(new ReadOnlyViolationError(`Refused ${method}: the Phorest importer only sends GET requests.`));
    }
    if (init.body != null) {
      return Promise.reject(new ReadOnlyViolationError("Refused a request body: the Phorest importer only sends GET requests."));
    }
    return fetchImpl(url, { ...init, method: "GET" });
  };
}

export function createPhorestClient(config: PhorestConfig, options: PhorestClientOptions = {}): PhorestClient {
  const send = readOnlyFetch(options.fetch ?? ((url, init) => fetch(url, init)));
  const minIntervalMs = options.minIntervalMs ?? 100;
  const maxRetries = options.maxRetries ?? 5;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());
  const stats: RequestStats = { requests: 0, retries: 0, rateLimited: 0 };

  // Requests are serialized: each waits for the previous slot.
  let nextSlot = 0;
  let queue = Promise.resolve();
  const throttle = () => {
    const turn = queue.then(async () => {
      const wait = nextSlot - now();
      if (wait > 0) await sleep(wait);
      nextSlot = now() + minIntervalMs;
    });
    queue = turn.catch(() => {});
    return turn;
  };

  async function get<T>(path: string, { params = {}, query = {} }: { params?: Record<string, string>; query?: Query } = {}): Promise<T> {
    if (!path.startsWith("/")) throw new Error("Paths start with /");
    const filled = path.replace(/\{(\w+)\}/g, (_, name: string) => {
      if (!(name in params)) throw new Error(`Missing path parameter ${name}`);
      return encodeURIComponent(params[name]);
    });
    const url = new URL(`${config.baseUrl}/api/business/${encodeURIComponent(config.businessId)}${filled}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));

    // For errors: the template, never the filled-in IDs.
    const endpoint = `/api/business/{businessId}${path}`;

    for (let attempt = 0; ; attempt++) {
      await throttle();
      stats.requests++;
      let response: Response;
      try {
        response = await send(url.href, {
          method: "GET",
          headers: { Authorization: config.authorization, Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (error instanceof ReadOnlyViolationError) throw error;
        // Network error or timeout. Don't pass the original on: it can
        // include the URL.
        if (attempt < maxRetries) {
          stats.retries++;
          await sleep(backoff(attempt));
          continue;
        }
        throw new PhorestApiError(0, endpoint, "NETWORK_ERROR");
      }

      if (response.ok) return (await response.json()) as T;

      if (response.status === 429) stats.rateLimited++;
      if (RETRYABLE.has(response.status) && attempt < maxRetries) {
        stats.retries++;
        await response.body?.cancel();
        await sleep(retryAfterMs(response) ?? backoff(attempt));
        continue;
      }
      throw new PhorestApiError(response.status, endpoint, await errorCode(response));
    }
  }

  return { get, stats };
}

// 0.5s, 1s, 2s, 4s, 8s ... capped at 30s, with jitter.
function backoff(attempt: number) {
  return Math.min(30_000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(60_000, Math.max(0, seconds * 1000));
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.min(60_000, Math.max(0, date - Date.now()));
}

// Phorest's machine-readable error code only; `detail` can echo request data.
async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { errorCode?: unknown };
    return typeof body.errorCode === "string" && /^[A-Z0-9_]{1,64}$/.test(body.errorCode) ? body.errorCode : undefined;
  } catch {
    return undefined;
  }
}
