"use client";

import { useState, useTransition } from "react";
import { optOut } from "./actions";

export function OptOutButton({ token, channel, done: already, salon }: { token: string; channel: "sms" | "email"; done: boolean; salon: string }) {
  const [done, setDone] = useState(already);
  const [pending, start] = useTransition();
  if (done)
    return (
      <p role="status" className="rounded-xl bg-sunken px-4 py-3 font-medium" data-testid="opted-out">
        Done. {salon} won&apos;t send you {channel === "sms" ? "texts" : "marketing emails"} like this again.
      </p>
    );
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => setDone(await optOut(token)))}
      className="h-12 self-start rounded-lg bg-(--accent) px-5 font-semibold text-white disabled:opacity-60"
    >
      {pending ? "One moment…" : channel === "sms" ? "Stop texts" : "Unsubscribe"}
    </button>
  );
}
