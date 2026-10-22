import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingShell } from "@/components/app-shell";
import { TemplatePage } from "../template-page";

export const metadata: Metadata = { title: "New form · Salon Platform" };

export default function NewFormPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <TemplatePage />
    </Suspense>
  );
}
