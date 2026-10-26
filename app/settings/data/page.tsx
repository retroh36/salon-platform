import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, Section } from "@/components/ui/page";
import { TableCard, numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate } from "@/lib/clients";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { SettingsNav } from "../settings-nav";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Your data" };

const INCLUDED = [
  ["Clients", "contact details, preferences, notes, allergies and consent"],
  ["Visits", "every service booked, with stylist, price, status and times"],
  ["Formulas", "color formulas with products and amounts"],
  ["Sales", "every sale, its lines, payments, tips, refunds and voids"],
  ["Products", "your products, suppliers, prices and stock on hand"],
  ["Gift cards", "every card, its balance and its history"],
  ["Packages", "packages sold and the uses left"],
  ["Services and team", "your menu and your staff, which the other files refer to"],
] as const;

export default function DataPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Data />
    </Suspense>
  );
}

async function Data() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "export_data")) redirect("/dashboard");
  const { data: exports, error } = await supabase
    .from("data_exports")
    .select("id, created_at, bytes, row_counts, staff:staff(first_name)")
    .eq("business_id", me.business_id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const tz = me.location.timezone;

  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Settings" description="Download everything your salon keeps here." />
      <SettingsNav current="data" me={me} />
      <Card title="Your data is yours" titleId="data-heading">
        <div className="flex max-w-2xl flex-col gap-4">
          <p>
            Download all of {me.location.business.name}&apos;s data whenever you like, as spreadsheet files (CSV) in one zip. Keep it as your own copy, or take it to
            another system. You never need our permission.
          </p>
          <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2" aria-label="What's included">
            {INCLUDED.map(([what, detail]) => (
              <li key={what}>
                <span className="font-medium text-ink">{what}:</span> <span className="text-ink-muted">{detail}</span>
              </li>
            ))}
          </ul>
          <p className="text-13 text-ink-muted">
            Card numbers are never stored, so they&apos;re never in it. Before and after photos stay in your private storage. Every download is logged below.
          </p>
          <form method="post" action="/settings/data/export">
            <button type="submit" className={buttonClass("primary", "md")}>
              Download all data
            </button>
          </form>
        </div>
      </Card>
      <Section title="Downloads" titleId="exports-heading" count={exports.length}>
        <TableCard>
          {exports.length === 0 ? (
            <EmptyState>No downloads yet.</EmptyState>
          ) : (
            <table className={tableClass} aria-label="Data downloads">
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>Downloaded</th>
                  <th className={thClass}>What was in it</th>
                  <th className={`${thClass} text-right`}>Size</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((e) => {
                  const l = toLocal(new Date(e.created_at), tz);
                  const counts = e.row_counts as Record<string, number>;
                  return (
                    <tr key={e.id} className={trClass} data-testid="data-export">
                      <td className={`${tdClass} text-ink`}>
                        {formatDate(l.date)} at {formatMinute(l.minute)}
                        {e.staff ? ` by ${e.staff.first_name}` : ""}
                      </td>
                      <td className={`${tdClass} text-ink-muted tabular-nums`}>
                        {counts.clients ?? 0} clients · {counts.visits ?? 0} visit lines · {counts.sales ?? 0} sales
                      </td>
                      <td className={`${tdClass} ${numClass}`}>{(e.bytes / 1024).toFixed(0)} KB</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </TableCard>
      </Section>
    </AppShell>
  );
}
