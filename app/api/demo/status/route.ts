// The public demo's settings at a glance, for `npm run demo:db -- check
// <app url>`: whether each thing is set, yes or no, never a value, and the
// commit it was built from (Vercel's VERCEL_GIT_COMMIT_SHA), so
// `npm run release:demo` knows when a release is live. Only in the demo;
// anywhere else it isn't there.

import { isDemo } from "@/lib/demo";

export function GET() {
  if (!isDemo()) return new Response("Not found", { status: 404 });
  const set = (name: string) => !!process.env[name]?.trim();
  return Response.json(
    {
      demoMode: true,
      supabase: set("NEXT_PUBLIC_SUPABASE_URL") && set("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") && set("SUPABASE_SECRET_KEY"),
      siteUrl: set("NEXT_PUBLIC_SITE_URL"),
      denise: set("ANTHROPIC_API_KEY"),
      cronSecret: set("CRON_SECRET"),
      // Never in the demo: the importer's credentials, and real payments.
      phorest: Object.keys(process.env).some((name) => name.startsWith("PHOREST_") && set(name)),
      stripe: set("STRIPE_SECRET_KEY"),
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
