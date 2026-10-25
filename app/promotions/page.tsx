import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { DeniseFace } from "@/components/denise";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, listClass, PageHeader, rowClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { canSendAt } from "@/lib/automations";
import { can } from "@/lib/permissions";
import { loadOpeningIdeas, specialDraft } from "@/lib/promotion-ideas-load";
import { promotionSummary, type PromoKind } from "@/lib/promotions";
import { loadPromotions, promotionUses } from "@/lib/promotions-load";
import { formatDay } from "@/lib/schedule-format";
import { todayIn, toLocal } from "@/lib/scheduling/time";
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

// The front of house: live promotions (owners and managers set them up),
// and Denise's ideas for open time: openings soon, with regulars who'd fit
// them and a message to send (our template, never AI-written).
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
  const uses = await promotionUses(supabase, rules.map((r) => r.id), null, null);
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
              New promotion
            </Link>
          )
        }
      />

      <Card
        title={
          <span className="flex items-center gap-2">
            <DeniseFace size={24} />
            Ideas for open time
          </span>
        }
        titleId="ideas-heading"
        description={
          special
            ? `Openings in the next ${special.hoursAhead} hours, with regulars who are due back and said yes to offers. ${special.name}: ${promotionSummary(special, names)}.`
            : "Set up a last-minute special, and I'll suggest regulars to tell about openings."
        }
        flush
        data-testid="opening-ideas"
      >
        {!special ? (
          <EmptyState>No last-minute special is running.</EmptyState>
        ) : ideas.length === 0 ? (
          <EmptyState>No openings of an hour or more coming up with a regular who fits. I&rsquo;ll keep looking.</EmptyState>
        ) : (
          <ul className={listClass}>
            {ideas.map((i) => (
              <li key={`${i.gap.staffId}:${i.gap.date}:${i.gap.start}`} className={rowClass} data-testid="opening-idea">
                <p className="font-semibold text-ink">
                  {i.staffName} is free {i.when}
                  <span className="font-normal text-ink-muted"> · {Math.floor((i.gap.end - i.gap.start) / 60)}h{(i.gap.end - i.gap.start) % 60 ? ` ${(i.gap.end - i.gap.start) % 60}m` : ""} open</span>
                </p>
                <ul className="mt-2 flex flex-col gap-2">
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
      </Card>

      <Card title="Running now" titleId="promotions-heading" flush>
        {rules.length === 0 ? (
          <EmptyState>No promotions yet.{manage ? " Create one to offer a code, an automatic offer or a last-minute special." : ""}</EmptyState>
        ) : (
          <ul className={listClass} aria-labelledby="promotions-heading">
            {rules.map((r) => (
              <li key={r.id} className={`${rowClass} flex flex-wrap items-center gap-3`} data-testid="promotion-row">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                    {r.name}
                    <Badge tone={r.kind === "last_minute" ? "amber" : r.kind === "automatic" ? "green" : "navy"}>{r.kind === "code" ? `Code ${r.code}` : KIND[r.kind]}</Badge>
                  </p>
                  <p className="text-sm text-ink-muted">{promotionSummary(r, names)}</p>
                  <p className="text-xs text-ink-muted">
                    {[
                      r.startsOn && `from ${formatDay(r.startsOn)}`,
                      r.endsOn && `until ${formatDay(r.endsOn)}`,
                      `${uses[r.id]?.uses ?? 0} used${r.maxUses ? ` of ${r.maxUses}` : ""}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {manage && (
                  <div className="flex gap-2">
                    <Link href={`/promotions/${r.id}`} className={buttonClass("secondary", "sm")}>
                      Edit
                    </Link>
                    <EndPromotion id={r.id} name={r.name} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
