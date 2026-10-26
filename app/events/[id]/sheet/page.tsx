import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingShell, NotLinked } from "@/components/app-shell";
import { Badge } from "@/components/ui/page";
import { BackLink } from "@/components/ui/back-link";
import { getCurrentStaff } from "@/lib/auth";
import { daySheet } from "@/lib/events/day-sheet";
import { loadEvent, loadEventTeam } from "@/lib/events/load";
import { isUuid } from "@/lib/ids";
import { formatEventDay } from "../../format";
import { PrintButton } from "./print";

export const metadata: Metadata = { title: "Day-of sheet" };

export default function SheetPage({ params, searchParams }: PageProps<"/events/[id]/sheet">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Sheet params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const ROLE_TEXT = { hair: "Hair", makeup: "Makeup" } as const;

// The day-of sheet: one page to print or save as a PDF for the team, made
// from the event as saved.
async function Sheet({ params, searchParams }: Pick<PageProps<"/events/[id]/sheet">, "params" | "searchParams">) {
  const [{ id }, query, { supabase, staff: me }] = await Promise.all([params, searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isUuid(id)) notFound();
  const [event, team] = await Promise.all([loadEvent(supabase, id, me.location.timezone), loadEventTeam(supabase, me.location.id)]);
  if (!event) notFound();
  const sheet = daySheet(event, (sid) => team.find((t) => t.id === sid)?.firstName ?? null);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 bg-surface px-4 py-6 text-sm text-ink sm:px-8 print:max-w-none print:p-0" data-testid="day-sheet">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <BackLink href={`/events/${id}`}>Event</BackLink>
        <PrintButton auto={query.print === "1"} />
      </div>
      <header className="flex flex-col gap-1 border-b border-line-strong pb-4">
        <p className="text-xs font-medium text-ink-muted">{me.location.business.name} · Day-of sheet</p>
        <h1 className="text-2xl font-semibold text-ink">{sheet.title}</h1>
        <p className="text-base text-ink">
          {formatEventDay(event.date)}
          {sheet.readyBy && <> · ready by <strong>{sheet.readyBy}</strong></>}
        </p>
        <p className="text-ink-muted">{sheet.where}{event.onLocation && event.travelMinutes ? ` · ${event.travelMinutes} minutes' travel each way` : ""}</p>
        {event.client && (
          <p className="text-ink-muted">
            Contact: {event.client.firstName} {event.client.lastName}
            {event.client.phone && ` · ${event.client.phone}`}
          </p>
        )}
      </header>

      <section aria-labelledby="sheet-team" className="break-inside-avoid">
        <h2 id="sheet-team" className="mb-2 text-base font-semibold text-ink">
          Team
        </h2>
        <table className="w-full border-collapse text-left">
          <thead className="text-xs text-ink-muted">
            <tr className="border-b border-line">
              <th className="py-1 pr-3 font-medium">Artist</th>
              {event.onLocation && <th className="py-1 pr-3 font-medium">Leave</th>}
              <th className="py-1 pr-3 font-medium">Call</th>
              <th className="py-1 pr-3 font-medium">Done</th>
              <th className="py-1 font-medium">Doing</th>
            </tr>
          </thead>
          <tbody>
            {sheet.artists.map((a) => (
              <tr key={a.name} className="border-b border-line align-top">
                <td className="py-1.5 pr-3">
                  <span className="font-medium">{a.name}</span> <span className="text-ink-muted">{a.roles.map((r) => ROLE_TEXT[r]).join(" + ")}</span>
                </td>
                {event.onLocation && <td className="py-1.5 pr-3 tabular-nums">{a.leave}</td>}
                <td className="py-1.5 pr-3 font-semibold tabular-nums">{a.call}</td>
                <td className="py-1.5 pr-3 tabular-nums">{a.done}</td>
                <td className="py-1.5">{a.people.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sheet.unassigned > 0 && (
          <p className="mt-2 flex items-center gap-2">
            <Badge tone="warning">Not chosen</Badge>
            <span className="text-ink-muted">{sheet.unassigned === 1 ? "One artist isn't chosen yet." : `${sheet.unassigned} artists aren't chosen yet.`}</span>
          </p>
        )}
      </section>

      <section aria-labelledby="sheet-order" className="break-inside-avoid">
        <h2 id="sheet-order" className="mb-2 text-base font-semibold text-ink">
          Running order
        </h2>
        <table className="w-full border-collapse text-left" data-testid="running-order">
          <tbody>
            {sheet.order.map((r, i) => (
              <tr key={i} className="border-b border-line">
                <td className="w-40 py-1.5 pr-3 whitespace-nowrap tabular-nums">{r.time}</td>
                <td className="py-1.5 pr-3 font-medium">{r.who}</td>
                <td className="py-1.5 pr-3">{r.what}</td>
                <td className="py-1.5 text-ink-muted">{r.artist}</td>
              </tr>
            ))}
            {sheet.readyBy && (
              <tr>
                <td className="py-1.5 pr-3 font-semibold tabular-nums">{sheet.readyBy}</td>
                <td className="py-1.5 font-semibold" colSpan={3}>
                  Everyone ready
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="sheet-party" className="break-inside-avoid">
        <h2 id="sheet-party" className="mb-2 text-base font-semibold text-ink">
          Party ({sheet.party.length})
        </h2>
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 print:grid-cols-2">
          {sheet.party.map((p, i) => (
            <li key={i}>
              <span className="font-medium">{p.name}</span> <span className="text-ink-muted">· {p.role} · {p.packageName}</span>
            </li>
          ))}
        </ul>
      </section>

      {(sheet.look || sheet.notes) && (
        <section aria-labelledby="sheet-look" className="break-inside-avoid">
          <h2 id="sheet-look" className="mb-2 text-base font-semibold text-ink">
            The look and notes
          </h2>
          {sheet.look && <p className="whitespace-pre-line">{sheet.look}</p>}
          {sheet.notes && <p className="mt-2 whitespace-pre-line text-ink-muted">{sheet.notes}</p>}
        </section>
      )}
    </main>
  );
}
