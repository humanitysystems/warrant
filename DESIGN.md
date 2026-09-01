---
name: Humanity Systems — Neuron/Parchment
version: alpha
colors:
  primary: "#1a1612"
  bg: "#f4ede0"
  bg-elevated: "#ebe2cf"
  bg-subtle: "#ebe4d3"
  bg-strong: "#1a1612"
  border: "#d8caa8"
  border-strong: "#b8a884"
  text: "#1a1612"
  text-secondary: "#5a544c"
  text-muted: "#8a8275"
  accent: "#1f7a9b"
  accent-bright: "#1a6b89"
  accent-subtle: "rgba(31, 122, 155, 0.08)"
  accent-glow: "rgba(31, 122, 155, 0.14)"
  signal-bright: "#4cb8d8"
  ink-on-dark: "#f0ebe2"
  text-on-dark: "#b8b0a4"
  lead-on-dark: "#c8c0b4"
  accent-on-dark: "#8ce0ff"
typography:
  display:
    fontFamily: Inter
    fontSize: 2.125rem
    fontWeight: 700
    letterSpacing: -0.04em
    lineHeight: 1.05
  h2:
    fontFamily: Inter
    fontSize: 1.625rem
    fontWeight: 700
    letterSpacing: -0.03em
    lineHeight: 1.1
  h3:
    fontFamily: Inter
    fontSize: 1.1875rem
    fontWeight: 600
    letterSpacing: -0.02em
    lineHeight: 1.3
  lead:
    fontFamily: Inter
    fontSize: 1.0625rem
    fontWeight: 400
    letterSpacing: -0.005em
    lineHeight: 1.55
  body:
    fontFamily: Inter
    fontSize: 1rem
    lineHeight: 1.55
  small:
    fontFamily: Inter
    fontSize: 0.875rem
  caption:
    fontFamily: "IBM Plex Mono"
    fontSize: 0.75rem
    fontWeight: 500
    letterSpacing: 0.16em
rounded:
  sm: 6px
  md: 8px
  lg: 12px
spacing:
  xs: 0.5rem
  sm: 1rem
  md: 1.75rem
  lg: 3.5rem
  xl: 5.5rem
  2xl: 8rem
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg}"
    rounded: "{rounded.md}"
    padding: 0.75em 1.25em
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text}"
  button-ghost:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
  button-on-dark:
    backgroundColor: "{colors.bg-strong}"
    textColor: "{colors.ink-on-dark}"
    rounded: "{rounded.md}"
  nav-cta:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
  section-ink:
    backgroundColor: "{colors.bg-strong}"
    textColor: "{colors.ink-on-dark}"
---

## Overview

Neuron / Parchment. A light substrate with a cool electric signal following a
Linear/Vercel structural logic. The body is paper; the signal is electric.

Cream-leaning neutrals (parchment, ink) carry the page, and a single saturated
mid-cyan accent carries every moment of signal. The system favors restrained,
large editorial typography in Inter, monospace-uppercase metadata, generous
white space, and sharp-hairline borders — matching Humanity Systems's position
as "the tether for humans and AI to grow together": warm, calm, exact, and
quietly technical.

This is the brand design for Humanity Systems, shared across the corporate
site and its products. Warrant (a local, transparent MCP proxy) is a product
in this family and should apply this system to its landing page and desktop
app surfaces.

## Colors

The palette is rooted in high-contrast cream-neutrals and a single signal
accent that was deepened to punch against the light substrate.

