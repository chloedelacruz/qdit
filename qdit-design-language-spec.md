# qdit Design Language Specification

## Brand Positioning

**qdit** is a modern SaaS platform for Stellar builders. The visual
language should feel closer to Linear, Jira, Vercel, and Arc than to
typical Web3 products.

**Keywords** - Minimal - Precise - Technical - Trustworthy -
Builder-first - Quiet confidence

## Logo Concept

### Folded Path

The primary mark is a continuous folded ribbon that forms an abstract
lowercase **q**.

Meaning: - Continuous workflow - Task progression - Connected
milestones - Deployment pipeline - Proof trail

The logo should never be interpreted as a literal checkmark or
clipboard.

## Logo Construction

-   Rounded geometry
-   Consistent stroke/ribbon width
-   Soft internal folds
-   No sharp corners
-   Tail angles approximately 40--45°
-   Negative space should remain open.

## Color System

  Token                Hex       Usage
  -------------------- --------- --------------------
  Primary Background   #0F172A   Dark surfaces
  Primary Brand        #6D5EF8   Logo & primary CTA
  Secondary Brand      #B9A8FF   Hover/highlights
  Surface              #E9E6FF   Subtle fills
  Background           #F8FAFC   App background

### Gradient

Start: #6D5EF8 End: #7B61FF

Use gradients only in branding---not UI controls.

## Typography

Primary: Inter, Geist, or Manrope

Weights: - 400 Body - 500 UI - 600 Headings - 700 Hero

Use lowercase "qdit" wordmark.

## Iconography

Icons follow: - 2px optical stroke - Rounded ends - 24px grid -
Geometric - Minimal detail

Avoid literal blockchain or crypto imagery.

### One glyph per concept

A concept keeps the same mark everywhere it appears --- sidebar, section
heading, empty state, button. Repetition is what turns a glyph into a
label you can read without reading. A concept with two marks has none.

The vocabulary lives in one module and is imported from there. Nothing
picks an icon inline.

### Placement

-   Icons ride **inline** with their heading at 14px, never in a tinted
    chip stacked above it. Large rounded icon tiles above every heading
    are the single clearest tell of a templated layout.
-   Default to `muted-foreground`. An icon takes the accent only when it
    marks the page's primary object --- otherwise colour stops meaning
    anything.
-   An icon never appears without its label. It reinforces a word; it
    does not replace one.

## UI Principles

-   Dense content, generous margins
-   4px spacing system
-   12px cards
-   10px buttons
-   Subtle shadows
-   Monochrome with one accent color

## Density

qdit is a tool people keep open all day and scan hundreds of rows in. It is
measured against Linear, not against a marketing site: **whitespace goes
around the content, never inside it.**

This replaces the earlier "large whitespace" principle, which was in direct
conflict with the benchmark and was quietly losing.

### Type scale

Small and tightly spaced. Hierarchy comes from weight, colour and space —
not from size. A page title only needs to be a little larger than body text
to read as a title.

  Token         Size     Use
  ------------- -------- --------------------------------------------
  `text-xs`     11px     Meta lines, uppercase section labels, counts
  `text-sm`     13px     **Default.** Body, rows, controls, nav
  `text-base`   14px     Emphasis inside dense contexts
  `text-lg`     16px     Page titles
  `text-xl`     18px     Rare — the largest thing in the app shell
  `text-2xl`    22px     Stat values only

Marketing surfaces (the landing page) are exempt and keep their display
sizes.

### Rhythm

-   List rows land at **32--36px**. If a row needs more, it is carrying
    something that belongs on a detail page.
-   Related items sit **4--8px** apart; unrelated groups **20--24px**. The
    contrast between those two is what creates rhythm — uniform spacing
    everywhere reads as monotony, not calm.
-   Page gutters stay generous. Density is a property of content, not of
    the frame around it.
-   Never pad a row to make it easier to click. Increase the hit area
    instead.

## Depth

The interface is lit, not stacked. Depth comes from a light source —
never from blur, glow, or translucency.

### Tinted neutrals

Every neutral carries a trace of the brand hue (**281°**, chroma
0.002--0.022). Pure grey is never used, and neither is pure white or
pure black. This is what makes the accent read as *emerging from* the
surface rather than *sitting on top of* it.

