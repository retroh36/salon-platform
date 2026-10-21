import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingShell } from "@/components/app-shell";
import { ServiceEditor } from "../service-editor";

export const metadata: Metadata = { title: "Add service · Salon Platform" };

export default function NewServicePage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <ServiceEditor />
    </Suspense>
  );
}
