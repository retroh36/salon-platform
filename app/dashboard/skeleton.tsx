import { Skeleton } from "@/components/ui/feedback";

// The Dashboard's shape while its numbers load: Denise's brief, the stat
// strip, Right now and the team, as soft placeholders that shimmer slowly
// (still, with reduced motion).
const delay = (i: number) => ({ animationDelay: `${i * 80}ms` });

export function DashboardSkeleton() {
  return (
    <div aria-busy aria-label="Loading the dashboard" role="status" data-testid="dashboard-skeleton">
      <div className="mb-8 flex flex-col gap-6 rounded-lg border border-denise-200 bg-denise-50 p-4 sm:p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-lg! bg-denise-100! sm:size-16" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-36 bg-denise-100!" />
            <Skeleton className="h-4 w-48 bg-denise-100!" />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-6">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex min-w-0 flex-1 basis-72 flex-col gap-3">
              <Skeleton className="h-4 w-32 bg-denise-100!" style={delay(i)} />
              <Skeleton className="h-10 bg-denise-100!" style={delay(i)} />
              <Skeleton className="h-10 bg-denise-100!" style={delay(i)} />
            </div>
          ))}
        </div>
      </div>

      <Skeleton className="mb-3 h-5 w-40" />
      <div className="mb-8 flex flex-wrap gap-px overflow-hidden rounded-lg border border-line bg-line">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex min-w-0 flex-1 basis-40 flex-col gap-2 bg-surface px-4 py-3">
            <Skeleton className="h-4 w-24" style={delay(i)} />
            <Skeleton className="h-7 w-16" style={delay(i)} />
            <Skeleton className="h-3 w-28" style={delay(i)} />
          </div>
        ))}
      </div>

      <div className="mb-8 rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24" style={delay(i)} />
              <Skeleton className="h-9" style={delay(i)} />
            </div>
          ))}
        </div>
      </div>

      <Skeleton className="mb-3 h-5 w-32" />
      <div className="mb-8 grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8 rounded-full!" style={delay(i)} />
              <Skeleton className="h-4 w-20" style={delay(i)} />
            </div>
            <Skeleton className="h-1" style={delay(i)} />
            <Skeleton className="h-3 w-28" style={delay(i)} />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
