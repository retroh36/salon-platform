import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthScreen } from "@/app/login/auth-screen";
import { Alert } from "@/components/ui/page";
import { deviceTokenHash } from "@/lib/shared-device";
import { createAdminClient } from "@/lib/supabase/admin";
import { SwitchPad, type Person } from "./switch-pad";

export const metadata: Metadata = { title: "Who's at the desk?" };

export default function SwitchPage({ searchParams }: { searchParams: Promise<{ idle?: string }> }) {
  return (
    <Suspense>
      <Switch searchParams={searchParams} />
    </Suspense>
  );
}

// The shared front-desk iPad's lock screen: tap your name, enter your PIN.
// Only on a device an owner or manager marked as shared; anywhere else it's
// the ordinary sign-in.
async function Switch({ searchParams }: { searchParams: Promise<{ idle?: string }> }) {
  const hash = await deviceTokenHash();
  if (!hash) redirect("/login");
  const { data, error } = await createAdminClient().rpc("shared_device", { p_token_hash: hash });
  if (error) throw error;
  if (!data) redirect("/login");
  const device = data as { name: string; salon: string; auto_lock_minutes: number; staff: Person[] };
  const { idle } = await searchParams;
  return (
    <AuthScreen
      title="Who's at the desk?"
      subtitle={`${device.salon} · ${device.name}`}
      footer={
        <p className="mt-10 text-xs text-ink-subtle">
          No PIN yet? <Link href="/login" className="font-medium text-link hover:underline">Sign in with your password</Link>, then set one on Your account.
        </p>
      }
    >
      {idle && (
        <Alert tone="info" className="mb-4">
          Locked after {device.auto_lock_minutes} {device.auto_lock_minutes === 1 ? "minute" : "minutes"} with nobody using it.
        </Alert>
      )}
      {device.staff.length ? <SwitchPad people={device.staff} /> : <p className="text-ink-muted">Nobody here has a PIN yet.</p>}
    </AuthScreen>
  );
}
