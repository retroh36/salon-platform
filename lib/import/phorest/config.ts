// Phorest connection settings, from environment variables only.
//
// The values are secrets: nothing here returns or logs them. The config
// object hides them from JSON.stringify and console.log, and errors only
// name which variable is wrong.

export type PhorestConfig = {
  readonly baseUrl: string;
  readonly businessId: string;
  // "Basic <base64>", built once so the raw username and password aren't kept.
  readonly authorization: string;
};

export class PhorestConfigError extends Error {
  name = "PhorestConfigError";
}

const REDACTED = "[redacted]";

export function readPhorestConfig(env: Record<string, string | undefined> = process.env): PhorestConfig {
  const missing = ["PHOREST_USERNAME", "PHOREST_PASSWORD", "PHOREST_BUSINESS_ID", "PHOREST_BASE_URL"].filter((k) => !env[k]);
  if (missing.length) throw new PhorestConfigError(`Missing ${missing.join(", ")} (set them in .env.local).`);

  let url: URL;
  try {
    url = new URL(env.PHOREST_BASE_URL!);
  } catch {
    throw new PhorestConfigError("PHOREST_BASE_URL isn't a valid URL.");
  }
  // Basic auth over plain HTTP would send the password in the clear.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost(url.hostname))) {
    throw new PhorestConfigError("PHOREST_BASE_URL must use https.");
  }
  if (url.search || url.hash) throw new PhorestConfigError("PHOREST_BASE_URL must not include a query string or fragment.");

  const authorization = `Basic ${Buffer.from(`${env.PHOREST_USERNAME}:${env.PHOREST_PASSWORD}`, "utf8").toString("base64")}`;
  return hideSecrets({
    baseUrl: url.href.replace(/\/+$/, ""),
    businessId: env.PHOREST_BUSINESS_ID!,
    authorization,
  });
}

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function hideSecrets(config: PhorestConfig): PhorestConfig {
  const hidden = { baseUrl: REDACTED, businessId: REDACTED, authorization: REDACTED };
  return Object.freeze(
    Object.defineProperties(
      { ...config },
      {
        toJSON: { value: () => hidden, enumerable: false },
        [Symbol.for("nodejs.util.inspect.custom")]: { value: () => `PhorestConfig ${JSON.stringify(hidden)}`, enumerable: false },
      },
    ),
  ) as PhorestConfig;
}
