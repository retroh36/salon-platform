"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { findClients, type ClientOption } from "@/app/calendar/actions";
import { deleteFamily, saveFamily } from "@/app/clients/family-actions";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass } from "@/components/ui/field";
import { HomeIcon } from "@/components/ui/icons";
import { Alert, Badge, nameLinkClass } from "@/components/ui/page";
import { MAX_FAMILY, suggestedName, type Family, type FamilyMember } from "@/lib/families";
import { reach } from "@/lib/reach";
import { SideCard, useCloseCardAction } from "./side-card";

// The client's family on their profile: everyone in it (each a link to
// their own profile) and who usually pays. The front of house adds one, or
// changes it, from the card's corner.
export function FamilyCard({ client, family, editable }: { client: FamilyMember; family: Family | null; editable: boolean }) {
  if (!family && !editable) return null;
  const form = <FamilyForm client={client} family={family} />;
  return (
    <SideCard title="Family" icon={<HomeIcon />} testId="client-family" opens={editable ? { label: family ? "Edit" : "Add family", form } : undefined}>
      {family ? (
        <div className="flex flex-col gap-2.5">
          <p className="font-medium text-ink">{family.name}</p>
          <ul className="flex flex-col gap-1.5" aria-label="Family members">
            {family.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3">
                {m.id === client.id ? (
                  <span className="text-ink">{`${m.firstName} ${m.lastName}`.trim()}</span>
                ) : (
                  <Link href={`/clients/${m.id}`} className={nameLinkClass}>
                    {`${m.firstName} ${m.lastName}`.trim()}
                  </Link>
                )}
                {family.payerId === m.id && <Badge tone="neutral">Usually pays</Badge>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-13 text-ink-muted">Not linked to a family. Link a parent and their children, or a couple, to see them together.</p>
      )}
    </SideCard>
  );
}

function FamilyForm({ client, family }: { client: FamilyMember; family: Family | null }) {
  const close = useCloseCardAction();
  const [name, setName] = useState(family?.name ?? suggestedName(client.lastName));
  const [members, setMembers] = useState<FamilyMember[]>(family?.members ?? [client]);
  const [payerId, setPayerId] = useState<string | null>(family?.payerId ?? null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ClientOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [searching, startSearch] = useTransition();

  function search(value: string) {
    setQuery(value);
    if (value.trim().length < 2) return setFound([]);
    startSearch(async () => {
      const results = await reach(findClients(value));
      if (Array.isArray(results)) setFound(results.filter((r) => !members.some((m) => m.id === r.id)));
    });
  }

  function add(option: ClientOption) {
    const [firstName, ...rest] = option.name.split(" ");
    setMembers((all) => [...all, { id: option.id, firstName, lastName: rest.join(" ") }]);
    setQuery("");
    setFound([]);
  }

  function remove(id: string) {
    setMembers((all) => all.filter((m) => m.id !== id));
    if (payerId === id) setPayerId(null);
  }

  return (
    <form
      aria-label="Family"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await reach(saveFamily({ familyId: family?.id ?? null, name, clientIds: members.map((m) => m.id), payerId }));
          if (r.ok) close(r.message);
          else setError(r.message);
        });
      }}
    >
      <label className={labelClass}>
        Family name
        <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} maxLength={80} required />
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-13 font-medium text-ink">Who&rsquo;s in it, and who usually pays</legend>
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3">
            <label className="flex min-h-9 items-center gap-2 text-ink">
              <input type="radio" name="payer" checked={payerId === m.id} onChange={() => setPayerId(m.id)} className={checkboxClass} />
              {`${m.firstName} ${m.lastName}`.trim()}
            </label>
            {m.id !== client.id && (
              <Button size="sm" variant="quiet" onClick={() => remove(m.id)} aria-label={`Take ${m.firstName} out of the family`}>
                Remove
              </Button>
            )}
          </div>
        ))}
        <label className="flex min-h-9 items-center gap-2 text-ink-muted">
          <input type="radio" name="payer" checked={payerId === null} onChange={() => setPayerId(null)} className={checkboxClass} />
          Each pays their own
        </label>
      </fieldset>
      {members.length < MAX_FAMILY && (
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>
            Add someone
            <input type="search" value={query} onChange={(e) => search(e.target.value)} className={fieldClass} placeholder="Name or phone" autoComplete="off" aria-busy={searching} />
          </label>
          {found.length > 0 && (
            <ul className="flex flex-col rounded-lg border border-line" aria-label="Matching clients">
              {found.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => add(f)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus">
                    <span className="text-ink">{f.name}</span>
                    {f.phone && <span className="text-13 text-ink-muted tabular-nums">{f.phone}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-muted">Someone new? Add them as a client first, then link them here.</p>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending || members.length < 2}>
          Save
        </Button>
        <Button size="sm" variant="quiet" onClick={() => close()}>
          Cancel
        </Button>
        {family && (
          <Button
            size="sm"
            variant="quiet"
            className="ml-auto text-danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await reach(deleteFamily(family.id, family.members.map((m) => m.id)));
                if (r.ok) close(r.message);
                else setError(r.message);
              })
            }
          >
            Remove family
          </Button>
        )}
      </div>
    </form>
  );
}
