import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingShell } from "@/components/app-shell";
import { ServiceEditor } from "../service-editor";

export const metadata: Metadata = { title: "Service · Salon Platform" };

export default function ServicePage({ params, searchParams }: PageProps<"/services/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Editor params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Editor({ params, searchParams }: Pick<PageProps<"/services/[id]">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <ServiceEditor serviceId={id} error={typeof query.error === "string" ? query.error : undefined} />;
}
