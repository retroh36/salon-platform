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
| Login screen, loading screen | The salon card under Maestra's logo in the sidebar: its logo (or initial), name and location |
| Browser tab, app icon, home-screen icon | Messages to its clients (texts, emails, confirmations) and its booking site |
| Link previews (social image) | |
| Emails from the platform (sign-in, invites, password reset) | |
| The white logo at the top of the navy sidebar (staff screens carry no "Powered by Maestra") | |
| "Powered by Maestra", small, at the foot of pages clients see (booking site, account, pay and card links) | |

The salon's booking site (`/book/<salon>`) is the salon's: its logo or
initial, its name and its own color lead, in Maestra's type, layout and
calm feel, with "Powered by Maestra" small at the foot. A salon's color
must pass WCAG AA with white text on it (Settings checks this).

Salon owners set their salon's name and logo on the Settings page. Without
a logo, the salon's initial shows in a navy leaf shape (on the bright blue
in the navy sidebar). Never put the
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
| `navy-100` | `#E8EDF4` | Tints: avatars, selected rows |
| `active` | `#1963D6` | **Maestra's bright blue**, on the navy's hue: the selected Day/Week (and every segmented choice), with white text |
| `active-soft` / `active-ink` | `#EAF2FE` / `#124C9F` | The active tint and its text: Today when it's today, the current item on the narrow screen's nav |
| `link` | `#1963D6` | **Links** (underlined text actions), in the same bright blue |
| `link-hover` | `#1556B8` | Links on hover |
| `focus` | `#1963D6` | Keyboard focus rings |
| (wordmark) | `#141414` | The wordmark's near-black; only in the logo |

### The sidebar

The staff sidebar is the logo's navy, with Maestra's white logo alone at
the top, the salon as a card under it, and the navigation below. The logo
is the biggest brand element there: its letters about 30px tall (the
1462×414 white PNG drawn 50px high, so it stays sharp on any screen, its padding trimmed by negative
margins), with room above and below, well over twice the salon name's
size. The salon card is a filled card with no border. Every text pair
passes AA (`tests/unit/design-tokens.test.ts`), and `e2e/sidebar.spec.ts`
checks the colors on screen.

