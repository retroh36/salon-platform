import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { PhorestConfigError, readPhorestConfig } from "@/lib/import/phorest/config";
import { createPhorestClient, PhorestApiError, readOnlyFetch, ReadOnlyViolationError, type Fetch } from "@/lib/import/phorest/http";
import { FAKE_ENV } from "./fixtures";

const config = readPhorestConfig(FAKE_ENV);
const SECRETS = [FAKE_ENV.PHOREST_USERNAME, FAKE_ENV.PHOREST_PASSWORD, FAKE_ENV.PHOREST_BUSINESS_ID, "phorest.example.test", config.authorization];

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const status = (code: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json", ...headers } });

// The error a call fails with; fails the test if the call succeeds.
function failure(promise: Promise<unknown>): Promise<PhorestApiError> {
  return promise.then(
    () => {
      throw new Error("expected the request to fail");
    },
    (e: unknown) => e as PhorestApiError,
  );
}

// No real waiting in tests.
const noSleep = () => Promise.resolve();

function expectNoSecrets(text: string) {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

describe("read-only enforcement", () => {
  const OTHER_METHODS = ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE", "post", "Delete", "QUERY"];

  it.each(OTHER_METHODS)("refuses %s without sending anything", async (method) => {
    const underlying = vi.fn<Fetch>(async () => ok());
    const guarded = readOnlyFetch(underlying);
    await expect(guarded("https://phorest.example.test/x", { method })).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(underlying).not.toHaveBeenCalled();
  });

  it("refuses a GET with a body", async () => {
    const underlying = vi.fn<Fetch>(async () => ok());
    await expect(readOnlyFetch(underlying)("https://phorest.example.test/x", { method: "GET", body: "{}" })).rejects.toBeInstanceOf(
      ReadOnlyViolationError,
    );
    expect(underlying).not.toHaveBeenCalled();
  });

  it("allows GET, and sends it as GET", async () => {
    const underlying = vi.fn<Fetch>(async () => ok());
    await readOnlyFetch(underlying)("https://phorest.example.test/x", {});
    await readOnlyFetch(underlying)("https://phorest.example.test/x", { method: "get" });
    expect(underlying.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "GET"]);
  });

  it("the client only offers GET", () => {
    const client = createPhorestClient(config, { fetch: async () => ok() });
    expect(Object.keys(client).sort()).toEqual(["get", "stats"]);
  });

  it("every request the client makes is a GET, even if the fetch it's given would send anything", async () => {
    const methods: string[] = [];
    const client = createPhorestClient(config, {
      fetch: async (_url, init) => {
        methods.push(init.method!);
        return ok({});
      },
      sleep: noSleep,
    });
    await client.get("/branch");
    await client.get("/branch/{branchId}/staff", { params: { branchId: "B1" } });
    expect(methods).toEqual(["GET", "GET"]);
  });
});

describe("requests", () => {
  it("builds the URL under the business, with basic auth", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const client = createPhorestClient(config, {
      fetch: async (url, init) => {
        calls.push({ url, headers: new Headers(init.headers) });
        return ok({ hello: "world" });
      },
      sleep: noSleep,
    });
    const body = await client.get<{ hello: string }>("/branch/{branchId}/appointment", {
      params: { branchId: "BR 1/x" },
      query: { from_date: "2026-10-01", fetch_canceled: true, page: 0, unused: undefined },
    });
    expect(body).toEqual({ hello: "world" });
    expect(calls[0].url).toBe(
      "https://phorest.example.test/third-party-api-server/api/business/BIZfixture123/branch/BR%201%2Fx/appointment?from_date=2026-10-01&fetch_canceled=true&page=0",
    );
    const auth = calls[0].headers.get("authorization")!;
    // Special characters in the password survive intact.
    expect(Buffer.from(auth.replace(/^Basic /, ""), "base64").toString("utf8")).toBe(`${FAKE_ENV.PHOREST_USERNAME}:${FAKE_ENV.PHOREST_PASSWORD}`);
    expect(calls[0].headers.get("accept")).toBe("application/json");
  });

  it("errors name the endpoint template and status, never IDs, credentials or response details", async () => {
    const client = createPhorestClient(config, {
      fetch: async () => status(404, { errorCode: "BRANCH_NOT_FOUND", detail: `Branch for ${FAKE_ENV.PHOREST_BUSINESS_ID} client jane@example.test` }),
      sleep: noSleep,
    });
    const error = await failure(client.get("/branch/{branchId}/staff", { params: { branchId: "BRsecret" } }));
    expect(error).toBeInstanceOf(PhorestApiError);
    expect(error.message).toBe("Phorest API 404 on GET /api/business/{businessId}/branch/{branchId}/staff (BRANCH_NOT_FOUND)");
    expectNoSecrets(error.message + inspect(error));
    expect(error.message).not.toContain("BRsecret");
    expect(error.message).not.toContain("jane@example.test");
  });

  it("drops error codes that look like data", async () => {
    const client = createPhorestClient(config, { fetch: async () => status(400, { errorCode: "jane@example.test" }), sleep: noSleep });
    const error = await failure(client.get("/client"));
    expect(error.errorCode).toBeUndefined();
  });

  it("hides network error details, which can include the URL", async () => {
    const client = createPhorestClient(config, {
      fetch: async (url) => {
        throw new TypeError(`fetch failed for ${url}`);
      },
      sleep: noSleep,
      maxRetries: 1,
    });
    const error = await failure(client.get("/client"));
    expect(error).toBeInstanceOf(PhorestApiError);
    expect(error.errorCode).toBe("NETWORK_ERROR");
    expectNoSecrets(error.message + inspect(error));
  });
});

