"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { MAX_CLIENT_NOTES } from "@/lib/client-profile";
import { saveClientNotes } from "../actions";

// The client's notes, right under the header: a click (or Edit) opens the
// box, which saves as you type and when you leave it; Done closes it. Who
// changed them last and when is underneath. Read-only for stylists.
export function ClientNotes({ clientId, initial, edited, editable }: { clientId: string; initial: string; edited: string | null; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(initial);
  const [editedText, setEditedText] = useState(edited);
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }>({ kind: "idle" });
  const saved = useRef(initial);
  const latest = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = useCallback(
    (value: string) => {
      clearTimeout(timer.current);
      if (value.trim() === saved.current.trim()) return;
      setState({ kind: "saving" });
      void saveClientNotes(clientId, value).then(
        (r) => {
          if (!r.ok) return setState({ kind: "error", message: r.message });
          saved.current = value;
          setEditedText(r.edited);
          if (latest.current === value) setState({ kind: "saved" });
        },
        () => setState({ kind: "error", message: "Notes not saved: check the connection. They'll save when you type again." }),
      );
    },
    [clientId],
  );

  // Leaving the page with a change not yet saved saves it.
  useEffect(() => () => save(latest.current), [save]);

  return (
    <section aria-labelledby="notes-heading" className="mb-6" data-testid="client-notes">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="notes-heading" className="text-base font-semibold text-ink">
          Notes
        </h2>
        <span aria-live="polite" className="text-xs text-ink-muted">
          {state.kind === "saving" && "Saving…"}
          {state.kind === "saved" && <span role="status">Notes saved.</span>}
        </span>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            aria-labelledby="notes-heading"
            autoFocus
            value={notes}
            onChange={(e) => {
              const value = e.target.value;
              setNotes(value);
              latest.current = value;
              setState({ kind: "idle" });
              clearTimeout(timer.current);
              timer.current = setTimeout(() => save(value), NOTES_SAVE_DELAY);
            }}
            onBlur={() => save(notes)}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                save(notes);
                setEditing(false);
              }
            }}
            maxLength={MAX_CLIENT_NOTES}
            rows={6}
            placeholder="What everyone should know about this client: how they like their hair, what to ask, what to avoid."
            className={`${fieldClass} text-sm leading-6`}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-13 text-ink-subtle" data-testid="notes-edited">
              {editedText ?? "Saves as you type."}
            </p>
            <Button
              size="sm"
              onClick={() => {
                save(notes);
                setEditing(false);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div
            onClick={editable ? () => setEditing(true) : undefined}
            className={`min-h-24 rounded-lg border border-line bg-surface px-4 py-3 text-sm leading-6 whitespace-pre-wrap wrap-anywhere ${editable ? "cursor-text transition-colors duration-(--motion-fast) hover:border-line-strong" : ""} ${notes.trim() ? "text-ink" : "text-ink-muted"}`}
            data-testid="notes-text"
          >
            {notes.trim() || (editable ? "No notes yet. Click to add what everyone should know." : "No notes yet.")}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-13 text-ink-subtle" data-testid="notes-edited">
              {editedText}
            </p>
            {editable && (
              <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>
                Edit notes
              </Button>
            )}
          </div>
        </>
      )}
      {state.kind === "error" && (
        <p role="alert" className="mt-1 text-13 text-danger">
          {state.message}
        </p>
      )}
    </section>
  );
}

// How long typing pauses before notes save.
const NOTES_SAVE_DELAY = 800;
