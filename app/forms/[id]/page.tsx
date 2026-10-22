import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingShell } from "@/components/app-shell";
import { TemplatePage } from "../template-page";

export const metadata: Metadata = { title: "Form" };

export default function FormPage({ params }: PageProps<"/forms/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: Pick<PageProps<"/forms/[id]">, "params">) {
  const { id } = await params;
  return <TemplatePage id={id} />;
}
