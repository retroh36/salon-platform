"use client";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/page";
import { Sheet } from "@/components/ui/sheet";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute } from "@/lib/scheduling/time";
import { sayShifts, type Change } from "@/lib/team-schedule";
import type { GridPerson } from "@/lib/team-schedule-load";

// What publishing the week changes, person by person, and the clients the
// new hours leave outside them (moved afterwards with the Mark out panel).
export function PublishSheet({ changes, people, pending, onClose, onPublish }: { changes: Change[]; people: GridPerson[]; pending: boolean; onClose: () => void; onPublish: () => void }) {
  const byPerson = people.map((p) => ({ person: p, changes: changes.filter((c) => c.staffId === p.id) })).filter((g) => g.changes.length);
  const affected = changes.reduce((n, c) => n + c.affected.length, 0);
  return (
    <Sheet title="Publish this week" onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink">
          {byPerson.length} {byPerson.length === 1 ? "person's" : "people's"} hours change. Each of them gets a notice, and the calendar and online booking use the new hours.
        </p>
        <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Changes">
          {byPerson.map(({ person, changes }) => (
            <li key={person.id} className="px-4 py-3">
              <p className="text-sm font-semibold text-ink">{person.name}</p>
              <ul className="mt-1 flex flex-col gap-1 text-13">
                {changes.map((c) => (
                  <li key={c.date} className="text-ink-muted">
                    <span className="text-ink">{formatDay(c.date)}</span>: {sayShifts(c.before)} → <span className="text-ink">{sayShifts(c.after)}</span>
                    {c.affected.length > 0 && (
                      <span className="text-warning">
                        {" "}
                        · {c.affected.map((b) => `${b.client} at ${formatMinute(b.start)}`).join(", ")} booked outside
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {affected > 0 && (
          <Alert tone="warning">
            {affected} {affected === 1 ? "client is" : "clients are"} booked outside the new hours. Publishing doesn&rsquo;t move them: after publishing, use the links to move them with the Mark out panel.
          </Alert>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={onPublish}>
            Publish and tell {byPerson.length} {byPerson.length === 1 ? "person" : "people"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
