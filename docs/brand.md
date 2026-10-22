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
| `canvas` | `#FBF8F5` | The page: a warm off-white |
| `surface` | `#FFFFFF` | Cards, panels, fields |
| `sunken` | `#F5F0EB` | Recessed areas, the sidebar |
| `line` / `line-strong` | `#EBE4DD` / `#D9CFC5` | Dividers and borders |
| `ink` | `#1D2532` | Body text |
| `ink-muted` | `#565E6B` | Secondary text |
| `ink-subtle` | `#666E7C` | Hints, placeholders |
| `danger` / `danger-soft` | `#B42318` / `#FDECEA` | Errors, destructive actions |
| `now` | `#C8323A` | The calendar's current-time line |

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

| Family | Fill | Accent edge |
| --- | --- | --- |
| Color | `#FBDFCF` peach | `#E2733D` |
| Cuts | `#E9E0F8` lavender | `#8A68D6` |
| Gloss & blowouts | `#DCECDF` sage | `#5A9969` |
| Treatments | `#D5EFEB` soft teal | `#3B9B93` |
| Other | `#EDE5DD` sand | `#A08870` |

### Stylist levels

| Level | Token | Hex |
| --- | --- | --- |
| Master | `level-master` | `#A67C12` gold |
| Senior | `level-senior` | `#7C8896` silver |
| Artisan | `level-artisan` | `#9A5A2B` bronze |

Levels show as color only: a ring around the stylist's avatar and a thin bar
along the top of their calendar column, explained by the legend. They're
graphics, so they meet 3:1 against the page, and they're kept clearly apart
from the service colors and Denise's periwinkle (the token tests check
both). The level's name appears in staff settings, not on the calendar.

Status chips have their own pairs (booked, confirmed, checked in, completed,
running late, no-show) in `globals.css`.

### Contrast

Every text/background pair meets WCAG AA (4.5:1), and focus rings and
service accents meet 3:1. `tests/unit/design-tokens.test.ts` checks them
all: add any new pair there. Use only the tokens, never Tailwind's palette
or one-off hex values.

## Typography

- **Inter** for everything in the interface: body, labels, buttons, numbers.
- **Fraunces** (semibold) for page titles and headings, and the big lines on
  the login screen and social image.
- The wordmark is part of the logo: never set "Maestra" in a font to stand
  in for it.
- Sentence case everywhere ("New booking", not "New Booking").

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