### Surface ladder

Four planes. Each step is a real luminance change, not just a border.

  Token                Role                                  Light     Dark
  -------------------- ------------------------------------- --------- ---------
  `--surface-sunken`   Wells, tracks, inset fills            L 0.955   L 0.165
  `--background`       The page                              L 0.974   L 0.190
  `--card`             Panels, rows, tiles                   L 0.995   L 0.228
  `--surface-raised`   Popovers, dropdowns, sheets, dialogs  L 1.000   L 0.262

Never skip a rung, and never nest a plane inside itself — a card on a
card is a hierarchy failure, not a depth effect.

### Light direction

Light falls from **directly above**.

-   Raised surfaces carry a 1px inset highlight on their top edge.
-   Shadows are cast downward, and are **tinted** (hue 285) — never
    neutral black.
-   Shadows layer: a tight contact shadow plus a wider ambient one.
    A single blurred drop shadow reads as artificial.
-   Sunken surfaces invert it: inset shadow at the top, no highlight.

### Elevation scale

  Level   Use                                   Rest              Hover
  ------- ------------------------------------- ----------------- ---------------
  0       Page background, flush rows           none              tint only
  1       Cards, tiles, board items             `--shadow-xs`     `--shadow-sm`
  2       Interactive cards, active rows        `--shadow-sm`     `--shadow-md`
  3       Popovers, dropdowns, sheets           `--shadow-lg`     --
  4       Dialogs                               `--shadow-xl`     --

## Visual Priority

Elevation is an attention ranking, not a decoration. If every surface on
a page sits at the same rung, the page has no answer to "what do I look
at first" --- which is the same failure as no depth at all, arrived at
from the opposite direction.

### One primary per page

Every page names exactly **one** primary object: the thing the user came
for. It gets the highest elevation on that page, and its heading icon
carries the accent. Everything else steps down.

  Page             Primary                        Steps down to
  ---------------- ------------------------------ ---------------------------
  Dashboard        What is assigned to me         Rollup tiles, then panels
  Projects         The list                       Filter bar
  Project overview Progress and open work         Contract reference, history
  Board            The cards                      Columns (sunken containers)
  Milestones       The list                       Per-row progress
  Deployments      Current state                  Historical rows
  Proof registry   A pasted identifier's answer   The full record list

### Rules

-   Two objects at the same elevation are a claim that they matter
    equally. Usually one of them does not.
-   Containers recede. A board column is a **well**; the cards inside it
    are raised. Never the reverse.
-   Reference material --- a contract ID, a timestamp, an author --- is
    never primary. It is looked up, not scanned.
-   Raising something is a decision about the user's attention, not about
    the element's importance to the developer.

## Accent Application

One accent, used more often but more quietly. The accent is a **state
signal**, never decoration.

-   **Selected / active** — tinted fill plus a 2px brand rail on the
    leading edge.
-   **Focus** — a brand-tinted double ring: a tight solid ring and a
    soft outer glow.
-   **Progress** — brand fill on a sunken track.
-   **Interactive text** — brand on hover, never at rest.

Do not use accent-tinted fills behind decorative icons. If it isn't
communicating state, it stays neutral.

## Motion

-   180--220ms, exponential ease-out
-   Hover lifts by **1px** and gains one elevation level --- never
    scales
-   Press settles 1px down and drops back to its rest elevation
-   Lists stagger in at 24ms intervals, capped at 8 items
-   Gentle opacity transitions
-   Every one of the above collapses under
    `prefers-reduced-motion`

## Do

-   Keep layouts clean.
-   Keep content dense and margins generous.
-   Emphasize hierarchy through weight and colour before size.
-   Prefer abstraction.

## Don't

-   Neon crypto aesthetics
-   Glassmorphism
-   Heavy gradients
-   Busy illustrations
-   Literal task/checklist icons
-   Multiple accent colors
-   Outline-only surfaces --- a border without a luminance step or a
    shadow reads as cardboard
-   Pure white, pure black, or untinted grey
-   Scale on hover --- lift instead
-   Untinted black shadows
-   Accent used as decoration rather than state
-   Padding a row to make it easier to hit
-   Uniform spacing everywhere --- it reads as monotony, not calm
-   Large type standing in for hierarchy
