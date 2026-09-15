# @cc/dsh-adr-panel

A standalone Web-UI plugin for DeepSeek Harness. It adds a **button to the Session
header** that opens a **frame-wide overlay** listing the project's decision records
(`docs/adrs/*.adr.md`) and spec documents (`docs/specs/*.spec.md`), and a **Ratify…**
affordance that submits the ratchet's own `/ratify <id>` command for a proposed,
agent-authored decision.

It never records a consent. A panel that minted one would be a second consent path,
and the deployment's whole consent model rests on there being exactly one. The
affordance only asks the ratchet to put its own question; every button the panel
renders afterwards sends one of the labels **the ratchet itself** put in that
question, so the human's click is the consent and the panel is only the surface.

It is also the only surface that asks. A ratification question carries the ratchet's
`ratify-decision` presentation intent, the panel claims the `conversation.composer`
seat for it, and the Conversation therefore gets a **pointer** — the decision's name
and a button that opens the window — never the question, its record text or its
answer labels. A decision an agent proposed is answered in the decision window, not
as a chat quiz. A **grilling session** is the one exception: its question declares no
panel intent, nothing claims it, and the harness's own card asks it in the
Conversation, where the human is already talking and the question is expected to
block. That fall-through is also the safety net — with this bundle absent, nothing
claims the seat and the question is still asked.

## Files

| File | Role |
|---|---|
| `index.js` | Host half: an empty `apply()`, so the Loader has a row while the browser half ships through `./client`. |
| `client.js` | The hand-written browser bundle (`window.__ModuleLoader__.load`), no build step. |
| `package.json` | `main: index.js`, `exports` for `.` and `./client`, and `dsh.client = { platform: "web", inject: [...] }`. |

## Contracts it relies on

Each was read from the installed harness before writing; file and line are given so a
reader can re-check rather than trust.

