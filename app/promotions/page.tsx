import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { DeniseFace } from "@/components/denise";
import { buttonClass } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { Badge, EmptyState, PageHeader, Section } from "@/components/ui/page";
import { TableCard, actionsClass, numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { canSendAt } from "@/lib/automations";
import { can } from "@/lib/permissions";
import { loadOpeningIdeas, specialDraft } from "@/lib/promotion-ideas-load";
import { promotionSummary, type PromoKind } from "@/lib/promotions";
import { loadPromotions, promotionUses } from "@/lib/promotions-load";
import { loadPromotionResults } from "@/lib/reports-load";
import { formatDay } from "@/lib/schedule-format";
import { formatPrice } from "@/lib/services";
import { addDays, todayIn, toLocal } from "@/lib/scheduling/time";
import { isFrontOfHouse } from "@/lib/staff";
import { EndPromotion } from "./end-promotion";
import { SendSpecial } from "./send-special";

export const metadata: Metadata = { title: "Promotions" };

export default function PromotionsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Promotions />
    </Suspense>
  );
}

const KIND: Record<PromoKind, string> = { code: "Code", automatic: "Automatic", last_minute: "Last-minute special" };

// The front of house: live promotions (owners and managers set them up,
// and those who see Reports get each one's last 90 days), and Denise's
// ideas for open time: openings soon, with regulars who'd fit them and a
// message to send (our template, never AI-written).

