import { Skeleton } from "@/components/ui/feedback";

// A client's profile while their records load: the back link, the header
// (avatar, name, contact, tags, actions), the notes and tabs with a few
// visits, and the side cards, as placeholders that shimmer slowly (still,
// with reduced motion).
const delay = (i: number) => ({ animationDelay: `${i * 80}ms` });

export function ProfileSkeleton() {
  return (
    <div role="status" aria-busy aria-label="Loading the client" data-testid="profile-skeleton">
      <Skeleton className="mb-4 h-4 w-16" />
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <Skeleton className="size-14 shrink-0 rounded-full!" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-5 w-20" />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[24, 28, 28, 28].map((w, i) => (
            <Skeleton key={i} className="h-9 rounded-lg!" style={{ width: `${w * 4}px`, ...delay(i) }} />
          ))}
        </div>
      </div>
      <div className="@container">
        <div className="grid gap-x-8 gap-y-8 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Skeleton className="h-20 rounded-lg!" />
            <div className="flex gap-6 border-b border-line pb-2.5">
              {[14, 18, 14, 20, 12].map((w, i) => (
                <Skeleton key={i} className="h-4" style={{ width: `${w * 4}px`, ...delay(i) }} />
              ))}
            </div>
            <div className="flex flex-col">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center justify-between gap-4 border-b border-line py-3.5">
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-32" style={delay(i)} />
                    <Skeleton className="h-3.5 w-56" style={delay(i)} />
                  </div>
                  <Skeleton className="h-4 w-14" style={delay(i)} />
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((card) => (
              <div key={card} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
                <Skeleton className="h-5 w-28" style={delay(card)} />
                {card === 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: 4 }, (_, i) => (
                      <Skeleton key={i} className="h-14" style={delay(i)} />
                    ))}
                  </div>
                ) : (
                  <>
                    <Skeleton className="h-4" style={delay(card)} />
                    <Skeleton className="h-4 w-2/3" style={delay(card)} />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
