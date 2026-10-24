import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { roleLabel } from "@/lib/staff";
import { PERMISSIONS, can } from "@/lib/permissions";
import { PinForm } from "./pin-form";

export const metadata: Metadata = { title: "Your account" };

export default function AccountPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Account />
    </Suspense>
  );
}

// Anyone's own account: their PIN for the shared iPad, their password, and
// what their role lets them do.
async function Account() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  const { data: withPins, error } = await supabase.rpc("staff_with_pins", { p_business_id: me.business_id });
  if (error) throw error;
  const extras = PERMISSIONS.filter((p) => can(me, p.key));
  return (
    <AppShell section="account" me={me}>
      <PageHeader title="Your account" description={`${me.first_name}, ${roleLabel(me.role).toLowerCase()} at ${me.location.business?.name ?? "the salon"}.`} />
      <Card title="Your PIN" titleId="pin-heading" description="For switching in on the salon's shared iPad without your password.">
        <PinForm hasPin={(withPins ?? []).includes(me.id)} />
      </Card>
      <Card title="Password" titleId="password-heading">
        <Link href="/account/password" className="text-sm font-medium text-link hover:underline">
          Change your password
        </Link>
      </Card>
      <Card title="What you can do" titleId="can-heading" description="Set by your role, and by the owner for you. Ask an owner to change it.">
        {extras.length ? (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm" data-testid="my-permissions">
            {extras.map((p) => (
              <li key={p.key}>{p.label}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">Your day, your clients and your own numbers.</p>
        )}
      </Card>
    </AppShell>
  );
}
