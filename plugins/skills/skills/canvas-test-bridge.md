# Canvas test bridge

A canvas editor has no DOM to query. A screenshot shows that ink reached the
screen; it cannot tell you which chord is selected, whether undo has one entry
or two, or why the grid jumped two pixels. The bridge is the missing read
surface: a small, gated object on `window` that returns the editor's model and
acts through the same functions the UI acts through.

`ui-testing` is the general browser loop and still owns interaction and
assertions. This skill adds the layer that makes a canvas, WebGL or notation
editor testable at all.

## The contract

Expose one namespace, once, with a version and a readiness signal:

```ts
interface AppTestApi {
  version: 1
  ready: boolean
  getState(): EditorState        // a clone, never the live object
  dispatch(action: Action): void // the same command the UI calls
  reset(seed?: Partial<EditorState>): void
  lastError(): string | null
}
declare global { interface Window { __APP_TEST__?: AppTestApi } }
```

Six rules keep it from becoming a second implementation:

1. **Gate it.** Build the object only under an explicit test flag, not merely a
   non-production mode (staging is not a test). In Vite:
   `import.meta.env.DEV && new URLSearchParams(location.search).has('test')`.
   In a plain page: `?test=1` plus an origin allowlist. After building, search
   the production bundle (`grep`, or `Select-String` in PowerShell) for the
   literal `__APP_TEST__` — it must be absent.
2. **Same path as the user.** `dispatch` calls the production command, with its
   validation, undo entry and persistence. A parallel "test transposition" is a
   second implementation that drifts silently. Named helpers such as
   `transpose(by)` are fine when each forwards to that same command; the name
   matters less than the single path.
3. **Read the model, not the pixels.** `getState` returns a deep copy so a test
   cannot mutate the editor by accident, and the editor cannot change under an
   assertion.
4. **One readiness signal.** Flip `ready` after the first paint or the first
   `requestAnimationFrame`; the test waits on that, never on a timeout.
5. **Deterministic reset.** `reset()` sets a fixed progression, zoom, scroll,
   locale and clock, and clears storage. A bridge that inherits the previous
   test's state is worse than no bridge.
6. **Surface errors.** Keep `lastError`; a swallowed exception inside a canvas
   handler is invisible otherwise.

## Driving it from Playwright

```js
await page.goto('/?test=1')
await page.waitForFunction(() => window.__APP_TEST__?.ready === true)

const before = await page.evaluate(() => window.__APP_TEST__.getState())
expect(before.transpose).toBe(0)
await page.getByRole('button', { name: 'Transpose +1' }).click()

// A canvas may repaint a frame later. Wait for the model, not a timeout.
await expect
  .poll(() => page.evaluate(() => window.__APP_TEST__.getState().chords))
  .toEqual(['C#maj7', 'D#m7', 'G#7', 'C#maj7'])
const after = await page.evaluate(() => window.__APP_TEST__.getState())
// The same fact, on a surface a user can see:
await expect(page.getByRole('list', { name: 'Progression' })).toContainText('C#maj7')
```

Always assert one user-visible surface beside the model. A bridge-only suite
stays green when rendering, focus or layout breaks, because the bridge is
exactly the part that did not break.

The bridge also makes an MCP sweep cheap: `browser_evaluate` can read
`getState()` between drags, so an agent checks what the editor thinks during
the gesture instead of guessing from a screenshot.

## What goes wrong

- **Bridge drift.** The bridge gets a shortcut ("just set the array") and the
  undo stack, validation or persistence are never exercised. At least one test
  per action must go through the real control and compare the model.
- **Leaking into production.** A query flag is not enough if the flag survives
  the build. Check the built bundle, not the source.
- **Reading too early.** A canvas renders in a frame after `load`; without a
  readiness signal the first assertion reads an empty model.
- **Mutable hand-off.** Returning the live state lets one test's write leak into
  the next, and makes a failure depend on order.
- **Testing only the bridge.** Pair it with `a11y-keyboard-audit` and
  `visual-golden-tests`; the three catch model, access and pixels.
- **Type drift.** Share the `AppTestApi` type with the unit tests; an untyped
  bridge turns a rename into a runtime undefined.

## Prove it can fail

Break the production command by one semitone, or delete the code that updates
the canvas `aria-label`, and rerun. The model assertion and the visible
assertion must fail separately. If deleting the bridge leaves the suite green,
the suite never used it.

Verified shape (2026-11): a 640×360 chord canvas, Chromium 158, Playwright
1.65 — bridge read, `Transpose +1` click, model and chord list both changed;
the transition from `?test=1` to `?a11y=broken` was caught by the accessibility
check in the same run.

## Sources

Playwright's [evaluate](https://playwright.dev/docs/evaluate) and
[test fixtures](https://playwright.dev/docs/test-fixtures); the deployment's
`playwright-mcp-canvas-ui-sweep` for the MCP half. The gate-and-clone rules are
this kit's, from the `ui-testing` and `proof-not-tests` skills.

