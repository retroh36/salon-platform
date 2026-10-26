"use client";

import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { sendFeedback } from "@/app/demo/actions";
import { DEMO_BANNER } from "@/lib/demo";
import { Button } from "./ui/button";
import { fieldClass, labelClass } from "./ui/field";
import { Alert } from "./ui/page";
import { Sheet } from "./ui/sheet";

// The public demo's slim bar along the top of every page (only with
// DEMO_MODE=true, from the root layout): what the demo is, the outbox where
// its texts and emails land, and Feedback. Its height is --demo-bar, which
// full-height screens take off theirs.
export function DemoBar() {
  const [open, setOpen] = useState(false);
  return (
    <div role="region" aria-label="Demo" className="flex h-(--demo-bar) shrink-0 items-center gap-3 bg-navy-900 px-4 text-xs text-white">
      <p className="min-w-0 flex-1 truncate">
        <span className="hidden sm:inline">{DEMO_BANNER}</span>
        <span className="sm:hidden">Demo: fake data, no real info.</span>
      </p>
      <a href="/dev/outbox" target="_blank" rel="noopener" className="hidden shrink-0 font-medium underline underline-offset-2 sm:inline">
        Demo outbox
      </a>
      <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-md px-1 font-semibold underline underline-offset-2">
        Feedback
      </button>
      {open && <FeedbackSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const page = usePathname();
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet title="Send feedback" onClose={onClose}>
      {result?.ok ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">Thanks. Your note is saved with the page you were on.</Alert>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4 text-ink"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await sendFeedback({ note, name, page });
              setResult(r.ok ? { ok: true, message: "" } : { ok: false, message: r.message });
            });
          }}
        >
          <p className="text-sm text-ink-muted">What worked, what didn&apos;t, what you&apos;d want. It&apos;s saved with this page and the role you&apos;re signed in as.</p>
          <label className={labelClass}>
            Your note
            <textarea className={`${fieldClass} min-h-28`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} required />
          </label>
          <label className={labelClass}>
            Your name (optional)
            <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
          </label>
          {result && !result.ok && <Alert>{result.message}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !note.trim()}>
              Send feedback
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

// The code a client would have been texted or emailed, on screen in the
// demo (sendCode in lib/online-booking/codes.ts).
export function DemoCode({ code }: { code?: string }) {
  if (!code) return null;
  return (
    <p data-testid="demo-code" className="rounded-xl border border-line bg-sunken px-3 py-2 text-sm text-ink">
      Demo: your code is <span className="font-mono font-semibold tracking-wider">{code}</span>. A real salon texts or emails it (see the{" "}
      <a href="/dev/outbox" target="_blank" rel="noopener" className="text-link underline underline-offset-2">
        demo outbox
      </a>
      ).
    </p>
  );
}
