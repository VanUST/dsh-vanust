# Visual golden tests

A notation page or a canvas grid has no DOM to assert against. A golden image
catches what a role-based test cannot see: a slur two pixels low, a bar number
that lost its font, a staff that collapsed at a narrow width. It also yields a
diff a human can review in ten seconds.

The price is determinism. A screenshot is an assertion only when every input to
the pixels is pinned. Otherwise you have built a flaky test with a large file.
`ui-testing` owns the interaction and the assertion; this skill owns the pixels it
cannot see.

## The environment is part of the assertion

Pin all of it before the first baseline:

- the browser build — Playwright's bundled Chromium at one revision, not the
  machine's Chrome;
- the OS image or container that renders and rasterises text;
- the fonts, bundled or installed by version: a fallback font changes every glyph;
- `deviceScaleFactor: 1` and a fixed viewport; a retina run is a different baseline;
- locale, timezone, `prefers-reduced-motion` and colour scheme;
- a frozen clock and a seeded model: no random ids, no "rendered at" labels;
- animations disabled and the text caret hidden.

If one of those changes, update the baseline or the environment. Never raise the
threshold until the real change disappears with the noise.

On Windows the same pins apply: the common Linux/macOS font families are absent,
so bundle the font; keep `deviceScaleFactor: 1`; and never compare a Windows
baseline with a Linux one. Render the suite in one container, or keep one
reviewed baseline per OS.

## Compare with pixelmatch

`pixelmatch` compares raw RGBA buffers and returns the number of differing
pixels; it is not a pass/fail oracle, so state the allowance:

```js
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const expected = PNG.sync.read(readFileSync('golden/score.png'))
const actual = PNG.sync.read(readFileSync('artifacts/score.png'))
if (expected.width !== actual.width || expected.height !== actual.height) {
  throw new Error('size changed: ' + expected.width + 'x' + expected.height +
    ' -> ' + actual.width + 'x' + actual.height)
}
const diff = new PNG({ width: expected.width, height: expected.height })
const allowed = 0                  // raise only per image, with a reviewed reason
// ignoreMask: one byte per pixel (Uint8Array(width * height)), 1 = skip that
// pixel. Build it in the screenshot crop's coordinates, not page coordinates.
const ignoreMask = undefined       // replace with the array when a live region exists

const diffPixels = pixelmatch(
  expected.data,
  actual.data,
  diff.data,
  expected.width,
  expected.height,
  {
    threshold: 0.1,          // per-pixel perceptual difference, 0..1
    windowSize: 16,          // optional: largest diff inside any 16x16 square
    ignoreMask,              // one byte per pixel; 1 excludes a live region
  },
)
writeFileSync('artifacts/score.diff.png', PNG.sync.write(diff))
if (diffPixels > allowed) process.exit(1)
```

Three options carry the judgement:

- **`threshold`** is a per-pixel colour difference, not a share of the image.
  `0.1` is the default and is sensitive enough for text and staff lines.
- **`windowSize`** returns the largest count in any N×N square instead of the
  total. GPU dithering and sub-pixel anti-aliasing scatter stray pixels; a real
  regression is compact. Compare that windowed count against an allowance.
- **`ignoreMask`** excludes a rectangle that legitimately changes — a clock, a
  spinner, a live cursor — by geometry, in the **screenshot crop's** coordinates
  (the `#score` element, not the page). Do not hide those regions in the app just
  to make the diff pass, and do not lower the threshold for the whole page.

Crop to the element, not the page:

```js
await page.locator('#score').screenshot({ path: 'artifacts/score.png', animations: 'disabled' })
```

A full-page shot makes every layout change a failure and makes the diff
unreviewable. The `path` option accepts forward slashes on every OS — Node
normalises them, so the same string works on Windows.

## Baseline discipline

- Commit the baselines next to the test (`golden/`, `__screenshots__/`) and review
  a changed PNG as part of the PR; a blind update is a deleted assertion.
- Update by running the generator, looking at the diff, and writing down why the
  pixels moved. "Fonts changed in the CI image" is a reason; "it went red" is not.
- Never auto-accept baselines in CI. A green run that rewrites its own oracle
  proves nothing.
- Keep the set small: one page, the state that matters, the narrow and the wide
  layout. Fifty near-identical screenshots are maintenance, not coverage.

## Argos and hosted review

Run the local `pixelmatch` loop while editing; it is fast and needs no service.
When several machines must share reviewed baselines and a PR needs a visual
review UI, upload the screenshots to Argos from CI. The local diff stays the
first check, so a flaky upload never hides a real regression.

## Verified run

Chromium 158, Playwright 1.65, pixelmatch 8.0, pngjs 7 on a 640×360 canvas:

```
identical baseline            diffPixels 0
second chord shifted 2 px     diffPixels 171 / 232404   exit 1
clock text changed            diffPixels 38 (text-length dependent)   exit 1
same clock, ignoreMask set    diffPixels 0             exit 0
```

The first and last lines are the point: the diff is quiet on what is stable and
loud on a two-pixel regression.

## Pitfalls

- Screenshot-as-only-assertion: it proves pixels, not that a screen-reader user
  can operate the page. Pair it with `a11y-keyboard-audit`.
- Full-page snapshots and a threshold high enough to hide a missing label.
- Comparing across OSes or browsers; the diff is then about rendering, not code.
- Masking the element under test to silence noise.
- Storing diffs as the only artifact: keep expected, actual and diff for the
  failing run.

## Sources

pixelmatch 8 [README](https://github.com/mapbox/pixelmatch) (options,
`ignoreMask`, `windowSize`); Playwright
[screenshots](https://playwright.dev/docs/screenshots); Argos
[Playwright integration](https://argos-ci.com/docs/playwright).
