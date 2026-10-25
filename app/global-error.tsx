"use client";

import { ErrorScreen } from "@/components/error-screen";
import "./globals.css";

// When even the app's frame fails.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-full bg-canvas font-sans">
        <title>Something went wrong · Maestra</title>
        <ErrorScreen error={error} retry={retry} />
      </body>
    </html>
  );
}
