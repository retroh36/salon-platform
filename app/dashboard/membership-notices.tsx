import Link from "next/link";
import { Card } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate } from "@/lib/clients";
import { priceText, type IntervalUnit } from "@/lib/memberships";
import { toLocal } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";

// The front of house: membership payments that didn't go through, so
// someone can ask for a new card before the retries run out. Nothing to
// show, nothing shown.
export async function MembershipNotices({ businessId }: { businessId: string }) {
  const { supabase } = await getCurrentStaff();
  const { data } = await supabase
    .from("client_memberships")
    .select("id, name, price_cents, interval_unit, interval_count, failed_attempts, next_retry_at, location:locations(timezone), client:clients(id, first_name, last_name)")
    .eq("business_id", businessId)
    .eq("status", "past_due")
    .order("next_retry_at")
    .limit(20);
  if (!data?.length) return null;
  return (
    <Card title="Membership payments that failed" titleId="membership-notices-heading" description="Ask for a new card (on their profile); the payment is tried again on it straight away." data-testid="membership-notices">
      <ul className="divide-y divide-line text-sm" aria-label="Failed membership payments">
        {data.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <Link href={`/clients/${m.client.id}`} className="font-medium text-link hover:underline">
              {fullName(m.client)}
            </Link>
            <span className="text-ink-muted">
              {m.name}, {priceText(m.price_cents, m.interval_unit as IntervalUnit, m.interval_count)} · {m.failed_attempts} {m.failed_attempts === 1 ? "try" : "tries"}
              {m.next_retry_at ? ` · next try ${formatDate(toLocal(new Date(m.next_retry_at), m.location.timezone).date)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
