// A stylist's portrait on the client pages (their account, a visit's own
// page), round; their initial on the salon's soft color without one.
export function StylistPhoto({ name, url, className = "size-11" }: { name: string; url: string | null; className?: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" data-testid="stylist-photo" className={`${className} shrink-0 rounded-full bg-sunken object-cover`} />
  ) : (
    <span aria-hidden data-testid="stylist-photo" className={`${className} inline-flex shrink-0 items-center justify-center rounded-full bg-(--accent-soft) font-semibold text-(--accent)`}>
      {name.slice(0, 1)}
    </span>
  );
}