| Token | Hex | Role |
| --- | --- | --- |
| `sidebar` | `#17273B` | The sidebar (the logo's navy) |
| `sidebar-hover` / `sidebar-card` | `#22354D` / `#1F3149` | A link on hover; the salon card |
| `sidebar-line` | `#2C405A` | The rules above Settings and the footer |
| `sidebar-text` | `#C3CBD8` | Links: light gray (white on hover and for names) |
| `sidebar-muted` | `#9AA6B8` | Group headings, the location, the role |
| `sidebar-active` / `sidebar-accent` | `#1D3F75` / `#5B9BFF` | The current page: the bright blue's tint behind white text, and an accent bar on its left edge |
| `sidebar-focus` | `#8AB8FF` | Focus rings on the navy (the usual blue is too dark there) |

### Surfaces and text

| Token | Hex | Role |
| --- | --- | --- |
| `canvas` | `#FAF8F5` | The page: a warm off-white |
| `surface` | `#FFFFFF` | Cards, panels, fields: white on the warm page |
| `sunken` | `#F4F2EE` | Recessed areas, table headers, hover |
| `line` / `line-strong` | `#E7E4DF` / `#D4D0CA` | Dividers and borders (fields and outlined buttons use `line-strong`) |
| `off-hours` | `#F3F0EA` | The calendar outside someone's hours: a very light flat tint (no stripes) |
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
calendar block, "+5m" and "Not arrived" use `block-attention` (`#7A3106`),
the warning a step darker so it reads on every fill.

### Denise: periwinkle, only for her

| Token | Hex |
| --- | --- |
| `denise-50` / `-100` / `-200` | `#EDEFFF` / `#DFE3FE` / `#B8C0F7` (her fill, cards and borders: the Ask Denise bar, her brief, her cards) |
| `denise-500` | `#6C78E0` (her accent, the glow on blocks she's talking about) |
| `denise-600` | `#4E59C9` (her badge) |
| `denise-700` / `-900` | `#3F49B0` / `#272D75` (her text) |

Periwinkle means "Denise is speaking": her messages, suggestions, badge and
highlights. Don't use it for anything else, and don't use navy or the
bright blue for her. It's deliberately a different hue from both (the token
tests check this). Her waving illustration sits above empty states
(`EmptyState`; left out where several share a page).

### Service colors (the calendar)

Clear, saturated tints (the "A · Richer" style): a 4px edge in the full
color, and dark text tinted to match (the name in the family's ink, the
service and time in its muted ink), all AA on the fill and on its lighter
processing part. Processing time keeps fine, faint stripes (a 1.5px line
every 6px at 12% of the edge color, `PROCESSING_STRIPES`), so a full day
doesn't look busy; nothing else on the calendar is striped but an event's
travel.

| Family | Fill | Edge | Ink / muted ink |
| --- | --- | --- | --- |
| Color | `#FFD8C2` peach | `#F2603D` | `#5A250A` / `#763F22` |
| Cuts | `#E1DBFD` lavender | `#6B57E3` | `#2B1D78` / `#47399A` |
| Gloss & blowouts | `#CDEBC5` sage | `#2A9A43` | `#1B461C` / `#345F33` |
| Treatments | `#C6EBF2` teal | `#0B93B2` | `#0D4350` / `#245C69` |
| Nails | `#FBD3E2` rose | `#D6336F` | `#67142F` / `#82304B` |
| Skin | `#D3E4FC` sky | `#2F72D6` | `#153A72` / `#2F528B` |
| Other | `#EBE1D9` sand | `#877462` | `#4A3516` / `#654D2C` |

Where the client is in their visit: checked in fills the block with
`visit-here` `#FCF1AE` (lighter than every service color) and a no-show
with `visit-off` `#E3E5E9` (name struck through), both in plain ink. A
checked-out visit keeps its service color, slightly faded (75% over white)
with its own tinted text, and a check mark by the name. The token tests keep
checked in apart from every service color, booked or checked out, with every
kind of color vision.

### Stylist levels

Levels are each salon's own (Settings → Levels): owners name them, put them
in order and pick each one's color and badge. Every salon starts with
Master, Senior and Artisan; the demo's Maple & Ash adds Junior stylist.
The colors come from one fixed palette, each in two shades of the same hue:
a bright one for the ring and the column bar, and a deeper one for the small
badge circle, so its white symbol reads at 3:1 or better.

| Color | Ring and bar | Badge | Starts on |
| --- | --- | --- | --- |
| Gold | `level-gold` `#D4A017` | `level-gold-badge` `#A8800A` | Master (a star) |
| Fuchsia | `level-fuchsia` `#B80093` | `level-fuchsia-badge` `#B80093` | Senior (two dots) |
| Green | `level-green` `#22C55E` | `level-green-badge` `#15803D` | Artisan (one dot) |
| Blue | `level-blue` `#1E9BF0` | `level-blue-badge` `#1880C8` | Junior stylist in the demo (a triangle) |
| Violet | `level-violet` `#8B3DF0` | `level-violet-badge` `#7A2EDF` | |
| Slate | `level-slate` `#64748B` | `level-slate-badge` `#56657A` | |

Badges: star, two dots, one dot, triangle, diamond, three dots.

On the calendar a level shows as a 3px ring around the stylist's avatar
with a small badge in its corner (so it's never color alone), and a 4px bar
along the top of their column, explained by the Key. The rings and bars are
decorative and may sit under 3:1 on white; the badge shades meet 3:1. The
bright shades are kept apart from each other, the service colors (booked
and checked out), checked-in yellow, Signal Blue and Denise's periwinkle,
with protanopia, deuteranopia and tritanopia simulated too (the token
tests check all of it). Green is `#22C55E` rather than a darker green,
which sat too close to the sage service. Copper (too close to peach under
color-blindness) and crimson (too close to the danger red) were left out.
The level's name appears in staff settings and on the booking site, not on
the calendar.

Status chips have their own pairs (booked, confirmed, checked in, completed,
running late, no-show) in `globals.css`.

### Contrast

Every text/background pair meets WCAG AA (4.5:1), and focus rings and
service accents meet 3:1. `tests/unit/design-tokens.test.ts` checks them
all: add any new pair there. Use only the tokens, never Tailwind's palette
or one-off hex values.

## Typography

- **Geist** (the `geist` package, through `next/font`) for the staff app:
  titles, body, labels, buttons, numbers, every screen staff work in. The
  staff app stays Geist.
- **Source Serif** (Next's built-in Google Fonts loading, `app/serif.ts`,
  as `font-serif`) only on client-facing pages (the booking site and its
  manage, account, event, pay, card and unsubscribe pages) and on signing
  in, and there only for the salon's name and big headlines (page and step
  titles, the sign-in headline). Body text, labels, buttons and prices on
  those pages stay Geist.
- **Geist Mono** only where characters must line up as code (gift card
  codes, a formula's amounts). Money and counts use Geist with tabular
  figures (`tabular-nums`), so columns line up.
- **The scale:** 12, 13, 14, 16, 20 and 24px (`text-xs`, `text-13`,
  `text-sm`, `text-base`, `text-xl`, `text-2xl`). Page titles 24px semibold
  with slight negative letter-spacing (`PageHeader`); section and card
  titles 16px semibold; body 14px (the app's default); labels 13px medium;
  meta and tags 12px. Hierarchy comes from weight and color, not size.
  Two additions, each for one place only: 11px (`text-2xs`) for labels in
  dense grids (the calendar's quarter hours and time pill, the week grid,
  the sidebar's group headings, small status chips), and 28/32px
  (`text-display`, `text-display-lg`) for the salon's name on its booking
  site and the sign-in headline, in the serif. And on client pages from
  `lg` up (a laptop, an iPad in landscape), 13 and 14px text reads 15px
  and secondary text takes the darker `ink-soft`, for reading at a desk
  (`BookingFrame`); phones keep the scale. No other sizes.
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
- **The bright blue** is for where you are and what's live: the current
  sidebar item (its tint and accent bar on the navy), the selected Day/Week, Today when it's today, focus rings,
  and links that read as links ("See all", "Open event"). Names of people
  and records are dark text, underlined on hover (`nameLinkClass`).
- **Empty, loading, toasts:** `EmptyState` (Denise waving, then one quiet
  centered line, an optional title and action), `Skeleton` placeholders that shimmer slowly,
  and navy toasts at the foot of the screen with at most one action
  (`components/ui/feedback.tsx`).

### Finish: nothing cut off, nothing awkward

- **Text is whole or shortened on purpose.** No text is clipped by its box,
  spills out of it or sits under another element, and no page scrolls
  sideways, at a phone (390px), an iPad (1180px) and a laptop (1440px), with
  Denise open too. Where room is short, text takes a shorter form
  (`FitText`: "Bridget Callahan", "Bridget C.", "Bridget") or ends in "…"
  as a last resort, never mid-letter. `e2e/layout.spec.ts` checks it
  (`expectTidyLayout` in `e2e/layout.ts`), with a long client name and a long
  service title; each screen joins it as it's refined.
- **Wrapping breaks between words, never inside a unit.** Two lines are
  allowed only where the space has them, and a shorter form on one line wins
  over a longer one wrapped ("Kids' Cut" before "Kids' Cut (12 &" / "under)").
  Hyphenated names don't break at the hyphen ("Root Touch-Up"), and a date,
  a time range or "Open 9am–7pm" stays on one line (`whitespace-nowrap`).
- **Controls fit their row.** A toolbar's controls take their short forms by
  the toolbar's own width, not the window's (a container query: the
  calendar's date reads "Tue, Nov 3" and its display menu is its icon when
  booking details is open on a laptop, or on an iPad), so it stays one row
  where it can.
- **Things line up.** A price or total sits on the baseline of the line it
  belongs to. Denise's cards are one layout: her face, and everything she
  says and offers lined up beside it. A drag grip has its own strip above a
  header's name, never over it.
- **Phones:** beside the client search, the salon shows as its mark alone;
  the page links scroll sideways with a fade and an arrow at the edge with
  more (`SideScroll`), like every other row that scrolls. A busy toolbar
  folds to one row (the calendar's: the date controls and one "⋯" opening
  a sheet with the rest), and a page's main action floats at the bottom
  right (the calendar's New booking).

### Finish: crafted, not default

- **Grouped controls.** Controls that belong together share one outline,
  split by hairlines (the calendar's Previous, Today and Next; Day and
  Week), all 36px high. Toolbar outlines are the light `line`, not
  `line-strong`.
- **Hierarchy inside a card.** The thing's name semibold in ink, what it
  is in a lighter color, the time smallest and muted (calendar blocks:
  name, service, time). Calendar blocks have 10px corners
  (`rounded-block`) and their color as a soft 3px bar inset on the left,
  not a hard border.
- **Space before rules.** Sections of a panel are separated by space, not
  lines; a panel's one main action is its full width (booking details'
  Check in). Secondary actions are quiet text beside it, and "⋯" sits by
  the title of what it acts on.
- **Denise's header strip.** Her card and bubble open under a light
  periwinkle strip (`denise-50`) with her name in `denise-900`; inside,
  her cards have 16px of room, the fix she recommends is one strong
  button and everything else is quiet.
- **Client pages.** Text links in the salon's color are underlined in a
  lighter shade of it (`accentLink`: `--accent-line`, 1px, set below the
  letters), darkening on hover; a full-strength underline reads heavy. The
  booking site's Continue bar sits on the page's own off-white with a
  hairline above, not a white slab, and on a phone it slides in only once
  the steps are in view (never a grey Continue under the salon's Book
  now). On the first step, with no Back, the step's name ("Services ·
  Step 1 of 5") sits just above the title. The salon's address and phone
  read the same wherever a client sees them: an icon, the address with
  Map, the number as a link.
- **Client account and a visit's own page.** Both open under the salon's
  cover photo as a strip, with its logo over the edge and its name beside
  it, like the booking site. Stylists show their portrait (their initial
  without one) on visits and on Book again. The account's sections are
  cards, in two columns from `lg` (visits on the left; balances, rewards,
  card and messages on the right) and one on a phone, past visits last.
  A reward a client can take says "Use at checkout". Items in a list line up: the same
  inner padding, and a price at the top right of its card, whatever the
  card holds.

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
- **Her look:** periwinkle, and her art in `public/brand/denise/` (`face`:
  a crop of `wave` showing her whole page head, folded corner and glasses,
  so it reads as the same character at 20px; `wave`, `think`, `point`: the
  full illustrations).
- **One small avatar while she works:** wherever she speaks (her messages,
  cards, notes, her brief, Scheduling's card, reorders) she's her face at
  24px (`DeniseAvatar`, `DeniseFace`), 20px inside a control or a line of
  small text, and 36 or 46px only on the buttons that open her. What she's
  doing shows in the words beside her, with a soft breathing ring while
  she works; never a bigger drawing.
- **Full illustrations only for her moments:** signing in (waving, on a
  light tile, since her outline is the panel's navy), the welcome for a new
  salon, and empty states (`EmptyState`, and her calendar tab when the day
  is all clear) (`DenisePose`, waving). `think` and `point` are kept for
  onboarding and marketing, not shown in the app.
- **Out of the way of the team:** on the Calendar (from `lg` up) and
  Scheduling she opens as a compact card over the bottom right corner,
  380px wide and only as tall as what's in it (an empty chat is a short
  card; it grows to a set height, then scrolls), below the stylists' header
  row, so the whole team stays in view. It minimizes to a small bar
  ("Denise · 8") without losing the conversation, and each page remembers
  whether it was open, minimized or closed. On other pages she docks beside
  the page, and on a phone she fills the screen. Her card is only her (no
  tabs): her header stays at the top and her message box at the bottom,
  with what she has and the conversation scrolling between. On the
  Calendar, booking details is its own panel, open only while a visit or a
  booking form is; she steps aside to her bar while it's open, and opened
  on purpose sits just left of it, never on top. On
  the calendar her face sits at the end of the legend bar, never over
  appointments.
