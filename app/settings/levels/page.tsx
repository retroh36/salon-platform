import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SettingsNav } from "../settings-nav";
import { LevelsEditor } from "./levels-editor";

export const metadata: Metadata = { title: "Levels" };

export default function LevelsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Levels />
    </Suspense>
  );
}

// The salon's stylist levels: their names, order, colors and badges.
async function Levels() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const { data: team, error } = await supabase.from("staff").select("level").eq("business_id", me.business_id).eq("is_active", true).not("level", "is", null);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const s of team) if (s.level) counts[s.level] = (counts[s.level] ?? 0) + 1;

  return (
    <AppShell section="settings" me={me}>
      <PageHeader
        title="Levels"
        description="Your stylists' levels, most senior first. Each level has its own color and badge on the calendar and the booking site, and can have its own prices on Services."
      />
      <SettingsNav current="levels" me={me} />
      <LevelsEditor levels={me.levels} counts={counts} />
    </AppShell>
  );
}
