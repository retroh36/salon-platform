import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { deviceTokenHash } from "@/lib/shared-device";
import { SettingsNav } from "../settings-nav";
import { AutoLockPicker, RemoveDevice, ShareThisDevice } from "./controls";

export const metadata: Metadata = { title: "Shared devices" };

export default function DevicesPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Devices />
    </Suspense>
  );
}

// The shared front-desk iPad: staff switch to themselves with a PIN rather
// than signing out and in, and it locks itself when nobody's using it.
async function Devices() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const hash = await deviceTokenHash();
  const [{ data: devices, error }, { data: b, error: bError }] = await Promise.all([
    supabase.from("shared_devices").select("id, name, token_hash, last_used_at, created_at").eq("business_id", me.business_id).is("revoked_at", null).order("created_at"),
    supabase.from("businesses").select("auto_lock_minutes").eq("id", me.business_id).single(),
  ]);
  if (error) throw error;
  if (bError) throw bError;
  const thisOne = devices.find((d) => d.token_hash === hash);
  const tz = me.location.timezone;
  const when = (at: string) => {
    const l = toLocal(new Date(at), tz);
    return `${formatDay(l.date)} at ${formatMinute(l.minute)}`;
  };

  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Settings" description="Shared devices: the front desk iPad, where staff switch to themselves with a PIN instead of signing in and out." />
      <SettingsNav current="devices" me={me} />
      <Card title="This device" titleId="this-device-heading" description="On a shared device, signing out shows the PIN screen. Each person sets their own PIN on Your account.">
        <ShareThisDevice shared={Boolean(thisOne)} />
      </Card>
      <Card title="Shared devices" titleId="devices-heading" flush>
        {devices.length ? (
          <ul className="divide-y divide-line" data-testid="shared-devices">
            {devices.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-ink">
                    {d.name}
                    {d === thisOne && <Badge tone="info" className="ml-2 align-middle">This device</Badge>}
                  </p>
                  <p className="text-13 text-ink-muted">{d.last_used_at ? `Last switch ${when(d.last_used_at)}` : "Not used yet"}</p>
                </div>
                <RemoveDevice id={d.id} name={d.name} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No shared devices yet.</EmptyState>
        )}
      </Card>
      <Card title="Locking" titleId="locking-heading" description="So the next person at the desk can't carry on as whoever was there.">
        <AutoLockPicker value={b.auto_lock_minutes} />
      </Card>
    </AppShell>
  );
}
