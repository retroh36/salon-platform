// The Dashboard's shape while its numbers load: soft placeholders that
// shimmer slowly (still, with reduced motion).
const block = "animate-skeleton rounded-xl bg-sunken";

export function DashboardSkeleton() {
  return (
    <div aria-busy aria-label="Loading the dashboard" role="status" data-testid="dashboard-skeleton">
      <div className={`${block} mb-6 h-40 border border-denise-100 bg-denise-50`} />
      <div className={`${block} mb-3 h-5 w-40`} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={`${block} h-28`} style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <div className={`${block} mb-6 h-44`} />
      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${block} h-32`} style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