| What | Where it was learned |
|---|---|
| Bundle shape: `window.__ModuleLoader__.load({ id, factory: (require) => { var module = { exports: {} }; var exports = module.exports; … return module.exports } })` | `@deepseek-ai/dsh-client-ui-brand-official/lib/client.js` (whole file) |
| Host half is a no-op `apply()` export | `@deepseek-ai/dsh-client-ui-brand-official/lib/index.js` |
| `dsh.client = { platform: "web", inject: [<dep package ids>] }` | `@deepseek-ai/dsh-client-ui-brand-official/package.json` |
| Registration idiom: `ctx.effect(() => ctx.slots.inject(key, () => ctx.slots.register({ name, id, order, inject }, Component)))` | `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js:1361`; `@deepseek-ai/dsh-session-log-export/lib/client.js:264-286` |
| `conversation.session.header.actions` is a **list** slot, scope `session`, whose standard props include **`sessionId`** and **`inputActions`** | catalog entry in `@deepseek-ai/dsh-cordis-client-runner/lib/client.js:3102-3144` |
| `shell.overlay` is a **list** slot, scope `root`, click-through until an entry opts into pointer events | catalog entry in `@deepseek-ai/dsh-cordis-client-runner/lib/client.js:3948-3990`; slot tree in `deepseek-harness/docs/subsystems/slots.md` |
| A registration's `inject: () => ({ … })` members become component props, and `hooks: { panel: source }` becomes a `usePanel(selector)` hook from a bare `getSnapshot`/`subscribe` source | `docs/subsystems/slots.md` ("Developer-provided injection"); shipped example `@deepseek-ai/dsh-session-log-export/lib/client.js:279-286` (`hooks: { sessionLogDownload: controller.store }`) |
| `RemoteResult<T>` is `{ ok: true, value } | { ok: false, error }` | `@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts:65-71` |
| File catalogues: `ctx.remote.workspaceFiles.list(sessionId, path, signal)` and `.read(sessionId, path, range, signal)`, both answering `RemoteResult` | Host signatures `@deepseek-ai/dsh-api-workspace-files/lib/types/index.d.ts:82,125`; client-side `result.ok` handling in `@deepseek-ai/dsh-client-ui-sidebar-files/lib/client.js:52`; the Remote is injected as **`remote`** in `@deepseek-ai/dsh-api-workspace-files/lib/client.js:447-451` |
| Message submit: `inputActions.setDraft(text)` followed by `inputActions.submit()` | interface `@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/input.d.ts:210-221`; `setDraft` uses a **discrete** (synchronous) Lexical update at `.../lib/client.js:12758`, and `submit()` reads that editor at `.../lib/client.js:12845` |
| `conversation.composer` is a **chain** slot. Its owner passes `{ sessionId, session, pendingInteraction }` as owner props, and the chain renders the **first** entry whose `select(ownerProps)` returns a non-null value; a selector that throws is *"treated as declined"*. **Order is ASCENDING `priority`: lower tries first, ties keep registration order.** The entry that owns every question claims ALL pending questions at the default `priority: 0`, so a claim at 0 or above is never reached — which is why this panel registers at **-1**; the approval entry is at `1` and works only because a pending approval is not a pending question, so the owner declines it first | owner `@deepseek-ai/dsh-client-ui-conversation/lib/client.js:14932-14937`; election `@deepseek-ai/dsh-client-ui-renderer/lib/client.js:824-844`; the ordering's own comment, the sort, and the chain return in `@deepseek-ai/dsh-client-ui-slots/src/index.ts` (`ChainSelect` doc, `register`'s `next.sort(...)`, `entriesOfSlot`), duplicated in the installed bundle at `@deepseek-ai/dsh-web-frontend/dist/assets/index-DuF6ti6g.js` (`p.sort(...(m,g)=>(m.options.priority??0)-(g.options.priority??0))`); owner `@deepseek-ai/dsh-client-ui-user-questions/lib/client.js:873-878`; second claimant `@deepseek-ai/dsh-client-ui-approval/lib/client.js:265-272` |
| A question may carry `intent: { kind, approve }`, and a presentation is allowed to claim it only when it can send **every** answer the question allows. The harness renders `plan-review` itself and falls back to a generic card for everything else; the generic card always offers a free-text answer, and the shipped `PlanReviewPanel` claims a question with two buttons anyway, so a two-label presentation is the sanctioned shape for a binary question | `@deepseek-ai/dsh-client-ui-user-questions/lib/client.js:38-56` (`planReviewOf`), `:246-330` (`PlanReviewPanel`, two buttons only), `:660-722` (the generic card's free-text row) |

The paths in the last two data rows are the only data reads the plugin performs; it
writes no file and calls no mutating method. The composer-seat rows are the only
place it adds a surface another plugin must lose a seat to: the ratchet's own
intent is what the claim is keyed on, and `scripts/check-consent-surface.mjs` fails
when the literal the panel matches stops equalling the one the ratchet sends.

## What is NOT verified without a browser

Rendering is no longer on this list: `scripts/test-adr-panel.mjs` executes the shipped
bundle offline — a stub module loader, a minimal React, `apply` driven with a fake client
context — and asserts the rendered tree (the three sections, filled states, outlined
provenance, the state tones, the `decided in` chip). What that cannot reach is the
harness-runtime surface below: it stubs the loader and the injected services, so it
measures what the bundle does with them, not whether the running shell supplies them.

- That the module loader resolves `require("react")` for a dynamically installed
  tarball plugin. The shipped bundles use `require("react/jsx-runtime")`; `react`
  itself should resolve, but it was not exercised in a browser.
- That injecting only `remote` is sufficient, and that `ctx.remote.workspaceFiles`
  is present at call time. The shipped `dsh-api-workspace-files` also injects
  `"remote.workspaceFiles"` explicitly; this plugin reads it off `ctx.remote` and
  degrades to a visible error line if absent.
- That the registration `inject` factory for a `session` slot receives `sessionId`.
  The plugin avoids depending on it by using the standard `sessionId` prop instead.
- That the renderer derives a `usePanel` hook from `hooks: { panel: … }` with the
  selector signature used here. It follows the documented `hooks: { status }` →
  `useStatus` rule and a shipped example, but was not run.
- That the running shell elects the panel's `conversation.composer` entry **for the
  question it claims**. The election itself is now MEASURED off-browser: the harness
  checkout's slot core is pure TypeScript with no runtime dependencies, Node 24 strips
  the types, and `scripts/test-adr-panel.mjs` drives the real `SlotCore` — the panel's own
  registered `priority` and `select` against a synthetic entry that claims every question
  the way the seat's owner does — and requires the panel to win for the ratchet's real
  question, the owner to win for one the panel declines, and a claim at `priority: 1` to
  lose. That last one is the counterfactual: it is what the bundle used to declare, and it
  is how this plugin's first implementation shipped a dead claim that still passed every
  structural assertion. What remains unmeasured is only the live transport: that clicking
  the window's button round-trips over the Remote to the waiting host, and that a browser
  renders the seat's winner. Without a harness checkout the election check is a `[SKIP]`
  naming the reason, never a silent pass; the always-on half is that the declared priority
  is negative.
- That `list`/`read` return the `RemoteResult` wrapper at runtime. The `.d.ts`
  declares the unwrapped value; the client file browser checks `.ok`, so the wrapper
  is used here. If the runtime instead returns the bare value, the panel shows a
  visible load failure rather than crashing.
- Theme variables (`--dsw-*`) are used with literal fallbacks. `scripts/test-adr-panel.mjs`
  resolves every colour the bundle renders through the installed theme, in both its light
  and dark variants, and requires each toned pill's text to differ from its own fill
  (this is what caught the error pill being filled with `state-error-secondary`, which in
  the dark theme is the same red as its text). What is still not verified is the theme's
  own contrast: the check refuses a collapse, not a low-contrast palette, and whether the
  shell's tints read well is the shell's decision, not this panel's.

## Fallbacks and deliberate omissions

- **No primitives package.** `@deepseek-ai/dsh-client-ui-primitives` is a peer of the
  shipped bundles but was not present in the installed tree to read, so the panel uses
  plain `React.createElement` elements with inline styles instead of guessing a
  component API.
- **No locale service.** Strings are English literals; registering a `locale`
  namespace is the house style but was left out to keep this first version small.
- **Ask-the-agent falls back to a command.** When no live Session composer is
  mounted, the affordance renders the exact commands instead of a button:
  ask the agent to call `ratchet_ratify`, or list what waits with
  `node plugins/ratchet/ratchet-cli.mjs pending --root .`.
- **The seat claim is a suppression, so its failure mode is asymmetric.** The panel
  claims the composer seat in order to stop the harness asking an agent's decision in
  the Conversation. If the claim is never reached — a future harness that reorders or
  re-specifies the chain — the generic card asks the question in the Conversation
  instead. That is a UX regression rather than a hang: an unclaimed question is still a
  question with an answer surface, which is why the claim is a suppression and not the
  only route to the human.
- **Graceful failure is by design.** A missing `ctx.remote.workspaceFiles`, an
  unreadable directory or file, and malformed frontmatter all render as text inside
  the window; the header button and the rest of the shell are unaffected.
