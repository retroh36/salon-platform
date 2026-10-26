import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SettingsNav } from "../settings-nav";
import { FreeTextRoles } from "./free-text-roles";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesSettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <MessagesSettings />
    </Suspense>
  );
}

// Who can write their own messages to clients in Message client (owners
// always can; everyone can use the quick picks). Denise never writes to
// or messages clients.
async function MessagesSettings() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const { data: b, error } = await supabase.from("businesses").select("free_text_roles").eq("id", me.business_id).single();
  if (error) throw error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Messages" description="What your team can send clients from booking details. Clients only get messages they've agreed to, and a text STOP is always honored." />
      <SettingsNav current="messages" me={me} />
      <Card
        title="Writing their own messages"
        titleId="free-text-heading"
        description="Everyone who can message a client can use the quick picks. Choose who can also write their own. Owners always can. Denise never writes to clients."
      >
        <FreeTextRoles roles={b.free_text_roles} canChange={me.role === "owner"} />
      </Card>
    </AppShell>
  );
}