describe("rate limits and retries", () => {
  it("waits as long as Retry-After says, then retries", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const client = createPhorestClient(config, {
      fetch: async () => (++n === 1 ? status(429, { errorCode: "TOO_MANY_REQUESTS" }, { "retry-after": "2" }) : ok({ done: true })),
      sleep: async (ms) => void sleeps.push(ms),
      minIntervalMs: 0,
    });
    await expect(client.get("/client")).resolves.toEqual({ done: true });
    expect(sleeps).toContain(2000);
    expect(client.stats).toEqual({ requests: 2, retries: 1, rateLimited: 1 });
  });

  it("backs off on server errors and gives up after the retry limit", async () => {
    const sleeps: number[] = [];
    const client = createPhorestClient(config, {
      fetch: async () => status(503),
      sleep: async (ms) => void sleeps.push(ms),
      minIntervalMs: 0,
      maxRetries: 3,
    });
    const error = await failure(client.get("/client"));
    expect(error).toBeInstanceOf(PhorestApiError);
    expect(error.status).toBe(503);
    expect(client.stats.requests).toBe(4);
    // Each wait is longer than the last (allowing for jitter).
    expect(sleeps).toHaveLength(3);
    expect(sleeps[2]).toBeGreaterThan(sleeps[0]);
  });

  it("gives up on repeated 429s", async () => {
    const client = createPhorestClient(config, { fetch: async () => status(429), sleep: noSleep, minIntervalMs: 0, maxRetries: 2 });
    const error = await failure(client.get("/client"));
    expect(error.status).toBe(429);
    expect(client.stats.rateLimited).toBe(3);
  });

  it("doesn't retry client errors", async () => {
    let n = 0;
    const client = createPhorestClient(config, { fetch: async () => (n++, status(400)), sleep: noSleep });
    await failure(client.get("/client"));
    expect(n).toBe(1);
  });

  it("spaces requests out, even when they're made at the same time", async () => {
    let clock = 0;
    const sent: number[] = [];
    const client = createPhorestClient(config, {
      fetch: async () => (sent.push(clock), ok()),
      now: () => clock,
      sleep: async (ms) => void (clock += ms),
      minIntervalMs: 100,
    });
    await Promise.all([client.get("/a"), client.get("/b"), client.get("/c"), client.get("/d")]);
    expect(sent).toEqual([0, 100, 200, 300]);
  });
});

describe("config", () => {
  it("names missing variables without showing any values", () => {
    expect(() => readPhorestConfig({ PHOREST_USERNAME: "x" })).toThrow(
      new PhorestConfigError("Missing PHOREST_PASSWORD, PHOREST_BUSINESS_ID, PHOREST_BASE_URL (set them in .env.local)."),
    );
  });

  it("refuses plain http (the password would be sent in the clear), except to localhost", () => {
    expect(() => readPhorestConfig({ ...FAKE_ENV, PHOREST_BASE_URL: "http://api-gateway-us.phorest.com/third-party-api-server" })).toThrow(
      "PHOREST_BASE_URL must use https.",
    );
    expect(readPhorestConfig({ ...FAKE_ENV, PHOREST_BASE_URL: "http://localhost:9999" }).baseUrl).toBe("http://localhost:9999");
  });

  it("rejects a malformed URL without echoing it", () => {
    const error = (() => {
      try {
        readPhorestConfig({ ...FAKE_ENV, PHOREST_BASE_URL: "not a url with secret-ish text" });
      } catch (e) {
        return e as Error;
      }
    })()!;
    expect(error.message).toBe("PHOREST_BASE_URL isn't a valid URL.");
  });

  it("hides secrets when the config is logged or serialized", () => {
    expectNoSecrets(JSON.stringify(config));
    expectNoSecrets(inspect(config));
    expectNoSecrets(String(config));
    expectNoSecrets(`${JSON.stringify({ nested: { config } })}`);
  });
});
