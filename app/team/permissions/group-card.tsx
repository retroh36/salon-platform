"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { PERMISSIONS } from "@/lib/permissions";
import { SWITCH_ROLES, groupSummary, type GroupSwitches, type PermissionGroup } from "@/lib/permission-groups";
import { copyGroup, deleteGroup, saveGroup, type GroupResult } from "./actions";

function Status({ result }: { result: GroupResult | null }) {
  return result ? (
    <p role="status" className={`text-sm ${result.ok ? "text-ink-muted" : "text-danger"}`}>
      {result.message}
    </p>
  ) : null;
}

const settingOf = (switches: GroupSwitches, key: keyof GroupSwitches) => (switches[key] === true ? "on" : switches[key] === false ? "off" : "");

// The group's name and switches: each On, Off, or the role's default.
function GroupForm({ group, onDone }: { group: PermissionGroup | null; onDone: (r: GroupResult) => void }) {
  const [result, setResult] = useState<GroupResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label={group ? `Edit ${group.name}` : "New group"}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          const r = await saveGroup(group?.id ?? null, form);
          setResult(r);
          if (r.ok) onDone(r);
        });
      }}
    >
      <label className={`${labelClass} max-w-sm`}>
        Name
        <input name="name" defaultValue={group?.name ?? ""} maxLength={60} required className={fieldClass} />
      </label>
      <ul className="flex flex-col divide-y divide-line">
        {PERMISSIONS.map((p) => (
          <li key={p.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium text-ink">{p.label}</span>
              <span className="block text-13 text-ink-muted">
                {p.hint} For {SWITCH_ROLES[p.key].toLowerCase()}.
              </span>
            </span>
            <select name={`perm:${p.key}`} aria-label={p.label} defaultValue={group ? settingOf(group.permissions, p.key) : ""} className={`${selectClass} w-44`}>
              <option value="">Role&rsquo;s default</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : group ? "Save group" : "Add group"}
        </Button>
        <Status result={result} />
      </div>
    </form>
  );
}

export function NewGroup() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<GroupResult | null>(null);
  const router = useRouter();
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button variant="primary" onClick={() => setOpen(true)}>
            New group
          </Button>
        </div>
        <Status result={result} />
      </div>
    );
  return (
    <section aria-label="New group" className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">New group</h2>
        <Button variant="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <GroupForm
        group={null}
        onDone={(r) => {
          setOpen(false);
          setResult(r);
          router.refresh();
        }}
      />
    </section>
  );
}

export function GroupCard({ group }: { group: PermissionGroup }) {
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<GroupResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const people = group.members.length;
  return (
    <section aria-label={group.name} data-testid="permission-group" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{group.name}</h2>
          <p className="text-13 text-ink-muted">
            {people === 0 ? "Nobody in it yet" : `${people} ${people === 1 ? "person" : "people"}: ${group.members.map((m) => m.name).join(", ")}`}
          </p>
        </div>
        {!editing && !asking && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setResult(await copyGroup(group.id));
                  router.refresh();
                })
              }
            >
              Copy
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setAsking(true)}>
              Remove
            </Button>
          </div>
        )}
      </div>
      {asking ? (
        <div role="group" aria-label={`Remove ${group.name}`} className="flex flex-col gap-3">
          <p className="text-sm text-ink">
            Remove {group.name}?{people ? ` ${people === 1 ? "Its 1 person goes" : `Its ${people} people go`} back to their role's defaults and their own switches.` : ""}
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setResult(await deleteGroup(group.id));
                  setAsking(false);
                  router.refresh();
                })
              }
            >
              Remove group
            </Button>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : editing ? (
        <>
          <GroupForm
            group={group}
            onDone={(r) => {
              setEditing(false);
              setResult(r);
              router.refresh();
            }}
          />
          <div>
            <Button variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-ink-muted" data-testid="group-summary">
          {groupSummary(group.permissions)}
        </p>
      )}
      <Status result={result} />
    </section>
  );
}
