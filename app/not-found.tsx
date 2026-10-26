import { NotFoundLink } from "./not-found-link";

// An address that doesn't lead anywhere (an old link, a typo).
export default function NotFound() {
  return (
    <div className="mx-auto my-16 max-w-md rounded-lg border border-line bg-surface p-6 text-ink">
      <h1 className="text-xl font-semibold">We can&apos;t find that page</h1>
      <p className="mt-2 text-sm text-ink-muted">The link may be old, or the address mistyped.</p>
      <NotFoundLink />
    </div>
  );
}
