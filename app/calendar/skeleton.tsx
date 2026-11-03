import { Skeleton } from "@/components/ui/feedback";

// The calendar's shape while the day loads: the title and toolbar, then the
// grid with its time column, a header per stylist and a few soft blocks, as
// placeholders that shimmer slowly (still, with reduced motion).
const delay = (i: number) => ({ animationDelay: `${i * 80}ms` });
const COLUMNS = 5;
const HOURS = 8;
// Where each column's placeholder blocks sit: [first hour, hours long].
const BLOCKS: [number, number][][] = [
  [[0.5, 1.5], [3, 1], [5.5, 2]],
  [[1, 2.5], [4.5, 1]],
  [[0, 1], [2, 1], [5, 2.5]],
  [[1.5, 1], [3.5, 2]],
  [[0.5, 2], [4, 1.5]],
];
const HOUR_PX = 64;

export function CalendarSkeleton() {
  return (
    <div role="status" aria-busy aria-label="Loading the calendar" data-testid="calendar-skeleton" className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-6 pb-4 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-5 w-56" />
        </div>
        <Skeleton className="h-10 w-36 rounded-lg!" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="size-9 rounded-lg!" />
        <Skeleton className="size-9 rounded-lg!" />
        <Skeleton className="h-9 w-20 rounded-lg!" />
        <Skeleton className="ml-auto h-9 w-48 rounded-lg!" />
        <Skeleton className="h-9 w-28 rounded-lg!" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-surface">
        <div className="grid border-b border-line-strong" style={{ gridTemplateColumns: `4rem repeat(${COLUMNS}, minmax(9.5rem, 1fr))` }}>
          <div />
          {Array.from({ length: COLUMNS }, (_, i) => (
            <div key={i} className="flex items-center gap-2.5 border-l border-line px-3 py-3">
              <Skeleton className="size-9 shrink-0 rounded-full!" style={delay(i)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-20" style={delay(i)} />
                <Skeleton className="h-3 w-24" style={delay(i)} />
              </div>
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `4rem repeat(${COLUMNS}, minmax(9.5rem, 1fr))` }}>
          <div className="flex flex-col">
            {Array.from({ length: HOURS }, (_, h) => (
              <div key={h} className="flex justify-end px-2 pt-1" style={{ height: HOUR_PX }}>
                <Skeleton className="h-3 w-8" />
              </div>
            ))}
          </div>
          {BLOCKS.map((blocks, i) => (
            <div
              key={i}
              className="relative border-l border-line"
              style={{ height: HOURS * HOUR_PX, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_PX - 1}px, var(--color-line) ${HOUR_PX - 1}px ${HOUR_PX}px)` }}
            >
              {blocks.map(([at, long], j) => (
                <Skeleton key={j} className="absolute inset-x-1.5" style={{ top: at * HOUR_PX + 2, height: long * HOUR_PX - 4, ...delay(i + j) }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
