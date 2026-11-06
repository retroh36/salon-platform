import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { messagingStatus } from "@/lib/messaging/status";
import { can } from "@/lib/permissions";
import { SettingsNav } from "../settings-nav";
import { MessagesConnection } from "./connection";
import { FreeTextRoles } from "./free-text-roles";
import { MoveMessageDefault } from "./move-default";
import { ReminderSettings } from "./reminders";
import { DEFAULT_REMINDER_HOURS, isReminderHours } from "@/lib/reminders";

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
  const { data: b, error } = await supabase
    .from("businesses")
    .select("name, free_text_roles, move_message_default, messages_live, reminders_on, reminder_hours, online_booking_settings(enabled), locations(id, phone)")
    .eq("id", me.business_id)
    .single();
  if (error) throw error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Messages" description="What your team can send clients from booking details. Clients only get messages they've agreed to, and a text STOP is always honored." />
      <SettingsNav current="messages" me={me} />
      <Card
        title="Texts and email"
        titleId="messages-connection-heading"
        description="Until you go live, every text and email waits in the outbox and nothing reaches a client. Going live needs texts or email connected first, which the Maestra team does."
      >
        <MessagesConnection status={messagingStatus({ messages_live: b.messages_live })} canChange={can(me, "billing")} />
      </Card>
      <Card
        title="Writing their own messages"
        titleId="free-text-heading"
        description="Everyone who can message a client can use the quick picks. Choose who can also write their own. Owners always can. Denise never writes to clients."
      >
        <FreeTextRoles roles={b.free_text_roles} canChange={me.role === "owner"} />
      </Card>
      <Card
        title="When a visit is moved"
        titleId="move-message-heading"
        description="When someone drags or edits a visit's time, stylist or date, the calendar asks whether to let the client know, with the message. Choose which answer comes first. Nothing goes to a client until someone taps Send."
      >
        <MoveMessageDefault value={b.move_message_default === "skip" ? "skip" : "send"} />
      </Card>
      <Card
        title="Appointment reminders"
        titleId="reminders-heading"
        description="A reminder before each visit, in the words below, filled in for the visit. It goes by text or email, whichever the client gets messages about their visits on, once for each visit, between 9am and 8pm."
      >
        <ReminderSettings
          on={b.reminders_on}
          hours={isReminderHours(b.reminder_hours) ? b.reminder_hours : DEFAULT_REMINDER_HOURS}
          salon={b.name}
          online={Boolean(b.online_booking_settings?.enabled)}
          phone={b.locations.find((l) => l.id === me.location.id)?.phone ?? null}
        />
      </Card>
    </AppShell>
  );
}
