import Link from "next/link";
import { ChevronDownIcon } from "@/components/ui/icons";
import { Card, nameLinkClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { FEE_KIND_LABELS } from "@/lib/policy";
import { formatPrice } from "@/lib/services";
import { fullName } from "@/lib/staff";

// The front of house: late-cancel and no-show fees that didn't go through,
// so someone can try the card again or ask for another (on the client's
// profile). Amounts only for those who see money. Nothing to show,
// nothing shown. The newest five show; the rest open under "Show 7 more", so
// a run of declined cards doesn't push the day below the fold.
const SHOWN = 5;

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
  const row = (f: (typeof data)[number]) => (
    <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
      <Link href={`/clients/${f.client.id}`} className={nameLinkClass}>
        {fullName(f.client)}
      </Link>
      <span className="text-13 text-ink-muted tabular-nums">
        {FEE_KIND_LABELS[f.kind as "late_cancel" | "no_show"]} fee{seesMoney ? ` ${formatPrice(f.fee_cents - f.from_deposit_cents)}` : ""}
        {f.failure_reason ? ` · ${f.failure_reason}` : ""}
      </span>
    </li>
  );
  return (
    <Card title="Fees that didn't go through" titleId="fee-notices-heading" description="Try the card again, or send them a link to add another, from their profile." data-testid="fee-notices" flush>
      <ul className="divide-y divide-line text-sm" aria-label="Failed fees">
        {data.slice(0, SHOWN).map(row)}
      </ul>
      {data.length > SHOWN && (
        <details className="group border-t border-line">
          <summary className="flex w-full cursor-pointer list-none items-center gap-1 px-4 py-3 text-sm font-medium text-link hover:text-link-hover [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show {data.length - SHOWN} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
            <ChevronDownIcon className="size-4 group-open:rotate-180" />
          </summary>
          <ul className="divide-y divide-line border-t border-line text-sm" aria-label="More failed fees">
            {data.slice(SHOWN).map(row)}
          </ul>
        </details>
      )}
    </Card>
  );
}
