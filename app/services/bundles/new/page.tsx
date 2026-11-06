import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingShell } from "@/components/app-shell";
import { BundleEditor } from "../../bundle-editor";

export const metadata: Metadata = { title: "Add bundle" };

export default function NewBundlePage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <BundleEditor />
    </Suspense>
  );
}
