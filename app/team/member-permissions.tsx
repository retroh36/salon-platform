"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, labelClass, selectClass } from "@/components/ui/field";
import { PERMISSIONS } from "@/lib/permissions";
import type { LoginResult } from "@/lib/team-logins";
import { clearMemberPin, setAssistantStylist, setMemberPermission } from "./actions";

export type PermissionRow = { permission: string; allowed: boolean; role_default: boolean; toggleable: boolean };

function Status({ result }: { result: LoginResult | null }) {
  return result ? (
    <p role="status" className={`text-sm ${result.ok ? "text-ink-muted" : "text-danger"}`}>
      {result.message}
    </p>
  ) : null;
}

// What this person can do beyond their role's basics: owners switch each
// one; anyone else sees them read-only. Only what the role allows changing
// is listed (an owner can always do everything).
export function PermissionsCard({ staffId, firstName, rows, canEdit }: { staffId: string; firstName: string; rows: PermissionRow[]; canEdit: boolean }) {
  const [allowed, setAllowed] = useState(() => new Map(rows.map((r) => [r.permission, r.allowed])));
  const [result, setResult] = useState<LoginResult | null>(null);
  const [pending, start] = useTransition();
  const shown = PERMISSIONS.filter((p) => rows.some((r) => r.permission === p.key && r.toggleable));
  if (!shown.length) return null;
  return (
    <section aria-label="What they can do" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="font-serif text-lg font-semibold text-ink">What {firstName} can do</h2>
      <p className="text-sm text-ink-muted">{canEdit ? "Their role sets the starting point; switch anything here for just them." : "Set by their role and the owner."}</p>
      <ul className="flex flex-col gap-2" data-testid="permissions">
        {shown.map((p) => {
          const row = rows.find((r) => r.permission === p.key)!;
          const on = allowed.get(p.key) ?? false;
          return (
            <li key={p.key}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className={`${checkboxClass} mt-0.5`}
                  checked={on}
                  disabled={!canEdit || pending}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setAllowed((m) => new Map(m).set(p.key, next));
                    start(async () => {
                      const r = await setMemberPermission(staffId, p.key, next);
                      setResult(r);
                      if (!r.ok) setAllowed((m) => new Map(m).set(p.key, !next));
                    });
                  }}
                />
                <span>
                  <span className="font-medium">{p.label}</span>
                  {on !== row.role_default && <span className="ml-1 text-ink-muted">(changed for {firstName})</span>}
                  <span className="block text-ink-muted">{p.hint}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <Status result={result} />
    </section>
  );
}

export function AssistingCard({ staffId, current, stylists }: { staffId: string; current: string | null; stylists: { id: string; name: string }[] }) {
  const [value, setValue] = useState(current ?? "");
  const [result, setResult] = useState<LoginResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <section aria-label="Assisting" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="font-serif text-lg font-semibold text-ink">Assisting</h2>
      <label className={labelClass}>
        Stylist
        <select
          className={selectClass}
          value={value}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value;
            setValue(v);
            start(async () => setResult(await setAssistantStylist(staffId, v || null)));
          }}
        >
          <option value="">Nobody yet</option>
          {stylists.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-ink-muted">They see this stylist&rsquo;s day and clients, without prices or pay.</p>
      <Status result={result} />
    </section>
  );
}

export function PinCard({ staffId, firstName, hasPin }: { staffId: string; firstName: string; hasPin: boolean }) {
  const [result, setResult] = useState<LoginResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <section aria-label="PIN" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="font-serif text-lg font-semibold text-ink">Shared iPad PIN</h2>
      <p className="text-sm text-ink-muted">{hasPin && !result?.ok ? `${firstName} has a PIN.` : `${firstName} sets a PIN on Your account.`}</p>
      {hasPin && !result?.ok && (
        <Button className="self-start" disabled={pending} onClick={() => start(async () => setResult(await clearMemberPin(staffId)))}>
          Clear PIN
        </Button>
      )}
      <Status result={result} />
    </section>
  );
}
