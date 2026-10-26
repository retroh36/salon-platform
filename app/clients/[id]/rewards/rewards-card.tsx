import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge, Section } from "@/components/ui/page";
import type { Database } from "@/lib/database.types";
import { can } from "@/lib/permissions";
import { nextTier, points, rewardProblem } from "@/lib/rewards";
import { loadClientRewards, loadPointsHistory, loadRewardSettings } from "@/lib/rewards-load";
import { formatDay } from "@/lib/schedule-format";
import { formatPrice } from "@/lib/services";
import { toLocal } from "@/lib/scheduling/time";
import { AdjustPoints } from "./adjust-points";

// Rewards (front of house, when the program is on): their points, tier and
// how far to the next, what they can take now, their referral code, every
// change to their points with who and why, and adjusting them (with the
// adjust_points permission, always with a reason).
export async function RewardsCard({
  supabase,
  me,
  clientId,
  firstName,
  tz,
}: {
  supabase: SupabaseClient<Database>;
  me: { business_id: string; permissions: readonly string[] };
  clientId: string;
  firstName: string;
  tz: string;
}) {
  const settings = await loadRewardSettings(supabase, me.business_id);
  if (!settings.program.enabled) return null;
  const [summary, history] = await Promise.all([loadClientRewards(supabase, clientId), loadPointsHistory(supabase, clientId, 30)]);
  const tier = settings.tiers.find((t) => t.id === summary.tierId) ?? null;
  const next = nextTier(settings.tiers, summary.spendCents, summary.visits, settings.program.tierBasis);
  const available = settings.catalog.filter((r) => !rewardProblem(r, summary, settings.program, settings.tiers));
  const toGo = next ? (settings.program.tierBasis === "spend" ? `${formatPrice(next.toGo)} more` : `${next.toGo} more ${next.toGo === 1 ? "visit" : "visits"}`) : null;
  return (
    <Section title="Rewards" titleId="rewards-heading" description="Points come off at checkout. Tiers count the last 12 months.">
      <div className="divide-y divide-line border-y border-line" data-testid="client-rewards">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
          <span className="text-xl font-semibold text-ink tabular-nums" data-testid="points-balance">
            {points(summary.balance)}
          </span>
          {tier && <Badge tone="info">{tier.name}</Badge>}
          {next && (
            <span className="text-13 text-ink-muted">
              {toGo} to {next.tier.name}
            </span>
          )}
        </div>
        <p className="py-3 text-sm text-ink-muted">
          {available.length ? `Can take now: ${available.map((r) => r.name).join(", ")}.` : `${firstName} can't take a reward yet.`}
          {summary.referralCode && (
            <>
              {" "}
              Referral code <span className="font-medium text-ink tabular-nums">{summary.referralCode}</span>.
            </>
          )}
        </p>
        {can(me, "adjust_points") && (
          <div className="py-3">
            <AdjustPoints clientId={clientId} />
          </div>
        )}
        {history.length > 0 && (
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">Points history</summary>
            <ul className="mt-2 flex flex-col gap-1.5 text-13" data-testid="points-history">
              {history.map((h) => (
                <li key={h.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="text-ink">{h.label}</span>
                    <span className="text-ink-subtle">
                      {" "}
                      · {formatDay(toLocal(new Date(h.at), tz).date, true)}
                      {h.by ? ` · ${h.by}` : ""}
                      {h.reason ? ` · ${h.reason}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-ink tabular-nums">
                    {h.delta > 0 ? "+" : "−"}
                    {Math.abs(h.delta).toLocaleString("en-US")}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Section>
  );
}
