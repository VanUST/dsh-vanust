# Accessibility and keyboard audit

An editor that only works with a mouse is not finished. Automated scans catch a
minority of real problems — a missing name, a broken label, a contrast failure —
and miss the part that matters most in a complex UI: whether a person can reach
the action and see where they are.

Run both. `axe` is the floor; a scripted keyboard walk is the evidence.
Everything here is Node plus Playwright, so the Windows path is the same; only
the rendering pins in `visual-golden-tests` differ per OS.

## The scan

```js
import { AxeBuilder } from '@axe-core/playwright'

const results = await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa'])
  .analyze()

const serious = results.violations.filter(
  (violation) => violation.impact === 'serious' || violation.impact === 'critical',
)
```

Fail on serious and critical, and print the rule id, `helpUrl` and the failing
selectors — not the whole result object:

```js
for (const violation of serious) {
  console.error(violation.id, violation.helpUrl, violation.nodes.map((node) => node.target))
}
expect(serious).toEqual([])
```

Scan the states, not just the landing page: menu open, dialog open, validation
error, empty grid, loading. A hidden panel is not scanned, so a clean run on the
default screen says little.

## Prove the scan can fail

Add an icon-only button whose glyph is hidden from the accessibility tree and run
the same scan again. It must report `button-name`:

```html
<button type="button"><span aria-hidden="true">×</span></button>
```

```
clean page    serious violations []
broken page   violations ['button-name']
```

A scan that stays clean with a nameless button is testing nothing. Keep the
broken fixture in the suite as the negative run.

## The keyboard walk

Script the order, not just the presence. For each step record the focused
element's role, accessible name and visible outline:

```js
await page.keyboard.press('Tab')
await expect(page.getByRole('textbox', { name: 'Chord' })).toBeFocused()

const transcript = []
for (let i = 0; i < 6; i += 1) {
  await page.keyboard.press('Tab')
  transcript.push(await page.evaluate(() => {
    const el = document.activeElement
    const style = getComputedStyle(el)
    return {
      tag: el?.tagName,
      name: el?.getAttribute('aria-label')
        || el?.labels?.[0]?.textContent?.trim()
        || el?.textContent?.trim(),
      // A ring may be an outline OR a box-shadow; outlineStyle alone lies.
      // An outline needs BOTH a style and a width; a ring may be a box-shadow.
      focusVisible: (style.outlineStyle !== 'none' && style.outlineWidth !== '0px')
        || style.boxShadow !== 'none',
    }
  }))
}
```

| Check | Pass condition |
|---|---|
| order | Tab reaches every action in reading order, no skipped control |
| visible focus | `outlineStyle` or a box-shadow ring is not `none` on every stop |
| activation | Enter or Space does the same thing as the click |
| escape | Escape closes the menu, dialog or inline editor |
| composite widgets | arrow keys move inside a listbox, grid or toolbar, Tab leaves it |
| no trap | Tab cycles out of every overlay; focus returns to the trigger |
| skip link | first Tab offers a way past the toolbar |
| re-render | focus is not lost when a chord is transposed or a bar is added |

The last row is the one apps fail most: a full re-render that replaces the
focused node drops the user back to the document. Restore focus by id after the
update, and test it. `boxShadow !== 'none'` can also match a decorative shadow,
so confirm a positive result on a screenshot instead of trusting the boolean.

## Canvas rules

- Give the canvas `role="img"` and an `aria-label` that states the current
  content; update it when the model changes. A test can read that label without
  reading a single pixel.
- Every drag-only action needs a keyboard path: a menu command, a list of bars,
  arrow-key nudging. If the only way to move a note is a mouse, the feature is
  inaccessible.
- Mirror the model in a real DOM list or table (visible or visually hidden) so
  screen readers and tests have something to query.
- Announce changes with `role="status"` / `aria-live="polite"`; do not rely on a
  repainted canvas to convey "transposed".

## What the scan cannot see

Focus order, whether the announcement made sense, whether a drag has a keyboard
equivalent, whether the canvas label tells the truth, and whether a keyboard
user can finish the task. Those are the transcript and the negative run.

## Report

- `axe` version and the tags scanned; violations with rule id and selectors, or
  "none" per state.
- The keyboard transcript: element, order, focus visibility.
- The negative run that proves the scan catches an unnamed control.
- What you did not cover: screen reader, touch, other browser.

## Pitfalls

- `disableRules('color-contrast')` to get green.
- Scanning only the initial state.
- Testing `toBeFocused` without checking that focus is visible.
- A canvas with no role and no label: axe cannot inspect its contents, so it says
  nothing about them.
- One Tab press and calling it keyboard support.

## Sources

[@axe-core/playwright](https://github.com/dequelabs/axe-core-npm) usage and
options; WCAG 2.2 AA thresholds; Playwright
[locators](https://playwright.dev/docs/locators) and
[assertions](https://playwright.dev/docs/test-assertions). Verified against
`axe-core 4.14.0` and `@axe-core/playwright 4.14.0` with Playwright 1.65.
