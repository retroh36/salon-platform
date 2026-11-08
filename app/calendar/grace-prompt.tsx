"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/page";
import { reach } from "@/lib/reach";
import { loadGraceAsks, sendGraceMessage, skipGraceMessage, type GraceAsks } from "@/app/policy/grace-actions";
import { ClientMessageRow } from "./client-message-row";

// After grace forgives (or holds) a fee: "Let Ava know their fee was
// waived?", the salon's message as it would go (theirs to change if their
// role may write its own) and Send / Don't send, like a moved visit. The
// waiver never tells the client anything by itself; only Send here does.
// In booking details (one fee) and Denise's card (each waiting).
export function GracePrompt({ feeIds, onDone }: { feeIds: string[]; onDone: (message: string) => void }) {
  const [loaded, setLoaded] = useState<GraceAsks | "failed" | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const key = feeIds.join(",");

  useEffect(() => {
    let live = true;
    reach(loadGraceAsks(key.split(","))).then(
      (r) => live && setLoaded("asks" in r ? r : "failed"),
      () => live && setLoaded("failed"),
    );
    return () => {
      live = false;
    };
  }, [key]);

  if (!loaded) return null;
  if (loaded === "failed") return <Alert>The grace message didn&rsquo;t load. Try again in a moment.</Alert>;
  const list = loaded.asks.filter((a) => !done.has(a.feeId));
  if (!list.length) return null;

  const finish = (feeId: string, message: string) => {
    setDone((d) => new Set(d).add(feeId));
    onDone(message);
  };

  return (
    <section aria-label="Grace message" className="flex animate-fade-in flex-col gap-2" data-testid="grace-prompt">
      <h3 className="text-sm font-semibold text-ink">
        {list.length === 1
          ? list[0].held
            ? `Let ${list[0].firstName} know their fee is waived if they rebook?`
            : `Let ${list[0].firstName} know their fee was waived?`
          : `Let ${list.length} clients know about their grace?`}
      </h3>
      <ul className="flex flex-col gap-2">
        {list.map((a) => (
          <ClientMessageRow
            key={a.feeId}
            message={{ appointmentId: a.appointmentId, clientName: a.clientName, channel: a.channel, body: a.body, sent: false }}
            freeText={loaded.freeText}
            send={(edited) => sendGraceMessage({ feeId: a.feeId, channel: a.channel!, edited })}
            onSent={() => finish(a.feeId, `Sent to ${a.firstName}.`)}
            onSkip={() =>
              void reach(skipGraceMessage(a.feeId)).then(
                (r) => (r.ok ? finish(a.feeId, `${a.firstName} wasn't told.`) : setProblem(r.message)),
                () => setProblem("That didn't save. Try again."),
              )
            }
          />
        ))}
      </ul>
      {problem && <Alert>{problem}</Alert>}
    </section>
  );
}
