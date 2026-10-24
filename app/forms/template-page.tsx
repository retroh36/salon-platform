import { notFound, redirect } from "next/navigation";
import { AppShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadTemplates } from "@/lib/client-checks";
import { isUuid } from "@/lib/ids";
import { TemplateEditor, type TemplateDraft } from "./template-editor";
import { can } from "@/lib/permissions";

// Build a new form (no id) or view/edit one. Only owners can change them.
export async function TemplatePage({ id }: { id?: string }) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  const owner = can(me, "settings");
  if (!id && !owner) redirect("/forms");
  if (id && !isUuid(id)) notFound();
  const [templates, { data: services, error }] = await Promise.all([
    loadTemplates(supabase),
    supabase.from("services").select("id, name, category").is("archived_at", null).order("category").order("name"),
  ]);
  if (error) throw error;
  const template = id ? templates.find((t) => t.id === id) : undefined;
  if (id && !template) notFound();
  const initial: TemplateDraft = template
    ? { id: template.id, name: template.name, intro: template.intro ?? "", fields: template.fields, required: template.required, serviceIds: template.serviceIds, isActive: template.isActive }
    : { name: "", intro: "", fields: [], required: "none", serviceIds: [], isActive: true };

  return (
    <AppShell section="forms" me={me}>
      <BackLink href="/forms">Forms</BackLink>
      <PageHeader title={template ? template.name : "New form"} description={owner ? "Questions clients answer and sign on the front desk iPad." : "Only owners can change forms."} />
      <TemplateEditor initial={initial} services={services} readOnly={!owner} />
    </AppShell>
  );
}
