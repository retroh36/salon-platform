"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/page";
import type { Moved } from "@/lib/denise/types";
import { reach } from "@/lib/reach";
import { ClientMessageRow } from "./client-message-row";
import { movedMessages, sendMovedMessage, type MovedMessages as Loaded } from "./moved-actions";

// Under "Moved Aria. Message ready to send." once one of Denise's fixes is
// applied: each moved client's "Your visit has moved", filled in from the
// visit as it is now, to check (and change, if their role may) and send.
// Nothing reaches a client until it's sent here.
export function MovedMessages({ moved }: { moved: Moved }) {
  const [loaded, setLoaded] = useState<Loaded | "failed" | null>(null);
  const [version, setVersion] = useState(0);
  const [sending, startSending] = useTransition();

  useEffect(() => {
    let live = true;
    reach(movedMessages(moved.appointmentIds, moved.at)).then((r) => live && setLoaded("messages" in r ? r : "failed"));
    return () => {
      live = false;
    };
  }, [moved, version]);

  if (!loaded) return <p className="text-13 text-ink-muted">Getting the messages ready…</p>;
  if (loaded === "failed") return <Alert>The messages didn&rsquo;t load, so nobody has been told yet. Use Message client in each visit&rsquo;s booking details.</Alert>;
  if (!loaded.messages.length) return null;
  const unsent = loaded.messages.filter((m) => !m.sent && m.channel);
  const send = (m: Loaded["messages"][number], edited: string | null) => sendMovedMessage({ appointmentId: m.appointmentId, channel: m.channel!, edited, subject: m.subject });

  return (
    <div className="flex flex-col gap-3" data-testid="moved-messages">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-13 font-medium text-ink-muted">Messages to clients ({loaded.messages.length})</h3>
        {unsent.length > 1 && (
          <Button
            size="sm"
            disabled={sending}
            onClick={() =>
              startSending(async () => {
                for (const m of unsent) await reach(send(m, null)).catch(() => null);
                setVersion((v) => v + 1);
              })
            }
          >
            {sending ? "Sending…" : `Send all (${unsent.length})`}
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {loaded.messages.map((m) => (
          <ClientMessageRow key={`${m.appointmentId}:${m.sent}`} message={m} freeText={loaded.freeText} send={(edited) => send(m, edited)} onSent={() => setVersion((v) => v + 1)} />
        ))}
      </ul>
    </div>
  );
}