const RESULT_DAYS = 90;
async function Promotions() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!isFrontOfHouse(me.role)) redirect("/dashboard");
  const now = new Date();
  const today = todayIn(me.location.timezone, now);
  const manage = can(me, "settings");
  const [rules, { special, ideas }, { data: staff }, { data: business }] = await Promise.all([
    loadPromotions(supabase, me.business_id, today),
    loadOpeningIdeas(supabase, me, now),
    supabase.from("staff").select("id, first_name").eq("business_id", me.business_id),
    supabase.from("businesses").select("free_text_roles").eq("id", me.business_id).single(),
  ]);
  const canWrite = me.role === "owner" || Boolean(business?.free_text_roles.includes(me.role));
  const [uses, results] = await Promise.all([
    promotionUses(supabase, rules.map((r) => r.id), null, null),
    can(me, "reports") ? loadPromotionResults(supabase, me.business_id, addDays(today, 1 - RESULT_DAYS), today, me.location.timezone) : Promise.resolve(null),
  ]);
  const resultOf = new Map((results ?? []).map((r) => [r.promotionId, r]));
  const { data: services } = await supabase.from("services").select("id, name").eq("business_id", me.business_id);
  const names = { services: Object.fromEntries((services ?? []).map((s) => [s.id, s.name])), staff: Object.fromEntries((staff ?? []).map((s) => [s.id, s.first_name])) };
  const sending = canSendAt(toLocal(now, me.location.timezone).minute);
  const drafts = special
    ? await Promise.all(
        ideas.flatMap((i) => i.clients.map(async (c) => [`${i.gap.staffId}:${i.gap.date}:${i.gap.start}:${c.clientId}`, (await specialDraft(supabase, me, { promotionId: special.id, clientId: c.clientId, staffId: i.gap.staffId, date: i.gap.date, start: i.gap.start }, now))?.body ?? ""] as const)),
      )
    : [];
  const draftOf = new Map(drafts);

  return (
    <AppShell section="promotions" me={me}>
      <PageHeader
        title="Promotions"
        description="Codes, offers that apply themselves at checkout, and last-minute specials for open time."
        actions={
          manage && (
            <Link href="/promotions/new" className={buttonClass("primary")}>
              <PlusIcon className="size-4" />
              New promotion
            </Link>
          )
        }
      />

      <section aria-labelledby="ideas-heading" className="mb-8 rounded-lg border border-denise-200 bg-denise-50" data-testid="opening-ideas">
        <div className="px-4 py-3">
          <h2 id="ideas-heading" className="flex items-center gap-2 text-base font-semibold text-denise-900">
            <DeniseFace size={24} />
            Ideas for open time
          </h2>
          <p className="mt-0.5 text-13 text-denise-700">
            {special
              ? `Openings in the next ${special.hoursAhead} hours, with regulars who are due back and said yes to offers. ${special.name}: ${promotionSummary(special, names)}.`
              : "Set up a last-minute special, and I'll suggest regulars to tell about openings."}
          </p>
        </div>
        {!special ? (
          <p className="border-t border-denise-200 px-4 py-3 text-sm text-denise-900">No last-minute special is running.</p>
        ) : ideas.length === 0 ? (
          <p className="border-t border-denise-200 px-4 py-3 text-sm text-denise-900">No openings of an hour or more coming up with a regular who fits. I&rsquo;ll keep looking.</p>
        ) : (
          <ul className="divide-y divide-denise-200 border-t border-denise-200">
            {ideas.map((i) => (
              <li key={`${i.gap.staffId}:${i.gap.date}:${i.gap.start}`} className="px-4 py-3" data-testid="opening-idea">
                <p className="text-sm font-semibold text-ink">
                  {i.staffName} is free {i.when}
                  <span className="font-normal text-ink-muted"> · {Math.floor((i.gap.end - i.gap.start) / 60)}h{(i.gap.end - i.gap.start) % 60 ? ` ${(i.gap.end - i.gap.start) % 60}m` : ""} open</span>
                </p>
                <ul className="mt-1 flex flex-col">
                  {i.clients.map((c) => (
                    <SendSpecial
                      key={c.clientId}
                      promotionId={special.id}
                      client={{ id: c.clientId, firstName: c.firstName, channel: c.channel!, overdueDays: c.overdueDays }}
                      gap={{ staffId: i.gap.staffId, date: i.gap.date, start: i.gap.start }}
                      draft={draftOf.get(`${i.gap.staffId}:${i.gap.date}:${i.gap.start}:${c.clientId}`) ?? ""}
                      canWrite={canWrite}
                      sending={sending}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Section title="Running now" titleId="promotions-heading" count={rules.length}>
        <TableCard>
          {rules.length === 0 ? (
            <EmptyState>No promotions yet.{manage ? " Create one to offer a code, an automatic offer or a last-minute special." : ""}</EmptyState>
          ) : (
            <table className={tableClass} aria-labelledby="promotions-heading">
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>Promotion</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Dates</th>
                  <th className={`${thClass} text-right`}>Used</th>
                  {manage && (
                    <th className={thClass}>
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className={trClass} data-testid="promotion-row">
                    <td className={`${tdClass} py-3`}>
                      <p className="font-medium text-ink">{r.name}</p>
                      <p className="text-13 text-ink-muted">{promotionSummary(r, names)}</p>
                      {results && <ResultLine result={resultOf.get(r.id)} lastMinute={r.kind === "last_minute"} />}
                    </td>
                    <td className={`${tdClass} py-3`}>
                      <Badge tone={r.kind === "last_minute" ? "warning" : r.kind === "automatic" ? "success" : "neutral"}>{r.kind === "code" ? `Code ${r.code}` : KIND[r.kind]}</Badge>
                    </td>
                    <td className={`${tdClass} py-3 whitespace-nowrap text-ink-muted`}>{[r.startsOn && `From ${formatDay(r.startsOn)}`, r.endsOn && `Until ${formatDay(r.endsOn)}`].filter(Boolean).join(" · ") || "Always"}</td>
                    <td className={`${tdClass} ${numClass} py-3`}>
                      {uses[r.id]?.uses ?? 0}
                      {r.maxUses ? <span className="text-ink-subtle"> of {r.maxUses}</span> : null}
                    </td>
                    {manage && (
                      <td className={actionsClass}>
                        <span className="inline-flex items-center gap-1">
                          <Link href={`/promotions/${r.id}`} className={buttonClass("quiet", "xs")}>
                            Edit
                          </Link>
                          <EndPromotion id={r.id} name={r.name} />
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </Section>
    </AppShell>
  );
}

// "Last 90 days: 58 sales · $5,210 in sales · $547.50 off · 58 openings
// filled · 4 first visits" (Reports' figures, for those who see Reports).
function ResultLine({ result, lastMinute }: { result: Awaited<ReturnType<typeof loadPromotionResults>>[number] | undefined; lastMinute: boolean }) {
  if (!result) return <p className="mt-1 text-13 text-ink-subtle" data-testid="promotion-results">Not used in the last {RESULT_DAYS} days.</p>;
  const parts = [
    `${result.redemptions} ${result.redemptions === 1 ? "sale" : "sales"}`,
    `${formatPrice(result.revenueCents)} in sales`,
    `${formatPrice(result.discountCents)} off`,
    lastMinute && `${result.gapsFilled} ${result.gapsFilled === 1 ? "opening" : "openings"} filled`,
    `${result.newClients} first ${result.newClients === 1 ? "visit" : "visits"}`,
  ].filter(Boolean);
  return (
    <p className="mt-1 text-13 text-ink tabular-nums" data-testid="promotion-results">
      <span className="text-ink-subtle">Last {RESULT_DAYS} days: </span>
      {parts.join(" · ")}
    </p>
  );
}
