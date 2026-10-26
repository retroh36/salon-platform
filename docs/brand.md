# Maestra brand guide

How Maestra looks and sounds. Follow this for anything users see: screens,
emails, icons, previews and copy. Colors and fonts are implemented as design
tokens in `app/globals.css`; this guide says what they're for.

## Name and meaning

**Maestra** is the master who conducts the whole salon: the calendar, the
team, the clients, the stock and the back office, all in time with each
other. The name is always written with a capital M and the rest lowercase:
*Maestra*, never *MAESTRA* or *maestra* (outside file names and code).

**Tagline:** *Your salon's brain. Meet Denise.*

Use the tagline on the login screen, link previews and marketing. In the
app itself, don't repeat it: the salon is there to work.

## Two brands, kept apart

Maestra is the platform. Each salon has its own brand, and the two never mix.

| Maestra (the product) | The salon (e.g. Maple & Ash) |
| --- | --- |
| Login screen, loading screen | Top of the sidebar: its logo (or initial) and name |
| Browser tab, app icon, home-screen icon | Messages to its clients (texts, emails, confirmations) and its booking site |
| Link previews (social image) | |
| Emails from the platform (sign-in, invites, password reset) | |
| "Powered by Maestra", small, at the foot of the sidebar | |

The salon's booking site (`/book/<salon>`) is the salon's: its logo or
initial, its name and its own color lead, in Maestra's type, layout and
calm feel, with "Powered by Maestra" small at the foot. A salon's color
must pass WCAG AA with white text on it (Settings checks this).

Salon owners set their salon's name and logo on the Settings page. Without
a logo, the salon's initial shows in a navy leaf shape. Never put the
Maestra logo on a message a salon sends its clients, and never put a
salon's logo on a Maestra screen like the login page.

## Logo files

All in `public/brand/maestra/`.

| File | What it is | Use it for |
| --- | --- | --- |
| `maestra-logo.png` | Mark and wordmark, navy and near-black, transparent | The default logo on light backgrounds |
| `maestra-logo-white.png` | The same, all white | Navy or dark backgrounds (the login panel, the social image) |
| `maestra-mark.svg` / `.png` | The M mark alone, navy | Small spaces, "Powered by", the loading screen; anywhere the name is already shown nearby |
| `maestra-mark-white.svg` | The mark, white | The mark on navy |
| `maestra-mark-small.svg` | The mark with its cuts slightly widened | Only at 24px and below (favicons), where the full mark's cuts close up |
| `maestra-wordmark.png` / `-white.png` | "Maestra" alone | Rarely: only where the mark is already present |
| `email-header.png` | The logo on white with a navy rule, 1120×200 | The top of platform emails (shown at 560px wide) |

