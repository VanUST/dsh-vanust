# @cc/dsh-adr-panel

A standalone Web-UI plugin for DeepSeek Harness. It adds a **button to the Session
header** that opens a **frame-wide overlay** listing the project's decision records
(`docs/adrs/*.adr.md`) and spec documents (`docs/specs/*.spec.md`), with a read-only
affordance that **asks the agent** to run `ratchet_ratify` for a proposed,
agent-authored decision.

It never records a consent. A panel that minted one would be a second consent path,
and the deployment's whole consent model rests on there being exactly one. The
affordance only submits a user message; the human still answers the ratchet's own
question.

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

The paths in the last two rows are the only data reads the plugin performs; it writes
no file and calls no mutating method.

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
- That `list`/`read` return the `RemoteResult` wrapper at runtime. The `.d.ts`
  declares the unwrapped value; the client file browser checks `.ok`, so the wrapper
  is used here. If the runtime instead returns the bare value, the panel shows a
  visible load failure rather than crashing.
- Theme variables (`--dsw-*`) are used with literal fallbacks; the exact token names
  were not verified against the running theme.

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
- **Graceful failure is by design.** A missing `ctx.remote.workspaceFiles`, an
  unreadable directory or file, and malformed frontmatter all render as text inside
  the window; the header button and the rest of the shell are unaffected.
