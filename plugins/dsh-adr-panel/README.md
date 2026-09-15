# @cc/dsh-adr-panel

A standalone Web-UI plugin for DeepSeek Harness. It adds a **button to the Session
header** that opens a **frame-wide overlay** listing the project's decision records
(`docs/adrs/*.adr.md`) and spec documents (`docs/specs/*.spec.md`), and **Approve** and
**Decline** on a proposed, agent-authored decision that waits for a human.

A click records the decision silently: no chat message, no model turn, no agent in the
loop. The host half serves one route, `/adr-panel/consent`; the panel asks it for the
ratchet's own question about that decision, renders the question in the row — the
ratchet's header and text, the record's own bytes, both labels it put on the question —
and posts back the label belonging to the button that was pressed, together with that
same question. The route hands both to the ratchet's own `ratify` operation, which writes
the approval ADR and its transcript.

It never records a consent of its own. A panel that minted one would be a second consent
path, and the deployment's whole consent model rests on there being exactly one. The
panel builds no question and interprets no answer: the question is the ratchet's, every
label it sends is one the ratchet put on that question, and the only artifact is the one
the ratchet writes.

It is also the only surface that answers a question the ratchet asks **through the
composer**. A ratification question carries the ratchet's `ratify-decision` presentation
intent, the panel claims the `conversation.composer` seat for it, and the Conversation
therefore gets a **pointer** — the decision's name and a button that opens the window —
never the question, its record text or its answer labels. A decision an agent proposed is
answered in the decision window, not as a chat quiz. A **grilling session** is the one
exception: its question declares no panel intent, nothing claims it, and the harness's own
card asks it in the Conversation, where the human is already talking and the question is
expected to block. That fall-through is also the safety net — with this bundle absent,
nothing claims the seat and the question is still asked.

## Files

| File | Role |
|---|---|
| `index.js` | Host half: registers the consent route on `webServer`, guards it with `connection.requestRejection` and a per-activation capability, and calls the ratchet's `ratchetConsent` service. It builds no question and writes no file. |
| `client.js` | The hand-written browser bundle (`window.__ModuleLoader__.load`), no build step. |
| `package.json` | `main: index.js`, `exports` for `.` and `./client`, and `dsh.client = { platform: "web", inject: [...] }`. |

## Contracts it relies on

Each was read from the installed harness before writing; file and line are given so a
reader can re-check rather than trust.

