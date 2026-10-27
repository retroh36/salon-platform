// Shared looks for the salon's client pages (the booking site, its manage
// and account pages, and the pay, card, event and unsubscribe links). A
// plain module, so server pages can use them too.

// The booking site's buttons (the salon's pages): Maestra's shapes (8px
// corners, never pills), the salon's color for the one main action. 48px
// tall and 16px text, for a phone.
const buttonBase =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-5 text-base font-semibold transition-[filter,opacity,background-color,transform] duration-(--motion-fast) active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed";
export const primaryButton = `${buttonBase} w-full bg-(--accent) text-white hover:brightness-110 disabled:opacity-40`;
// Outlined, beside the main action.
export const secondaryButton = `${buttonBase} border border-line-strong bg-surface text-ink hover:bg-sunken disabled:opacity-55`;
// The confirming step of something that can't be taken back.
export const dangerButton = `${buttonBase} bg-danger text-white hover:brightness-95 disabled:opacity-55`;
// A smaller outlined button inside an item.
export const smallButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-55";
// A text link in the salon's color.
export const accentLink = "font-medium text-(--accent) underline underline-offset-2 hover:no-underline disabled:opacity-50";
export const choiceClass =
  "group flex min-h-16 w-full items-center gap-4 rounded-lg border bg-surface px-4 py-3 text-left transition-[border-color,background-color,box-shadow] duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
export const inputClass =
  "min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-subtle focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus/25 focus:outline-none";
// A section on a client page: a title over a thin rule, no box.
export const sectionTitle = "border-b border-line pb-2 text-base font-semibold text-ink";
// One of a few choices (a tip, what they're planning): the salon's color
// when it's the one chosen.
export function chipClass(on: boolean) {
  return `inline-flex items-center justify-center rounded-lg border text-sm font-medium transition-colors duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
    on ? "border-(--accent) bg-(--accent) text-white" : "border-line-strong bg-surface text-ink hover:bg-sunken"
  }`;
}
// A page's title on a client page (24px), and the line under it.
export const pageTitle = "text-2xl font-semibold tracking-[-0.015em] text-ink";
export const pageLead = "mt-1.5 text-ink-muted";
// Outlined in red: the first step of something that can't be taken back.
export const dangerOutlineButton = `${buttonBase} border border-line-strong bg-surface text-danger hover:bg-danger-soft disabled:opacity-55`;
