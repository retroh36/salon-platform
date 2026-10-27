import type { SupabaseClient } from "@supabase/supabase-js";
import { GiftIcon } from "@/components/ui/icons";
import { Badge, textLinkClass } from "@/components/ui/page";
import type { Database } from "@/lib/database.types";
import { can } from "@/lib/permissions";
import { nextTier, points, rewardProblem } from "@/lib/rewards";
import { loadClientRewards, loadPointsHistory, loadRewardSettings } from "@/lib/rewards-load";
import { formatDay } from "@/lib/schedule-format";
import { formatPrice } from "@/lib/services";
import { toLocal } from "@/lib/scheduling/time";
import { CopyButton } from "../copy-button";
import { Row, SideCard } from "../side-card";
import { AdjustPoints } from "./adjust-points";

// Rewards (front of house, when the program is on): their points and tier,
// a bar to the next tier, what they can take now as chips, their referral
// code to copy, every change to their points behind "View history", and
// adjusting them from the corner (with the adjust_points permission,
// always with a reason).
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
  // How far from this tier (or none) to the next.
  const from = tier?.threshold ?? 0;
  const progress = next ? Math.max(0, Math.min(1, 1 - next.toGo / (next.tier.threshold - from))) : 1;
  return (
    <SideCard
      title="Rewards"
      icon={<GiftIcon />}
      testId="client-rewards"
      opens={can(me, "adjust_points") ? { label: "Adjust points", form: <AdjustPoints clientId={clientId} /> } : undefined}
      note="Points come off at checkout. Tiers count the last 12 months."
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold tracking-[-0.015em] text-ink tabular-nums" data-testid="points-balance">
          {points(summary.balance)}
        </span>
        {tier && <Badge tone="info">{tier.name}</Badge>}
      </div>
      {next && (
        <div className="flex flex-col gap-1.5">
          <div
            role="progressbar"
            aria-label={`Progress to ${next.tier.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-1.5 overflow-hidden rounded-full bg-sunken"
          >
            <div className="h-full rounded-full bg-active" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="text-13 text-ink-muted" data-testid="next-tier">
            {toGo} to {next.tier.name}
          </p>
        </div>
      )}
      {available.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Rewards they can take now" data-testid="available-rewards">
          {available.map((r) => (
            <li key={r.id}>
              <Badge dot={false}>{r.name}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-13 text-ink-muted">{firstName} can&rsquo;t take a reward yet.</p>
      )}
      {summary.referralCode && (
        <dl>
          <Row label="Referral code">
            <span className="inline-flex items-center gap-1">
              <span className="font-medium tabular-nums" data-testid="referral-code">
                {summary.referralCode}
              </span>
              <CopyButton text={summary.referralCode} label="Copy" />
            </span>
          </Row>
        </dl>
      )}
      {history.length > 0 && (
        <details className="group">
          <summary className={`${textLinkClass} w-fit cursor-pointer list-none text-13 [&::-webkit-details-marker]:hidden`}>
            <span className="group-open:hidden">View history</span>
            <span className="hidden group-open:inline">Hide history</span>
          </summary>
          <ul className="mt-3 flex flex-col gap-1.5 text-13" data-testid="points-history">
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
    </SideCard>
  );
}
