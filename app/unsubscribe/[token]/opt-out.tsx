"use client";

import { useState, useTransition } from "react";
import { primaryButton } from "@/app/book/[slug]/styles";
import { Alert } from "@/components/ui/page";
import { optOut } from "./actions";

export function OptOutButton({ token, channel, done: already, salon }: { token: string; channel: "sms" | "email"; done: boolean; salon: string }) {
  const [done, setDone] = useState(already);
  const [pending, start] = useTransition();
  if (done)
    return (
      <div data-testid="opted-out">
        <Alert tone="success">
          Done. {salon} won&apos;t send you {channel === "sms" ? "texts" : "marketing emails"} like this again.
        </Alert>
      </div>
    );
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => setDone(await optOut(token)))}
      className={`${primaryButton} sm:w-auto`}
    >
      {pending ? "One moment…" : channel === "sms" ? "Stop texts" : "Unsubscribe"}
    </button>
  );
}