- **bg (#f4ede0)** — warm parchment, the page's foundation.
- **bg-elevated (#ebe2cf)** — raised surfaces: cards, the sticky header.
- **bg-subtle (#ebe4d3)** — alternating sections, very subtle.
- **bg-strong (#1a1612)** — deepest warm ink; used only for the `section--ink`
  feature block and the system-flow diagram band.
- **text (#1a1612)** — near-black warm ink for headlines and core text.
- **text-secondary (#5a544c)** — mid-tone slate for body copy.
- **text-muted (#8a8275)** — captions, meta, disclaimers.
- **border (#d8caa8)** — warm parchment hairlines.
- **border-strong (#b8a884)** — stronger edges: buttons, hover states.

The accent is the single driver of interaction:

- **accent (#1f7a9b)** — deepened mid-cyan so it reads on a light substrate.
- **accent-bright (#1a6b89)** — hover/focus, slightly deeper.
- **accent-on-dark (#8ce0ff)** — the bright cyan reserved for the dark ink band.

**Restraint is the rule.** Bright cyan is reserved for traveling pulses and
active-conduction moments on dark; the static UI uses the deep accent only.

## Typography

Two families, one voice:

- **Inter** — the only sans face, used for both display and body. Display
  headlines are 700 weight with tight negative tracking (−0.03 to −0.04em);
  body is 400 with a relaxed 1.55 line height.
- **IBM Plex Mono** — reserved for metadata: eyebrows, labels, section nav,
  fact-row labels, numbering, and footer. Always uppercase with wide tracking
  (0.08–0.16em) in muted or accent color.

Italics are not used for emphasis in prose. The `em` element is re-styled to
**accent color** (roman, not italic) so emphasis reads as signal rather than
style. In the hero and page headlines, the emphasized phrase takes a gradient
clipped-to-text fill from `accent-bright` to `accent`.

## Layout

Centered columnar layout built on three measures:

- **narrow** (38rem) — prose measure (`--measure-narrow`).
- **wide** (72rem) — the default wrap (`--measure-wide`).
- **broad** (88rem) — hero and full-width bands (`--measure-broad`).

Sections pad at `--space-2xl` (8rem) vertically with `--space-md` gutters.
Two-column grids use a 1fr / 1.6fr split and collapse to one column below
800px. A sticky header uses translucent parchment with `backdrop-filter:
blur(12px) saturate(140%)` and a hairline bottom border.

System of order: numbered lists and fact rows present data in a
`<mono label> | <display value>` grid separated by 1px borders — the signature
"fact-row" pattern.

## Elevation & Depth

Restrained. No heavy shadows — the surface is flat parchment. Depth comes from
edges (1px warm borders) and two deliberate effects:

- **Ambient glows** — a large radial `accent-subtle` glow behind the hero and
  page headers (the Linear/Vercel signature).
- **Low-key shadows** — `sm` (1px) up to `md` (16px), plus a `glow` shadow used
  sparingly around the accent mark and focus states.
- **Ink band** — the `section--ink` block inverts to warm near-black with a
  faint cyan radial at the top and text readable against it (`#f0ebe2`
  headlines, `#b8b0a4` body, `#8ce0ff` eyebrows/links).

## Shapes

Rounded corners are subtle: `sm` 6px, `md` 8px (buttons, inputs), `lg` 12px
(cards, grids). The brand mark is a 7px square accent glyph with a soft
glow, suggesting a pulse/neuron — not a circle.

## Components

- **Button primary** — solid ink (`text`) background, parchment text; on hover
  it shifts to accent background. The single highest-emphasis action.
- **Button ghost** — transparent with a strong warm border.
- **Button on-dark** — transparent with a translucent parchment border for the
  ink band.
- **Nav CTA** — elevated surface, hairline border, inverts to ink-on-parchment
  on hover.
- **Card** — elevated parchment surface, hairline border, 12px radius; lifts
  2px and darkens its border on hover.
- **Principles / Arch grids** — bordered grids with 1px gaps so the hairline
  shows through as the divider; each cell is an elevated surface.
- **Numbered list & fact row** — the mono-uppercase label + display-value
  pattern separated by hairlines.
- **Section nav** — sticky elevated strip with mono-uppercase label and
  underline-on-hover links.
- **Ink band (section--ink)** — the dark counterpoint for a "moment" or system
  flow; reverse the text roles and use `accent-on-dark` for signal.

## Do's and Don'ts

**Do:**

- Keep the body parchment and the signal electric — paper neutrals for the
  page, one mid-cyan accent for moments of interaction.
- Use Inter for everything in prose and display, IBM Plex Mono for metadata.
- Set metadata uppercase with wide tracking and muted color.
- Reserve `accent-on-dark` (#8ce0ff) and `signal-bright` (#4cb8d8) for the ink
  band and active conduction moments only.
- Use hairline parchment borders and the glow for depth rather than shadows.
- Use the exercise of emphasis-on-accent instead of italics.

**Don't:**

- Don't introduce additional hues — no greens, reds, or ambers on this brand.
  A single warning channel is a deliberate exception only if a surface demands
  it, and even then it belongs to product state, never the brand background.
- Don't use the bright cyan on the light substrate; it will wash out. Use the
  deepened `accent` there.
- Don't set mono in sentence case — mono is always uppercase metadata.
- Don't break the measure discipline for prose (stay at or under 38rem and
  ~60ch).
- Don't use decorative drop caps; the tech aesthetic keeps first paragraphs
  neutral.
