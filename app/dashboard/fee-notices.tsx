import Link from "next/link";
import { Card } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { FEE_KIND_LABELS } from "@/lib/policy";
import { formatPrice } from "@/lib/services";
import { fullName } from "@/lib/staff";

// The front of house: late-cancel and no-show fees that didn't go through,
// so someone can try the card again or ask for another (on the client's
// profile). Amounts only for those who see money. Nothing to show,
// nothing shown.
export async function FeeNotices({ businessId, seesMoney }: { businessId: string; seesMoney: boolean }) {
  const { supabase } = await getCurrentStaff();
  const { data } = await supabase
    .from("policy_fees")
    .select("id, kind, fee_cents, from_deposit_cents, failure_reason, client:clients(id, first_name, last_name)")
    .eq("business_id", businessId)
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(20);
  if (!data?.length) return null;
  return (
    <Card title="Fees that didn't go through" titleId="fee-notices-heading" description="Try the card again, or send them a link to add another, from their profile." data-testid="fee-notices">
      <ul className="divide-y divide-line text-sm" aria-label="Failed fees">
        {data.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <Link href={`/clients/${f.client.id}`} className="font-medium text-link hover:underline">
              {fullName(f.client)}
            </Link>
            <span className="text-ink-muted">
              {FEE_KIND_LABELS[f.kind as "late_cancel" | "no_show"]} fee{seesMoney ? ` ${formatPrice(f.fee_cents - f.from_deposit_cents)}` : ""}
              {f.failure_reason ? ` · ${f.failure_reason}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
