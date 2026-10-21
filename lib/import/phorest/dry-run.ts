// Dry run against the real Phorest API: fetch everything (GET only), map it,
// and report counts and mapping issues. Saves nothing and prints no record
// data, credentials or IDs.

import { addDays, todayIn } from "../../scheduling/time.ts";
import { readPhorestConfig } from "./config.ts";
import { fetchPhorestData } from "./fetch.ts";
import { createPhorestClient, type Fetch } from "./http.ts";
import { mapPhorestData } from "./map/index.ts";
import { buildReport, type DryRunReport } from "./report.ts";

export type DryRunOptions = {
  env?: Record<string, string | undefined>;
  fetch?: Fetch;
  // How much appointment history to include, and how far ahead.
  monthsBack?: number;
  monthsAhead?: number;
  // Rostered weeks sampled to work out each stylist's usual week.
  timetableWeeks?: number;
  // Date windows use this timezone until the branches are known.
  timeZone?: string;
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export async function runDryRun(options: DryRunOptions = {}): Promise<DryRunReport> {
  const config = readPhorestConfig(options.env);
  const client = createPhorestClient(config, { fetch: options.fetch, minIntervalMs: options.minIntervalMs, sleep: options.sleep });

  const today = todayIn(options.timeZone ?? "America/Chicago");
  const timetableFrom = today;
  const timetableTo = addDays(today, 7 * (options.timetableWeeks ?? 4) - 1);
  const data = await fetchPhorestData(client, {
    appointmentsFrom: addDays(today, -Math.round(30.44 * (options.monthsBack ?? 24))),
    appointmentsTo: addDays(today, Math.round(30.44 * (options.monthsAhead ?? 12))),
    timetableFrom,
    timetableTo,
  });
  const { plan, issues } = mapPhorestData(data, { today, timetableFrom, timetableTo });
  return buildReport(data, plan, issues, client.stats);
}
