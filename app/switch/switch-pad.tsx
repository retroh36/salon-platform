"use client";

import { useActionState, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { staffPhotoUrl } from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/page";
import { clockAtDesk, switchUser, type ClockState, type SwitchState } from "./actions";

export type Person = { id: string; first_name: string; last_initial: string; role: string; color: string | null; photo_path: string | null };

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"] as const;
// A number pad key: the outlined button's look, 64px square.
const KEY_CLASS =
  "touch-target inline-flex size-16 items-center justify-center rounded-lg border border-line-strong bg-surface text-xl font-medium text-ink tabular-nums transition-[background-color,transform] duration-(--motion-fast) select-none hover:bg-sunken active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

// Tap your name, then your PIN on a big number pad (made for an iPad), to
// sign in; or, where the salon uses the time clock, to clock in or out
// without signing in.
export function SwitchPad({ people, clock }: { people: Person[]; clock: boolean }) {
  const [signState, signAction, signPending] = useActionState<SwitchState, FormData>(switchUser, undefined);
  const [clockState, clockAction, clockPending] = useActionState<ClockState, FormData>(clockAtDesk, undefined);
  const [mode, setMode] = useState<"sign_in" | "clock">("sign_in");
  const state = mode === "clock" ? (clockState && "error" in clockState ? clockState : undefined) : signState;
  const action = mode === "clock" ? clockAction : signAction;
  const pending = mode === "clock" ? clockPending : signPending;
  const done = clockState && "done" in clockState ? clockState.done : null;
  const [chosen, setChosen] = useState<string | null>(signState?.staffId || null);
  const [pin, setPin] = useState("");
  // After a punch, back to the names with what happened.
  const [shownDone, setShownDone] = useState<string | null>(null);
  if (done && done !== shownDone) {
    setShownDone(done);
    setChosen(null);
    setPin("");
  }
  const person = people.find((p) => p.id === chosen);

  if (!person)
    return (
      <div className="flex flex-col gap-4">
        {clock && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-ink">{mode === "clock" ? "Tap your name to clock in or out." : "Tap your name to sign in."}</p>
            <Button variant="secondary" size="sm" onClick={() => (setMode(mode === "clock" ? "sign_in" : "clock"), setShownDone(null))} data-testid="clock-mode">
              {mode === "clock" ? "Sign in instead" : "Clock in or out"}
            </Button>
          </div>
        )}
        {mode === "clock" && shownDone && (
          <div data-testid="clock-done">
            <Alert tone="success">{shownDone}</Alert>
          </div>
        )}
      <ul aria-label="Choose who you are" className="grid grid-cols-2 gap-3">
        {people.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => (setChosen(p.id), setPin(""))}
              className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface p-3 text-left text-sm font-medium text-ink transition-[background-color,border-color] duration-(--motion-fast) hover:border-line-strong hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <Avatar name={`${p.first_name} ${p.last_initial}`} color={p.color} photoUrl={staffPhotoUrl(p.photo_path)} size="md" halo={false} />
              <span className="min-w-0 truncate">
                {p.first_name} {p.last_initial}.
              </span>
            </button>
          </li>
        ))}
      </ul>
      </div>
    );

  const press = (k: string) => setPin((v) => (k === "⌫" ? v.slice(0, -1) : v.length < 6 ? v + k : v));
  return (
    <form action={action} className="flex flex-col items-center gap-5" aria-label={`PIN for ${person.first_name}`}>
      <input type="hidden" name="staff_id" value={person.id} />
      <input type="hidden" name="pin" value={pin} />
      <div className="flex items-center gap-3">
        <Avatar name={`${person.first_name} ${person.last_initial}`} color={person.color} photoUrl={staffPhotoUrl(person.photo_path)} size="lg" halo={false} />
        <p className="text-xl font-semibold text-ink">Hi, {person.first_name}</p>
      </div>
      <p aria-live="polite" className="flex h-6 gap-3" aria-label={`${pin.length} digits entered`} data-testid="pin-dots">
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={`size-3.5 rounded-full ${i < pin.length ? "bg-navy-900" : "border-2 border-line-strong"}`} />
        ))}
      </p>
      {state?.error && state.staffId === person.id && <Alert className="w-full">{state.error}</Alert>}
      <div className="grid grid-cols-3 gap-3" role="group" aria-label="Number pad">
        {KEYS.map((k, i) =>
          k ? (
            <button
              key={i}
              type="button"
              aria-label={k === "⌫" ? "Delete" : k}
              onClick={() => press(k)}
              className={KEY_CLASS}
            >
              {k}
            </button>
          ) : (
            <span key={i} />
          ),
        )}
      </div>
      {/* As wide as the pad, under it. */}
      <div className="flex w-full max-w-[18.75rem] gap-3">
        <Button className="flex-1" onClick={() => (setChosen(null), setPin(""))}>
          Not me
        </Button>
        <Button type="submit" variant="primary" className="flex-1" disabled={pending || pin.length < 4}>
          {mode === "clock" ? "Clock in or out" : "Unlock"}
        </Button>
      </div>
    </form>
  );
}
