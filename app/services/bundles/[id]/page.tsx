import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingShell } from "@/components/app-shell";
import { BundleEditor } from "../../bundle-editor";

export const metadata: Metadata = { title: "Bundle" };

export default function BundlePage({ params, searchParams }: PageProps<"/services/bundles/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Editor params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Editor({ params, searchParams }: Pick<PageProps<"/services/bundles/[id]">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <BundleEditor bundleId={id} error={typeof query.error === "string" ? query.error : undefined} />;
}
