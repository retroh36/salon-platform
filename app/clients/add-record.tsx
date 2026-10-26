"use client";

import { createContext, useContext, useState } from "react";
import { Button } from "@/components/ui/button";

// "Add formula", "Add patch test": the form opens only when asked for, and
// closes once it's saved (the form calls `useCloseRecord`) or with Cancel.
const CloseRecord = createContext<(() => void) | null>(null);

export function useCloseRecord() {
  return useContext(CloseRecord);
}

export function AddRecord({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="sm" className="self-start" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <CloseRecord.Provider value={() => setOpen(false)}>
      <div className="w-full animate-fade-in rounded-lg border border-line bg-surface p-4">{children}</div>
    </CloseRecord.Provider>
  );
}
