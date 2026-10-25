"use client";

import { useState, useTransition } from "react";
import { checkboxClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { saveFreeTextRoles } from "./actions";

const ROLES = [
  ["manager", "Managers"],
  ["front_desk", "Front desk"],
  ["stylist", "Stylists"],
] as const;

export function FreeTextRoles({ roles, canChange }: { roles: string[]; canChange: boolean }) {
  const [on, setOn] = useState(new Set(roles));
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <fieldset className="flex flex-col gap-2" aria-label="Who can write their own messages">
      {ROLES.map(([role, label]) => (
        <label key={role} className="flex items-center gap-2">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={on.has(role)}
            disabled={!canChange || pending}
            onChange={(e) => {
              const next = new Set(on);
              if (e.target.checked) next.add(role);
              else next.delete(role);
              setOn(next);
              start(async () => setResult(await saveFreeTextRoles([...next])));
            }}
          />
          {label}
        </label>
      ))}
      <p className="text-sm text-ink-muted">Stylists message only clients on their own visits.</p>
      {!canChange && <p className="text-sm text-ink-muted">Only owners change this.</p>}
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </fieldset>
  );
}