| What | Where it was learned |
|---|---|
| Bundle shape: `window.__ModuleLoader__.load({ id, factory: (require) => { var module = { exports: {} }; var exports = module.exports; … return module.exports } })` | `@deepseek-ai/dsh-client-ui-brand-official/lib/client.js` (whole file) |
| `dsh.client = { platform: "web", inject: [<dep package ids>] }` | `@deepseek-ai/dsh-client-ui-brand-official/package.json` |
| Registration idiom: `ctx.effect(() => ctx.slots.inject(key, () => ctx.slots.register({ name, id, order, inject }, Component)))` | `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js:1361`; `@deepseek-ai/dsh-session-log-export/lib/client.js:264-286` |
| `conversation.session.header.actions` is a **list** slot, scope `session`, whose standard props include **`sessionId`** | catalog entry in `@deepseek-ai/dsh-cordis-client-runner/lib/client.js:3102-3144` |
| `shell.overlay` is a **list** slot, scope `root`, click-through until an entry opts into pointer events | catalog entry in `@deepseek-ai/dsh-cordis-client-runner/lib/client.js:3948-3990`; slot tree in `deepseek-harness/docs/subsystems/slots.md` |
| A registration's `inject: () => ({ … })` members become component props, and `hooks: { panel: source }` becomes a `usePanel(selector)` hook from a bare `getSnapshot`/`subscribe` source | `docs/subsystems/slots.md` ("Developer-provided injection"); shipped example `@deepseek-ai/dsh-session-log-export/lib/client.js:279-286` (`hooks: { sessionLogDownload: controller.store }`) |
| `RemoteResult<T>` is `{ ok: true, value } | { ok: false, error }` | `@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts:65-71` |
| File catalogues: `ctx.remote.workspaceFiles.list(sessionId, path, signal)`, `.read(sessionId, path, range, signal)` and `.readAll(sessionId, path, signal)`, all answering `RemoteResult` | Host signatures `@deepseek-ai/dsh-api-workspace-files/lib/types/index.d.ts:82,125`; client-side `result.ok` handling in `@deepseek-ai/dsh-client-ui-sidebar-files/lib/client.js:52`; the Remote is injected as **`remote`** in `@deepseek-ai/dsh-api-workspace-files/lib/client.js:447-451`; `readAll` is called by the harness's own browser plugin as `ctx.remote.workspaceFiles.readAll(file.sessionId, file.path, signal)` in `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js:26941` |
| `read` returns ONE PAGE of lines and rebuilds the text by joining them with `\n`, so a file whose last line ends in a newline comes back WITHOUT it; `readAll` returns the file's exact bytes as base64 | `@deepseek-ai/dsh-api-workspace-files/lib/index.js:182-226` (`cutPage`: `lines.join("\n")`, and the final line is pushed only when it is non-empty), `:399-411` (`read`), `:443-464` (`readAll`, base64 of `fs.readByteRange`), `:526-534` (the page defaults). Measured in-process through the real `WorkspaceFiles` service: `docs/adrs/0014-…adr.md` is 8946 bytes on disk and 8945 bytes from `read`, so its paged text hashes to `sha256:4c386eb7…` while the ratification that binds it records `sha256:307b2c20…` |
| `conversation.composer` is a **chain** slot. Its owner passes `{ sessionId, session, pendingInteraction }` as owner props, and the chain renders the **first** entry whose `select(ownerProps)` returns a non-null value; a selector that throws is *"treated as declined"*. **Order is ASCENDING `priority`: lower tries first, ties keep registration order.** The entry that owns every question claims ALL pending questions at the default `priority: 0`, so a claim at 0 or above is never reached — which is why this panel registers at **-1**; the approval entry is at `1` and works only because a pending approval is not a pending question, so the owner declines it first | owner `@deepseek-ai/dsh-client-ui-conversation/lib/client.js:14932-14937`; election `@deepseek-ai/dsh-client-ui-renderer/lib/client.js:824-844`; the ordering's own comment, the sort, and the chain return in `@deepseek-ai/dsh-client-ui-slots/src/index.ts` (`ChainSelect` doc, `register`'s `next.sort(...)`, `entriesOfSlot`), duplicated in the installed bundle at `@deepseek-ai/dsh-web-frontend/dist/assets/index-DuF6ti6g.js` (`p.sort(...(m,g)=>(m.options.priority??0)-(g.options.priority??0))`); owner `@deepseek-ai/dsh-client-ui-user-questions/lib/client.js:873-878`; second claimant `@deepseek-ai/dsh-client-ui-approval/lib/client.js:265-272` |
| A question may carry `intent: { kind, approve }`, and a presentation is allowed to claim it only when it can send **every** answer the question allows. The harness renders `plan-review` itself and falls back to a generic card for everything else; the generic card always offers a free-text answer, and the shipped `PlanReviewPanel` claims a question with two buttons anyway, so a two-label presentation is the sanctioned shape for a binary question | `@deepseek-ai/dsh-client-ui-user-questions/lib/client.js:38-56` (`planReviewOf`), `:246-330` (`PlanReviewPanel`, two buttons only), `:660-722` (the generic card's free-text row) |
| A host plugin serves a browser by registering an HTTP route: `ctx.webServer.register({ kind, path, handler })`, a duplicate path throws, and the server awaits an async handler | `@deepseek-ai/dsh-host-webserver/lib/index.js:176` (`register`), `:228` (the awaited handler); shipped example `@deepseek-ai/dsh-host-open-in-app/lib/index.js:1324-1454` |
| The browser reaches such a route with an ordinary same-origin `fetch` on a path both halves declare as a constant | `@deepseek-ai/dsh-client-ui-open-in-app/lib/client.js:22-27` (the inlined route constants and `hostBase()`) |
| Every route should ask the connection service for a rejection first: `connection.requestRejection(request)` answers 403 for an untrusted authority, then 401 unless the request carries the signed, `HttpOnly`, `SameSite=Strict`, authority-bound browser cookie | `@deepseek-ai/dsh-client-connection/lib/index.js:553` (`requestRejection`), `:280-320` and `:431-441` (the cookie); the same call in `@deepseek-ai/dsh-host-open-in-app/lib/index.js:1317-1323` |
| A plugin can provide a service and read one without injecting it: `ctx.provide(name, value)` returns a disposer, `ctx.get(name)` reads an implementation | `@deepseek-ai/cordis/src/reflect.ts:277-305` (`provide`), `:233` (`get`) |
| A plugin that calls `ctx.inject(['webServer'], cb)` and never gets the service stays inert rather than failing the boot | `@deepseek-ai/dsh-client-connection/lib/index.js:758` does exactly this; `@deepseek-ai/dsh-app-boot/lib/index.js` builds its `did not activate` list from loader rows only |
| A Session id resolves to a workspace through the live registry, then persistence: `sessions.get(id)?.header` or `sessionPersistence.stat(id).header` | `@deepseek-ai/dsh-api-workspace-files/lib/index.js:372-389` |
| The context publishes an index global through the webserver's injection table: `web.on('webserver/index-inject', (table) => table.push({ kind: 'global', name, value }))` | `@deepseek-ai/dsh-host-webserver/lib/index.js:74-93` (the row renderer) and `:349-353` (`collectIndexInjections`); the same subscription in `@deepseek-ai/dsh-client-connection/lib/index.js:760-766` |

The paths in the file-catalogue row are the only data reads the plugin performs in the
browser; the browser half writes nothing. A record's text is taken from **`readAll`**, the
whole-file read, because a consent is a claim about an exact text and the paged text is a
reconstruction that drops a final newline: hashing it made a ratified record whose last
line ends in a plain LF hash to a value no ratification recorded, so the decision was
displayed as `awaiting a human` while the ratchet had it in force. A record the whole-file
read cannot serve is left with NO content hash — so it can never be reported as in force on
the strength of a text nobody approved — and the window reports that its consent could not
be verified instead of silently listing it as unpaid. The host half writes nothing either —
the approval and the transcript are written by the ratchet inside the `ratchetConsent` call.
`scripts/check-consent-surface.mjs` fails when the route, the service name, the capability
header or the capability global stops being the same value on both halves, when any
registered tool names one of them, or when the provided consent service stops refusing the
payloads it must refuse.

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
- **The consent route's two ends are measured; the wire between a browser and it is not.**
  `node scripts/probe-dsh-api.mjs --adr-panel-consent` mounts the real
  `@deepseek-ai/dsh-host-webserver`, the real `@deepseek-ai/dsh-client-connection`, this
  host half and the ratchet, drives the route over real HTTP on loopback, mints a browser
  session through the production `authorizeIndex`, reads the capability out of the harness's
  index-injection table, and requires the fence, the capability, the refusals and the
  written approval (15/15, `adr panel consent route ok`). `scripts/test-adr-panel.mjs`
  executes the shipped bundle against a stub host and requires what it sends and renders.
  No browser was opened, so the page carrying the capability global and a real click
  round-tripping through the shell remain readings rather than measurements.
- **The capability's secrecy rests on there being no file.** The token is minted per
  activation with `randomBytes`, held in the plugin's memory, published only as an index
  global, and never written or logged — so no tool of an agent can read it. The route is
  additionally behind the harness's signed browser cookie. The residual gap is stated in
  ADR 0034 and its reasoning source: an agent whose tools can read
  `$DSH_HOME/.credentials.yaml` could forge that cookie, which is the same hand-written
  approval the deployment's rule 12 already names as forgeable.

- That `list`/`read`/`readAll` return the `RemoteResult` wrapper at runtime. The `.d.ts`
  declares the unwrapped value; the client file browser and the harness's own document
  preview check `.ok`, so the wrapper is used here. If the runtime instead returns the bare
  value, the panel shows a visible load failure rather than crashing.
- **That `readAll` is on the browser-side Remote at all** is a reading, not a browser
  measurement: it is one of the namespace's generated Remote descriptors
  (`@deepseek-ai/dsh-api-workspace-files/lib/typert.remote-client.js:202-237`) and the
  harness's own client plugin calls it through the same `ctx.remote` object this plugin
  reads (`@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js:26941`). No
  browser was opened. Where it is absent the panel falls back to the paged read, gives the
  record no content hash, and says in the window that a ratification it carries could not
  be verified — a visible degradation, never a silent wrong state.
- Theme variables (`--dsw-*`) are used with literal fallbacks. `scripts/test-adr-panel.mjs`
  resolves every colour the bundle renders — every toned pill AND every toned button (the
  row's **Approve**, the window's **Approve**, the pointer's **Open the ADRs panel**) —
  through the installed theme, in both its light and dark variants, and requires each
  one's text to differ from its own fill (this is what caught the error pill being filled
  with `state-error-secondary`, which in the dark theme is the same red as its text). A
  plain, transparent button is not measured, because it inherits its colour and there is
  no pair to compare. What is still not verified is the theme's own contrast: the check
  refuses a collapse, not a low-contrast palette, and whether the shell's tints read well
  is the shell's decision, not this panel's.
- That the running shell's origin exposes `crypto.subtle` (Web Crypto) and `atob` plus
  `TextDecoder`. The panel derives each decision's in-force state the way the ratchet does,
  and a ratification counts only while the recorded content hash still matches the file,
  which it computes with `crypto.subtle.digest` over the whole-file text `readAll` returned
  (base64-decoded by `atob`/`TextDecoder`). The panel runs on the harness's localhost
  origin, where Web Crypto is available; on a non-secure origin `contentHashOf` returns
  `null` and a consented record reads as not in force rather than being trusted
  unverified, and a `readAll` payload that cannot be decoded takes the same path with a
  reported reason. The offline test runs in Node, where `crypto.subtle`, `atob` and
  `TextDecoder` exist, so the fallbacks themselves are not exercised.

## Fallbacks and deliberate omissions

- **No primitives package.** `@deepseek-ai/dsh-client-ui-primitives` is a peer of the
  shipped bundles but was not present in the installed tree to read, so the panel uses
  plain `React.createElement` elements with inline styles instead of guessing a
  component API.
- **No locale service.** Strings are English literals; registering a `locale`
  namespace is the house style but was left out to keep this first version small.
- **An unreachable consent route falls back to a command.** When the host half published
  no capability — it is not mounted, this page did not come from it, or there is no web
  server — the row renders the exact commands instead of Approve and Decline: ask the
  agent to call `ratchet_ratify`, or list what waits with
  `node plugins/ratchet/ratchet-cli.mjs pending --root .`. Nothing is fetched in that
  state, which the offline test asserts.
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
