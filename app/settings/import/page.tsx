import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Badge, Card, PageHeader, Section } from "@/components/ui/page";
import { TableCard, numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate } from "@/lib/clients";
import { can } from "@/lib/permissions";
import { toLocal } from "@/lib/scheduling/time";
import { SettingsNav } from "../settings-nav";
import { ImportForm, UndoImport } from "./import-form";

export const metadata: Metadata = { title: "Import clients" };

export default function ImportPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Import />
    </Suspense>
  );
}

async function Import() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const { data: imports, error } = await supabase.from("client_imports").select("id, file_name, added, skipped, created_at, undone_at, removed").eq("business_id", me.business_id).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Import clients" description="Bring your clients over from a CSV file." />
      <SettingsNav current="import" me={me} />
      <Card title="Upload a file" titleId="import-heading" description="Everyone added gets visit messages as usual, and no offers until they say yes.">
        <ImportForm />
      </Card>
      {imports.length > 0 && (
        <Section title="Past imports" titleId="past-imports-heading" count={imports.length}>
          <TableCard>
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>File</th>
                  <th className={thClass}>Date</th>
                  <th className={`${thClass} ${numClass}`}>Added</th>
                  <th className={`${thClass} ${numClass}`}>Already here</th>
                  <th className={thClass}>
                    <span className="sr-only">Undo</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} className={trClass} data-testid="past-import">
                    <td className={tdClass}>{i.file_name}</td>
                    <td className={tdClass}>{formatDate(toLocal(new Date(i.created_at), me.location.timezone).date)}</td>
                    <td className={`${tdClass} ${numClass}`}>{i.added.toLocaleString("en-US")}</td>
                    <td className={`${tdClass} ${numClass}`}>{i.skipped.toLocaleString("en-US")}</td>
                    <td className={tdClass}>{i.undone_at ? <Badge tone="neutral">{`Undone, ${i.removed ?? 0} removed`}</Badge> : i.added > 0 ? <UndoImport id={i.id} added={i.added} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </Section>
      )}
    </AppShell>
  );
}
