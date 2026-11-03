"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { saveMoveMessageDefault } from "./actions";

type Choice = "send" | "skip";

export function MoveMessageDefault({ value }: { value: Choice }) {
  const [choice, setChoice] = useState<Choice>(value);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        label="After a visit is moved"
        value={choice}
        onChange={(next) => {
          setChoice(next);
          start(async () => setResult(await saveMoveMessageDefault(next)));
        }}
        options={[
          { value: "send", label: "Usually send" },
          { value: "skip", label: "Usually don't" },
        ]}
      />
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </div>
  );
}
