// npm run insights
//
// Recalculates what Denise has learned (lib/insights/) for every salon and
// stores it. The same job runs nightly (/api/cron/insights). Prints counts
// only.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types.ts";
import { computeInsights } from "../lib/insights/compute.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the environment.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const admin = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: businesses, error } = await admin.from("businesses").select("id, name");
if (error) throw error;
for (const b of businesses) {
  const started = Date.now();
  const counts = await computeInsights(admin, b.id);
  console.log(`${b.name}: ${counts.durations} stylist durations, ${counts.clients} clients, ${counts.locations} locations (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}
