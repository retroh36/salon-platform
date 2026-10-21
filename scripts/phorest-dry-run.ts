// npm run import:phorest:dry-run [-- --months-back=24 --months-ahead=12]
//
// Calls the real Phorest API with GET requests only, maps the data and
// prints record counts and mapping issues. Saves nothing and prints no
// client data, credentials or IDs.

import { PhorestConfigError } from "../lib/import/phorest/config.ts";
import { runDryRun } from "../lib/import/phorest/dry-run.ts";
import { PhorestApiError, ReadOnlyViolationError } from "../lib/import/phorest/http.ts";
import { formatReport } from "../lib/import/phorest/report.ts";

function numberArg(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const n = Number(arg.split("=")[1]);
  if (!Number.isInteger(n) || n < 0 || n > 120) throw new Error(`--${name} must be a whole number of months (0-120)`);
  return n;
}

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the environment.
}

try {
  const report = await runDryRun({ monthsBack: numberArg("months-back", 24), monthsAhead: numberArg("months-ahead", 12) });
  console.log(formatReport(report));
} catch (error) {
  // Only messages we wrote, which contain no secrets or record data.
  if (error instanceof PhorestConfigError || error instanceof PhorestApiError || error instanceof ReadOnlyViolationError) {
    console.error(`Dry run failed: ${error.message}`);
  } else {
    console.error(`Dry run failed: ${error instanceof Error ? error.name : "unknown error"} (details hidden in case they contain data)`);
  }
  process.exitCode = 1;
}
