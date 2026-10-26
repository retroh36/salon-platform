import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import type { Answers, FormField } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { formatDate } from "@/lib/clients";
import { toLocal } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";

export const metadata: Metadata = { title: "Signed form" };

export default function SignedFormPage({ params }: PageProps<"/clients/[id]/forms/[formId]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <SignedForm params={params} />
    </Suspense>
  );
}

async function SignedForm({ params }: Pick<PageProps<"/clients/[id]/forms/[formId]">, "params">) {
  const [{ id, formId }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isUuid(id) || !isUuid(formId)) notFound();
  const { data: form, error } = await supabase
    .from("client_forms")
    .select("template_name, fields, answers, signature, signed_at, client:clients(first_name, last_name), collector:staff(first_name, last_name)")
    .eq("id", formId)
    .eq("client_id", id)
    .maybeSingle();
  if (error) throw error;
  if (!form) notFound();
  const fields = form.fields as FormField[];
  const answers = form.answers as Answers;
  const show = (f: FormField) => {
    const v = answers[f.id];
    if (f.type === "checkbox") return v ? "Ticked" : "Not ticked";
    if (f.type === "yes_no") return v === "yes" ? "Yes" : v === "no" ? "No" : "No answer";
    return typeof v === "string" && v ? v : "No answer";
  };

  return (
    <AppShell section="clients" me={me}>
      <BackLink href={`/clients/${id}`}>{fullName(form.client)}</BackLink>
      <PageHeader
        title={form.template_name}
        description={`Signed ${formatDate(toLocal(new Date(form.signed_at), me.location.timezone).date)}${form.collector ? ` · collected by ${fullName(form.collector)}` : ""}`}
      />
      <Card>
        <dl className="flex flex-col gap-4">
          {fields.map((f) => (
            <div key={f.id}>
              <dt className="font-medium text-ink">{f.label}</dt>
              <dd className="mt-1 text-ink-muted">
                {f.type === "signature" ? (
                  form.signature ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.signature} alt={`Signature of ${fullName(form.client)}`} className="mt-1 h-28 rounded-md border border-line bg-surface" />
                  ) : (
                    "Not signed"
                  )
                ) : (
                  show(f)
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </AppShell>
  );
}
