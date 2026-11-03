import { Skeleton } from "@/components/ui/feedback";

// The booking site's shapes while it loads, as placeholders that shimmer
// slowly (still, with reduced motion): the whole page before the salon's
// details arrive, the time step while times are found, and a short line
// while the policy is checked. Each says what it's waiting for to screen
// readers.
const delay = (i: number) => ({ animationDelay: `${i * 80}ms` });

// The page: the cover, the salon's intro beside the first step's services
// (above them on a phone).
export function SiteSkeleton() {
  return (
    <div role="status" aria-busy aria-label="Loading the booking page" data-testid="site-skeleton" className="min-h-dvh bg-canvas">
      <div className="mx-auto flex w-full max-w-5xl flex-col px-4 pt-3 md:px-8">
        <div className="flex justify-end gap-4 py-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="aspect-[5/2] w-full rounded-xl! md:aspect-[3/1]" />
        <div className="mt-6 flex flex-col gap-10 lg:flex-row lg:gap-12">
          <div className="flex flex-col gap-3 lg:w-[22rem] lg:shrink-0">
            <Skeleton className="size-18 rounded-[18px_6px_18px_6px]!" />
            <Skeleton className="mt-2 h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="mt-3 h-4 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Skeleton className="mb-2 h-7 w-56" />
            <ServiceRows />
          </div>
        </div>
      </div>
    </div>
  );
}

function ServiceRows() {
  return Array.from({ length: 4 }, (_, i) => (
    <div key={i} className="flex min-h-16 items-start gap-4 rounded-lg border border-line bg-surface px-4 py-3.5">
      <Skeleton className="size-6 shrink-0 rounded-full!" style={delay(i)} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-40" style={delay(i)} />
        <Skeleton className="h-3.5 w-16" style={delay(i)} />
      </div>
      <Skeleton className="h-4 w-16" style={delay(i)} />
    </div>
  ));
}

// The time step: the strip of dates (five across on a phone, seven wider,
// like the real one) and a day's times.
export function TimesSkeleton() {
  return (
    <div role="status" aria-busy data-testid="times-skeleton" className="flex flex-col gap-5">
      <span className="sr-only">Finding times…</span>
      <div className="@container">
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="min-h-18 w-[calc((100cqw-2rem)/5)] shrink-0 rounded-lg! @md:w-[calc((100cqw-3rem)/7)]" style={delay(i)} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-52" />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="min-h-12 rounded-lg!" style={delay(i)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// A few lines of text still on their way (the cancellation policy).
export function LinesSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" style={delay(1)} />
      <Skeleton className="h-4 w-2/3" style={delay(2)} />
    </div>
  );
}
