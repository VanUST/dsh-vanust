# UI testing

A UI is correct when a user can do the task, so the evidence has to come from a browser driving the interface the way a person does. This skill is the checking half of `ui-builder`: same loop, stricter rules about what counts as proof.

## The rules that decide pass or fail

1. **Assert user-visible behaviour.** Query what is rendered and accessible — role, name, text — not the class name, the component state or the array inside it. If the user cannot see it, it is not the contract.
2. **Every check must be able to fail.** Before accepting a green run, break the feature on purpose (stub the API to 500, remove the handler, rename the action) and watch the check go red. A check that stays green is decoration.
3. **Locators in this order** (Testing Library's priority, which matches how people find things): `getByRole(role, { name })` → `getByLabelText` → `getByPlaceholderText` → `getByText` → `getByDisplayValue` → `getByAltText` → `getByTitle` → `getByTestId`. In Playwright this is `page.getByRole('button', { name: 'Save' })`. Chain and filter rather than writing long CSS. Role-first locators also prove the thing is reachable by assistive technology.
4. **Web-first assertions, never a boolean snapshot.** Correct: `await expect(page.getByText('Saved')).toBeVisible()`. Wrong: `expect(await page.getByText('Saved').isVisible()).toBe(true)` — the second checks once, immediately, and passes before the state exists or fails on timing.
5. **Wait for the state, not the clock.** No `sleep`, no fixed timeout. Wait on the observable condition; a sleep hides the race it was meant to fix.
6. **Isolate.** Fresh browser context and storage per test, controlled data, no reliance on the previous test's leftovers. Log in once through a storage-state fixture if authentication is needed.
7. **Control the network that is not yours.** Third-party calls are stubbed (`page.route(...).fulfill(...)`); a test that depends on an external site fails for reasons that are not your code. Assert the request that matters: right URL, right method, right body.
8. **Console errors and failed requests are failures.** Collect them for the whole run and fail on any unexpected error or 4xx/5xx. Silent errors are the most common way a broken UI still "passes".

## The matrix a screen has to survive

For each screen or flow, cover the states, not just the happy path:

- **empty** — no rows; does it explain what to do?
- **loading** — is there a skeleton or a spinner, and does the layout hold?
- **error** — API 500, validation error, and no-JS/offline where relevant;
- **disabled** — the action is present but blocked, with a reason;
- **long data** — 1000 rows, a 200-character name, a narrow column;
- **keyboard only** — Tab reaches every action, focus is visible, Enter/Space activate, Escape closes overlays;
- **narrow width** — one phone width (≈375 px) and one desktop width (≈1280 px);
- **the negative** — clicking the wrong thing does not submit the form.

Accessibility is part of correct, not a separate audit: every input has a label, every button has an accessible name, contrast meets 4.5:1 for body text and 3:1 for large text and UI edges (WCAG 2.2 AA). Run an axe scan where a tool is available, then check focus order by hand — automated scans catch roughly a third of real problems.

## Visual checks

A screenshot is **evidence** for a human: it shows what the run produced. It is not an assertion unless the environment is pinned (same OS, browser build, fonts, device pixel ratio) and someone reviewed the baseline — otherwise the first font fallback on another machine turns it red for no reason. When a visual regression suite is genuinely wanted, pin the environment and keep the number of snapshots small.

## Prove it can fail

Before reporting, run the negative:

```bash
# make the feature absent, then re-run the check
# (disable the action, stub the endpoint, or rename the label)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/save   # expect the stub to return 500
```

If the check still passes with the feature removed, it is testing the harness, the fixture or a stale build.

## What to report

- the command you ran and its exit code;
- the passing and the failing state (the negative run);
- the screenshot path for the screen;
- console errors and failed requests — including "none";
- what you did **not** cover (another browser, real network, screen reader).

"It rendered" is not "it works". Interaction plus assertion is.

## Anti-patterns

- `sleep` anywhere in a UI test.
- CSS/XPath locators tied to layout or class names.
- Asserting on hidden elements or on text that is not in the accessibility tree.
- Testing a third-party service; testing the auth provider itself.
- Sharing state between tests, or depending on execution order.
- Screenshot-as-oracle on unpinned environments.
- A click with no assertion about what changed.
- One viewport, one happy path, and calling it covered.

## Sources

Adapted for this deployment from Playwright's [best practices](https://playwright.dev/docs/best-practices) (user-visible behaviour, isolation, role-first locators, web-first assertions, traces over videos) and Testing Library's [query priority](https://testing-library.com/docs/queries/about#priority); accessibility thresholds from WCAG 2.2 AA.
