// A stand-in for a product photo: a plain drawn container (bottle,
// dropper, spray, jar or tube, from the product's name) on a soft tile, in
// the app's neutral colors, so no brand ever shows.

export type ProductShape = "bottle" | "dropper" | "spray" | "jar" | "tube";

const SHAPES: [ProductShape, RegExp][] = [
  ["spray", /spray|mist|hairspray|aerosol|dry shampoo|primer|finish|texture/i],
  ["dropper", /oil|serum|perfector|elixir|drops?\b|tonic/i],
  ["jar", /mask|masque|pomade|paste|clay|wax|balm|butter|scrub|pot\b|jar\b/i],
  ["tube", /gel|tube|cream|lotion|polish|lacquer|cuticle/i],
];

// Back-bar color sold by weight comes in tubes.
export function productShape(name: string, unit?: string): ProductShape {
  return SHAPES.find(([, re]) => re.test(name))?.[0] ?? (unit === "g" ? "tube" : "bottle");
}

// Cap colors, picked steadily from the name so a shelf of the same shape
// still reads as different products.
const CAPS = ["var(--color-navy-200)", "var(--color-sand-fill)", "var(--color-line-strong)"];

function capOf(name: string): string {
  return CAPS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % CAPS.length];
}

const BODY = { fill: "var(--color-surface)", stroke: "var(--color-ink-muted)", strokeWidth: 1.5, strokeLinejoin: "round" as const };

function Drawing({ shape, cap }: { shape: ProductShape; cap: string }) {
  const capStyle = { ...BODY, fill: cap };
  switch (shape) {
    case "spray":
      return (
        <>
          <rect x="17" y="8" width="6" height="4" rx="1" {...capStyle} />
          <path d="M23 9.5h3" {...BODY} fill="none" />
          <rect x="15" y="12" width="10" height="4" rx="1.5" {...capStyle} />
          <rect x="14" y="16" width="12" height="20" rx="3" {...BODY} />
          <path d="M17 22h6" {...BODY} fill="none" />
        </>
      );
    case "dropper":
      return (
        <>
          <path d="M18.5 7.5a1.5 1.5 0 0 1 3 0V12h-3z" {...capStyle} />
          <rect x="17" y="12" width="6" height="5" rx="1" {...capStyle} />
          <path d="M15 21a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z" {...BODY} />
          <path d="M18 25h4" {...BODY} fill="none" />
        </>
      );
    case "jar":
      return (
        <>
          <rect x="11" y="15" width="18" height="5" rx="1.5" {...capStyle} />
          <path d="M12 20h16v11a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4z" {...BODY} />
          <path d="M16 26h8" {...BODY} fill="none" />
        </>
      );
    case "tube":
      return (
        <>
          <path d="M15 8h10l-1.5 21h-7z" {...BODY} />
          <path d="M15 8h10" {...BODY} fill="none" />
          <rect x="16.5" y="29" width="7" height="7" rx="1.5" {...capStyle} />
          <path d="M18 15h4" {...BODY} fill="none" />
        </>
      );
    default:
      return (
        <>
          <rect x="17.5" y="7" width="5" height="5" rx="1" {...capStyle} />
          <path d="M16 12h8l1 3h-10z" {...capStyle} />
          <rect x="13.5" y="15" width="13" height="21" rx="3" {...BODY} />
          <path d="M17 21h6M17 24h4" {...BODY} fill="none" />
        </>
      );
  }
}

export function ProductThumb({ name, unit, size = "md" }: { name: string; unit?: string; size?: "md" | "lg" | "sm" }) {
  const shape = productShape(name, unit);
  return (
    <span
      aria-hidden
      data-shape={shape}
      className={`flex shrink-0 items-center justify-center rounded-md bg-sunken ${size === "lg" ? "size-14" : size === "sm" ? "size-9" : "size-11"}`}
    >
      <svg viewBox="7 5 26 33" className="h-[78%] w-auto">
        <Drawing shape={shape} cap={capOf(name)} />
      </svg>
    </span>
  );
}