Generated from the logo (don't edit by hand; regenerate from the logo files):

- `app/favicon.ico` (16, 32, 48), `app/icon.svg` (the SVG favicon),
  `app/apple-icon.png` (180), `public/icons/icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png`, and `app/manifest.ts`: the app icon is the white
  mark on a navy tile. The 16px icon and the SVG favicon use the small mark.
- `app/opengraph-image.png` and `app/twitter-image.png` (1200×630): the
  white logo and the tagline on navy, with Denise.

The SVG mark was traced from the original PNG and matches its outline to
within half a pixel. Don't redraw, stretch, rotate, recolor (other than
navy, white or near-black #141414), outline, add effects to, or rearrange
the mark and wordmark.

### Clear space

Keep space around the logo equal to at least **half the mark's height** on
every side: no text, edges or other graphics in it. For the mark alone,
keep a quarter of its height clear.

### Minimum sizes

| Logo | Smallest |
| --- | --- |
| Full logo (mark + wordmark) | 96px wide on screen, 25mm in print |
| Mark | 24px tall; below that, use `maestra-mark-small.svg` (16px is the floor) |
| Wordmark | 64px wide |

## Colors

### Brand

| Token | Hex | Role |
| --- | --- | --- |
| `navy-900` | `#17273B` | **Primary.** The logo's navy. Buttons, selected states, the active nav item, headings, the app icon |
| `navy-800` | `#233A57` | Hover on primary buttons |
| `navy-700` | `#2D4A6E` | Secondary navy: hover text, group outlines |
| `navy-200` | `#CFD8E5` | Borders on navy tints |
| `navy-100` | `#E8EDF4` | Tints: the active nav item, avatars, selected rows |
| `link` | `#1D64C4` | **Links** (underlined text actions). Same hue as the navy, brighter |
| `link-hover` | `#174F9C` | Links on hover |
| `focus` | `#1D64C4` | Keyboard focus rings |
| (wordmark) | `#141414` | The wordmark's near-black; only in the logo |

### Surfaces and text

| Token | Hex | Role |
| --- | --- | --- |
| `canvas` | `#FAFAF9` | The page: a neutral near-white |
| `surface` | `#FFFFFF` | Cards, panels, fields |
| `sunken` | `#F4F4F3` | Recessed areas, the sidebar, table headers, hover |
| `line` / `line-strong` | `#E6E7EA` / `#D3D5DA` | Dividers and borders (fields and outlined buttons use `line-strong`) |
| `ink` | `#191C22` | Body text, names, titles (names are dark text, not link blue) |
| `ink-muted` | `#5C6170` | Secondary text |
| `ink-subtle` | `#696E7B` | Hints, placeholders, counts |
| `now` | `#C8323A` | The calendar's current-time line |

### Status: one set

Every tag, alert and notice uses these, and nothing else: a small dot and a
short label in the ink, on the soft fill. Never a colored sentence.

| Status | Ink | Soft fill | Dot | For |
| --- | --- | --- | --- | --- |
| `success` | `#15703A` | `#ECF7EF` | `#22A35A` | Charged, paid, confirmed |
| `warning` | `#A6460A` | `#FDF3E7` | `#EE8A1C` | Needs attention: no card on file, running late |
| `danger` | `#B42318` | `#FDEEEC` | `#E5484D` | Failed, declined, no-show; errors; destructive buttons |
| `info` | `#1D55B8` | `#EDF3FD` | `#3B7BE0` | Checked in, kept from deposit |
| `neutral` | `#4D5361` | `#F1F2F4` | `#9AA0AB` | Waived, booked, completed |

Appointment statuses (`status-*` tokens) are drawn from this set. On a
calendar block, "+5m" and "Not arrived" use `block-attention` (`#8C3A08`),
the warning a step darker so it reads on every fill.

### Denise: periwinkle, only for her

| Token | Hex |
| --- | --- |
| `denise-50` / `-100` / `-200` | `#F4F5FF` / `#E8EAFD` / `#CFD4FA` |
| `denise-500` | `#6C78E0` (her accent, the glow on blocks she's talking about) |
| `denise-600` | `#4E59C9` (her badge) |
| `denise-700` / `-900` | `#3F49B0` / `#272D75` (her text) |

Periwinkle means "Denise is speaking": her messages, suggestions, badge and
highlights. Don't use it for anything else, and don't use navy or the link
blue for her. It's deliberately a different hue from both (the token tests
check this).

### Service colors (the calendar)

Slightly muted, so the client's name reads cleanly on them.

| Family | Fill | Accent edge |
| --- | --- | --- |
| Color | `#F7E1D4` peach | `#D9733F` |
| Cuts | `#E7E1F5` lavender | `#8669CF` |
| Gloss & blowouts | `#DDE9DF` sage | `#5A9568` |
| Treatments | `#D7EBE8` soft teal | `#3D968F` |
| Other | `#EBE5DF` sand | `#9C8771` |

Where the client is in their visit fills the block instead: `visit-here`
`#FCF1AE` (checked in), `visit-done` `#B3D9B8` (checked out), `visit-off`
`#E3E5E9` (no-show, name struck through).

### Stylist levels

| Level | Token | Hex | Badge |
| --- | --- | --- | --- |
| Master | `level-master` | `#A0700A` rich gold | a star |
| Senior | `level-senior` | `#7A1F55` berry | two dots |
| Artisan | `level-artisan` | `#0B6A3C` emerald | one dot |

On the calendar a level shows as a 3px ring around the stylist's avatar
with a small badge in its corner (so it's never color alone), and a 4px bar
along the top of their column, explained by the legend. They're graphics,
so they meet 3:1 against the page. They're kept clearly apart from each
other, the service colors and Denise's periwinkle, with normal vision and
with protanopia, deuteranopia and tritanopia simulated (the token tests
check all of it). The level's name appears in staff settings and on the
booking site, not on the calendar.

Status chips have their own pairs (booked, confirmed, checked in, completed,
running late, no-show) in `globals.css`.

### Contrast

Every text/background pair meets WCAG AA (4.5:1), and focus rings and
service accents meet 3:1. `tests/unit/design-tokens.test.ts` checks them
all: add any new pair there. Use only the tokens, never Tailwind's palette
or one-off hex values.

## Typography

- **Geist** (the `geist` package, through `next/font`) for everything:
  titles, body, labels, buttons, numbers, the booking site and the login
  screen. No serif anywhere in the product.
- **Geist Mono** only where characters must line up as code (gift card
  codes, a formula's amounts). Money and counts use Geist with tabular
  figures (`tabular-nums`), so columns line up.
- **The scale:** 12, 13, 14, 16, 20 and 24px (`text-xs`, `text-13`,
  `text-sm`, `text-base`, `text-xl`, `text-2xl`). Page titles 24px semibold
  with slight negative letter-spacing (`PageHeader`); section and card
  titles 16px semibold; body 14px (the app's default); labels 13px medium;
  meta and tags 12px. Hierarchy comes from weight and color, not size.
- Small labels are sentence case, never spaced-out capitals.
- The wordmark is part of the logo: never set "Maestra" in a font to stand
  in for it.
- Sentence case everywhere ("New booking", not "New Booking").

## Layout

The style is calm and flat, like a good dashboard: neutral grays, navy for
the one main action, one layer of containers.

- **Spacing** is on a 4px grid. Pages: 32px from the top, 16px (phones) or
  32px at the sides, `max-w-5xl` (`max-w-6xl` for wide pages) (`AppShell`).
  Cards: 16px padding, a 12px header row. Rows: 12px by 16px.
- **One layer of containers.** Never a bordered or tinted box inside another
  box. Groups and columns are a `Section`: a 16px title over the items, or
  a label over a thin rule. Only the items themselves are cards: a 1px
  `line` border, 8px corners, no shadow (`Card`). Shadows are only for what
  floats over the page: menus, popovers, sheets, toasts, a dragged block.
- **Buttons** (`components/ui/button.tsx`): one `primary` (filled navy) per
  page or panel; `secondary` (outlined) beside it; row actions as `quiet`
  text buttons; less common actions in a "⋯" menu; `danger` (filled red)
  only for the confirming step of something destructive, `danger-quiet`
  (red text) to start it. All 36px tall (40px `lg`, 32px `xs` in dense
  rows, 44px on a touchscreen), 8px corners, a 6px gap to an icon. No
  pill-shaped buttons or chips.
- **Status** is a small tag (`Badge`, `StatusChip`): a dot and a short
  label from the status set. **Alerts** (`Alert`) are the soft fill with a
  dot, no border.
- **Tables** (`components/ui/table.tsx`) for lists of records: a quiet
  header row, aligned columns, money right-aligned in tabular figures, a
  thin rule between rows, quiet actions at the end.
- **Links:** the link blue only for links that read as links ("See all",
  "Open event"). Names of people and records are dark text, underlined on
  hover (`nameLinkClass`).
- **Empty, loading, toasts:** `EmptyState` (one quiet centered line, an
  optional title and action), `Skeleton` placeholders that shimmer slowly,
  and navy toasts at the foot of the screen with at most one action
  (`components/ui/feedback.tsx`).

Every component, in each of its states, is on the owners' style guide at
`/design` (not in the sidebar).

## Voice

Plain, warm and brief. Talk to salon staff the way a calm, capable front
desk lead would: say what happened and what to do, without jargon or
exclamation marks.

## Denise

Denise (short for DNIS, Digital Navigator of Issues and Scheduling) is
Maestra's AI assistant, and the reason for the tagline's second half.

- **Her role:** she watches the day (overruns, late clients, call-outs,
  double-bookings, stock running low, time that opens up for the waitlist),
  proposes fixes, and answers "Ask Denise". Staff approve what she
  proposes; everything she does goes through the AI action log and can be
  undone. She never changes anything on her own.
- **Her personality:** helpful, calm and a little warm. She speaks in the
  first person ("I spotted something"), briefly, and explains why a fix
  works. No hype, no apologies for existing, no emoji.
- **Her boundaries:** she never talks to clients. Messages to clients use
  the salon's approved templates and come from the salon. She sees first
  names and scheduling facts, never phone numbers, emails, allergies or
  notes.
- **Her look:** periwinkle, and her art in `public/brand/denise/` (`wave`:
  nothing to do, `think`: working, `point`: presenting a fix, `face`: the
  small icon). On the calendar her face sits at the end of the legend bar,
  never over appointments.
