import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { Card, EmptyState, listClass, PageHeader, rowLinkClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadTemplates } from "@/lib/client-checks";
import { isUuid } from "@/lib/ids";
import { fullName } from "@/lib/staff";
import { FillForm } from "../fill-form";

export const metadata: Metadata = { title: "Fill in a form" };

export default function NewClientFormPage({ params, searchParams }: PageProps<"/clients/[id]/forms/new">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Fill params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Fill({ params, searchParams }: Pick<PageProps<"/clients/[id]/forms/new">, "params" | "searchParams">) {
  const [{ id }, query, { supabase, staff: me }] = await Promise.all([params, searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isUuid(id)) notFound();
  const { data: client, error } = await supabase.from("clients").select("id, first_name, last_name").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!client) notFound();
  // Only a path in the app.
  const back = typeof query.back === "string" && query.back.startsWith("/") && !query.back.startsWith("//") ? query.back : `/clients/${id}`;
  const templates = (await loadTemplates(supabase)).filter((t) => t.isActive);
  const template = templates.find((t) => t.id === query.template);
  const name = fullName(client);

  return (
    <AppShell section="clients" me={me}>
      <BackLink href={back}>Back</BackLink>
      <div className="mx-auto w-full max-w-2xl">
        <PageHeader title={template ? template.name : "Fill in a form"} description={`For ${name}`} />
        {template ? (
          <FillForm clientId={id} clientName={name} template={template} back={back} />
        ) : (
          <Card flush>
            {templates.length === 0 ? (
              <EmptyState>No forms in use.</EmptyState>
            ) : (
              <ul className={listClass} aria-label="Forms">
                {templates.map((t) => (
                  <li key={t.id}>
                    <Link href={`/clients/${id}/forms/new?template=${t.id}&back=${encodeURIComponent(back)}`} className={`${rowLinkClass} block font-semibold text-ink`}>
                      {t.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
