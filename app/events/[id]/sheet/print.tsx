"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Print, or save as a PDF from the print dialog. `auto` opens it at once.
export function PrintButton({ auto }: { auto: boolean }) {
  useEffect(() => {
    if (auto) window.print();
  }, [auto]);
  return (
    <Button variant="primary" size="md" onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
