import { salonInitial } from "@/lib/branding";

// The salon's own mark: its uploaded logo, or its initial in a soft leaf.
export function SalonMark({ name, logoUrl, size = "md" }: { name: string; logoUrl: string | null; size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-16 text-3xl rounded-[20px_6px_20px_6px]" : "size-10 text-xl rounded-[14px_4px_14px_4px]";
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt="" data-testid="salon-logo" className={`${box} shrink-0 bg-surface object-contain`} />
    );
  }
  return (
    <span aria-hidden data-testid="salon-initial" className={`${box} inline-flex shrink-0 items-center justify-center bg-navy-900 font-serif text-white`}>
      {salonInitial(name)}
    </span>
  );
}
