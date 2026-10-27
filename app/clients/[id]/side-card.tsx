"use client";

import { createContext, useContext, useState } from "react";
import { Button } from "@/components/ui/button";

// The profile's side column is a stack of cards, one per subject: a white
// card (1px border, 12px corners, 20px in), its title with a small icon,
// and its one action in the top right corner. An action that opens a form
// (Adjust points, Send card link) opens it at the top of the card's body;
// the form closes itself through `useCloseCardAction`, optionally leaving a
// line saying what happened.

type Close = (message?: string) => void;
const CloseContext = createContext<Close>(() => {});
export const useCloseCardAction = () => useContext(CloseContext);

export function SideCard({
  title,
  icon,
  action,
  opens,
  note,
  testId,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  // A link or button for the top right corner.
  action?: React.ReactNode;
  // Or a button there that opens a form at the top of the card.
  opens?: { label: string; form: React.ReactNode };
  // A quiet line at the foot of the card.
  note?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const id = `card-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="animate-fade-in rounded-xl border border-line bg-surface p-5" data-testid={testId}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 id={id} className="flex min-w-0 items-center gap-2 text-base font-semibold text-ink">
          <span aria-hidden className="shrink-0 text-ink-muted [&_svg]:size-4">
            {icon}
          </span>
          {title}
        </h2>
        {opens
          ? !open && (
              <Button size="sm" variant="quiet" className="-mr-2 shrink-0" onClick={() => (setOpen(true), setMessage(null))}>
                {opens.label}
              </Button>
            )
          : action}
      </div>
      <div className="mt-4 flex flex-col gap-4 text-sm">
        {opens && open && (
          <CloseContext value={(m) => (setOpen(false), setMessage(m ?? null))}>
            <div className="rounded-lg border border-line p-3">{opens.form}</div>
          </CloseContext>
        )}
        {message && (
          <p role="status" className="text-13 text-ink-muted">
            {message}
          </p>
        )}
        {children}
        {note && <p className="text-xs text-ink-muted">{note}</p>}
      </div>
    </section>
  );
}

// Label and value side by side: one line of a card.
export function Row({ label, children, testId }: { label: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4" data-testid={testId}>
      <dt className="shrink-0 text-13 text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right text-ink wrap-anywhere">{children}</dd>
    </div>
  );
}
