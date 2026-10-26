# UI design system

A screen looks generated when every decision was made locally: a colour here, a spacing value there, a radius picked by feel. A design system is the small set of decisions made *once*, then reused. This skill gives the tokens, the component rules and the concept library to build an interface that looks deliberate.

## Tokens first, components second

Fix these before the first component. Six scales is the whole system:

| Scale | Range | Rule |
|---|---|---|
| Colour | 1 neutral ramp (12 steps), 1 accent ramp, 4 semantic aliases | Semantic first: `surface`, `ink`, `muted`, `accent`, `danger`. A component names the alias, never a raw step. |
| Type | 5–7 sizes, 2 weights, 2 families max | Body 15–16 px, line-height 1.5; headings 1.15–1.25; line length 45–75 characters. |
| Space | 4 / 8 grid: 4, 8, 12, 16, 24, 32, 48, 64 | Every gap, padding and margin comes from this list. No 13 px. |
| Radius | 2 values: small (4–6), large (10–14) | Buttons and inputs share one; cards use the other. |
| Elevation | 2 shadows, one direction | Light from above; a hover shadow is one step, not a new style. |
| Motion | 2 durations (150, 250 ms), 1 ease-out | Motion explains a change; it never decorates. |

Two ready-made routes: use **Open Props** (500+ CSS custom properties, design-token JSON, non-prescriptive — `@import "https://unpkg.com/open-props"`) as the palette and scale source, or write the tokens by hand in one `tokens.css`. Either way they live in one file and every component reads them.

Light and dark are two value sets over the same aliases — not two stylesheets. Contrast is a correctness property, not taste: **4.5:1** for body text, **3:1** for large text and for UI edges and icons (WCAG 2.2 AA). Check the numbers; the eye is a bad judge in dark mode.

## Components: semantics, then states

- **Use the element that means it.** `button`, `a`, `input`, `label`, `select`, `dialog`, `details`. A `div` with a click handler is a bug: it has no role, no keyboard, no focus. When a framework is available, reach for headless accessible primitives (Radix-style) rather than restyling a div.
- **Every interactive component has eight states:** rest, hover, focus-visible, active, disabled, loading, error, and (for lists/views) empty. Missing states are why interfaces feel unfinished.
- **Focus is never removed.** A 2 px ring with a 2 px offset, visible against both surfaces; `:focus-visible` rather than `:focus`.
- **Disabled means unavailable, not faded.** Keep text at ≥ 4.5:1 and name the reason somewhere near it.
- **Loading is the layout, not a spinner.** A skeleton that reserves the final height prevents the jump that makes a UI feel cheap.
- **Errors live next to the field.** Toasts are for background results, not validation.

## The concept library

Reach for a known pattern instead of inventing layout per screen:

- **Shell** — sidebar nav + content, or top bar + content; one primary action in the top-right.
- **Hero / landing** — headline, one supporting line, one action.
- **List → detail** — table or cards on the left, detail on the right; selection survives reload.
- **Dashboard** — a 12-column grid, 3–4 KPIs above the fold, charts below, consistent card padding.
- **Wizard / stepper** — progress visible, one decision per step, back never loses input.
- **Settings form** — label above field, help text under it, save bar appears when dirty.
- **Empty state** — what this is, why it is empty, the one action that changes that.
- **Error page** — what happened, what was preserved, one way forward.
- **Data table** — numbers right-aligned with `tabular-nums`, no zebra stripes *and* borders together, sort and filter visible when active.
- **Command palette / search** — one input, grouped results, keyboard-first.
- **Feedback** — inline validation, toast for completion, confirmation only for destructive actions.

## Hierarchy without decoration

- One primary action per view; everything else is secondary or a link.
- Three levels of emphasis at most: size, weight, colour. If everything is bold, nothing is.
- Space groups better than borders. Prefer a gap over a divider, a divider over a box.
- Left-align text; centre only short headlines and empty-state messages.
- Icons need labels unless they are universal (✕, ←, ▶) — an unlabeled icon is a guess.

## Deliverable and proof

Produce three things and prove them: `tokens.css`, one component spec (states as a table), and one screen. Then:

- screenshot at 375 px and 1280 px;
- compute the contrast of every text/background pair and quote the ratios;
- Tab through it once — every action reachable, focus visible;
- check one RTL or long-string case: a 40-character label must not overflow.

## Anti-patterns

- Six accent colours, or a raw palette value inside a component.
- Mixed radii, mixed border widths, shadows in two directions.
- Grey-on-grey text below 4.5:1.
- Centred paragraphs, 120-character lines, all-caps body text.
- Icon-only buttons without an accessible name.
- Spinners where a skeleton belongs; layout shift on data arrival.
- Modal for everything: a modal inside a modal is a design failure, not a state.
- Decorative gradients and glassmorphism on a business screen; the user came for the data.

## Sources

Adapted for this deployment from [Open Props](https://open-props.style/) (CSS custom properties and design-token JSON as a non-prescriptive base), the [Design Tokens](https://www.designtokens.org/) format for the token file, and WCAG 2.2 AA thresholds for contrast and focus visibility.
