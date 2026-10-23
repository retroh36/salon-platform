"use client";

import { useCallback, useState } from "react";
import { ERROR_REPLY } from "@/lib/denise/respond";
import type { DeniseEvent, DeniseRequest } from "@/lib/denise/types";

export type DeniseRun = {
  working: boolean;
  // What she's doing now ("Checking Bridget's openings…").
  status: string | null;
  // Her answer so far, as it streams in.
  text: string;
  // Over 20 seconds: "Still working on it…".
  slow: boolean;
};

type Done = Extract<DeniseEvent, { t: "done" }>;

const IDLE: DeniseRun = { working: false, status: null, text: "", slow: false };
export const SLOW_MS = 20_000;

// Asks Denise (app/api/denise) and follows along as she works. Always ends
// with a reply: if the request fails, hers is "Something went wrong on my
// end" (the server logs what happened).
export function useDeniseRun() {
  const [run, setRun] = useState<DeniseRun>(IDLE);

  const start = useCallback(async (request: DeniseRequest, firstStatus: string): Promise<Done> => {
    setRun({ working: true, status: firstStatus, text: "", slow: false });
    const timer = setTimeout(() => setRun((r) => ({ ...r, slow: true })), SLOW_MS);
    try {
      const response = await fetch("/api/denise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      if (!response.ok || !response.body) return { t: "done", reply: ERROR_REPLY };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done: Done | null = null;
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end).trim();
          buffer = buffer.slice(end + 1);
          if (!line) continue;
          const event = JSON.parse(line) as DeniseEvent;
          if (event.t === "status") setRun((r) => ({ ...r, status: event.text }));
          else if (event.t === "text") setRun((r) => ({ ...r, text: r.text + event.text }));
          else if (event.t === "discard") setRun((r) => ({ ...r, text: "" }));
          else done = event;
        }
      }
      return done ?? { t: "done", reply: ERROR_REPLY };
    } catch {
      return { t: "done", reply: ERROR_REPLY };
    } finally {
      clearTimeout(timer);
      setRun(IDLE);
    }
  }, []);

  return { run, start };
}
