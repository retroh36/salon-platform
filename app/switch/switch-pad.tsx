"use client";

import { useActionState, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/page";
import { switchUser, type SwitchState } from "./actions";

export type Person = { id: string; first_name: string; last_initial: string; role: string; color: string | null };

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"] as const;
// A number pad key: the outlined button's look, 64px square.
const KEY_CLASS =
  "touch-target inline-flex size-16 items-center justify-center rounded-lg border border-line-strong bg-surface text-xl font-medium text-ink tabular-nums transition-[background-color,transform] duration-(--motion-fast) select-none hover:bg-sunken active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

// Tap your name, then your PIN on a big number pad (made for an iPad).
export function SwitchPad({ people }: { people: Person[] }) {
  const [state, action, pending] = useActionState<SwitchState, FormData>(switchUser, undefined);
  const [chosen, setChosen] = useState<string | null>(state?.staffId || null);
  const [pin, setPin] = useState("");
  const person = people.find((p) => p.id === chosen);

  if (!person)
    return (
      <ul aria-label="Choose who you are" className="grid grid-cols-2 gap-3">
        {people.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => (setChosen(p.id), setPin(""))}
              className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface p-3 text-left text-sm font-medium text-ink transition-[background-color,border-color] duration-(--motion-fast) hover:border-line-strong hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <Avatar name={`${p.first_name} ${p.last_initial}`} color={p.color} size="md" halo={false} />
              <span className="min-w-0 truncate">
                {p.first_name} {p.last_initial}.
              </span>
            </button>
          </li>
        ))}
      </ul>
    );

  const press = (k: string) => setPin((v) => (k === "⌫" ? v.slice(0, -1) : v.length < 6 ? v + k : v));
  return (
    <form action={action} className="flex flex-col items-center gap-5" aria-label={`PIN for ${person.first_name}`}>
      <input type="hidden" name="staff_id" value={person.id} />
      <input type="hidden" name="pin" value={pin} />
      <div className="flex items-center gap-3">
        <Avatar name={`${person.first_name} ${person.last_initial}`} color={person.color} size="lg" halo={false} />
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
      <div className="flex w-full gap-3">
        <Button className="flex-1" onClick={() => (setChosen(null), setPin(""))}>
          Not me
        </Button>
        <Button type="submit" variant="primary" className="flex-1" disabled={pending || pin.length < 4}>
          Unlock
        </Button>
      </div>
    </form>
  );
}
