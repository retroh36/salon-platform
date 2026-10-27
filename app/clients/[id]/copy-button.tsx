"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Copies a short text (a referral code), saying so for a moment.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="xs"
      variant="quiet"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          },
          () => {},
        )
      }
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
}
