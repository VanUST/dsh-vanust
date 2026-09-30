# @cc/dsh-adr-panel

A standalone Web-UI plugin for DeepSeek Harness. Its name is historical: it began as a
window on architecture decision records, and it is now the deployment's **spec editor**.
It adds a **button to the Session header** labelled **Specs** that opens a **frame-wide
overlay**: the project's spec documents (`docs/specs/*.md`) are listed, one opens in a
text editor, and specs are saved, created and deleted from there.

**It renders no decisions and mints no consent.** There is no ratification surface, no
decision queue, no law view and no resolve action, because none of those mechanisms
exists in this deployment any more. ADRs are not edited or read here; they remain plain
files a human keeps under `docs/adrs/`, which nothing reads. The overlay compiles
nothing, verifies nothing and records nothing; it writes spec files and nothing else.

The spec mechanism itself is `@cc/dsh-specs`: it reads the active specs and contributes
them to the system prompt of every root session and every subagent, re-read on each
prompt assembly. This plugin is only the window a human writes them through.

## The host half (`index.js`)

One capability-fenced route, `<SPECS_ROUTE>` = `/adr-panel/specs`:

| Request | Answer |
|---|---|
| `GET ?session=<id>` | `{ ok, project, specs: [{ file, title, status, body }] }` |
| `POST { session, file, content }` | writes (creates or overwrites) one spec |
| `POST { session, file, remove: true }` | deletes one spec, or reports `removed: false` |

Every request carries the `<SPECS_HEADER>` capability (`x-adr-panel-specs`), whose token
is minted per activation with `randomBytes`, held in memory, published only as the index
global `<SPECS_GLOBAL>` (`__DSH_ADR_PANEL_SPECS__`) and never written or logged.

**Gate order is the design: the fence, then the capability, then disk.** Each request
asks `connection.requestRejection(request)` first and is answered `503`, `401`/`403` on
rejection; a missing or wrong capability header is refused `403` before anything is read
or written; only then is the project resolved. The route reaches three services with
`ctx.get`, never as hard dependencies:

- `webServer` — the HTTP carrier. Absent, the plugin contributes nothing.
- `connection` — the browser trust fence. **Absent, every request is refused `503`**,
  because without it an unauthenticated loopback caller and a browser are
  indistinguishable.
- `agents` — the live-agent registry, used only to resolve a Session id to the workspace
  it was opened on. Its absence is a named refusal; the project root is never guessed
  from `process.cwd()`, which is where the server was launched rather than the project
  the human is looking at.

The route is storage and transport only. It compiles nothing, verifies nothing, records
nothing and keeps no ledger. The one thing it does beyond moving bytes is refuse to
touch a path outside `<project>/docs/specs`:

- `file` must match a bare markdown filename (`^[A-Za-z0-9._-]{1,120}\.md$`), so a
  separator, a drive letter, `..` or an empty string is refused `400` — a path escape
  fails the pattern rather than being sanitized.
- `content` must be a non-empty string; an empty body is refused `400`, because an empty
  spec is indistinguishable from a successful delete.
- A delete naming a file that is not there answers `{ ok: true, removed: false }`, which
  is not an error — the caller's intent already holds.
- A listing whose file cannot be read reports that one spec with an empty body and
  `unreadable: true` rather than dropping the whole listing.
- A returned body is capped at 200,000 characters so one huge file cannot wedge the
  window.

`docs/specs` missing is not an error: `GET` answers an empty list and `POST` creates the
directory.

## The browser half (`client.js`)

One contribution to `conversation.session.header.actions` (the **Specs** button, which
receives `sessionId`) and one to `shell.overlay` (the frame-wide window). The window
renders nothing while closed.

It reads and writes **only** through the host route, learned at mount time from the
index global; when that global is absent it says the host half is not mounted and offers
no editor, rather than showing an empty list that reads like "this project has no
specs". It never falls back to reading files itself, and it never constructs a filesystem
path — the host's validation is the single place that decides what may be written.

A bound Session is required, because the project is resolved from it. Saving with no
change, or with an empty body, is disabled — the same empty-document ambiguity the host
refuses. Deleting asks for confirmation in the UI before the request is sent. A spec the
host reported as unreadable is listed with a warning and opens read-only, so saving
cannot overwrite bytes that were never loaded. A failed load shows the route's own
message and offers Retry.

## Files

| File | Role |
|---|---|
| `index.js` | Host half: registers the read-only GET and the writing POST of `/adr-panel/specs` on `webServer`, guards both with `connection.requestRejection` and a per-activation capability, and constrains every write to `<project>/docs/specs`. It derives no state and writes no artifact of its own beyond the requested spec file. |
| `client.js` | The hand-written browser bundle (`window.__ModuleLoader__.load`), no build step. It mounts the Session-header button and the overlay, fetches the route and writes through it; it derives nothing about a spec's meaning. |
| `package.json` | `main: index.js`, `exports` for `.` and `./client`, and `dsh.client = { platform: "web", inject: [...] }`. |

**What checks the bundle, and what does not.** `client.js` is a hand-written closure with
**no generator and no build step** — do not claim one exists, and do not produce the file
from a source tree, because there is none. What verifies it is exactly two things, and
nothing else: `node --check` (it parses) and `node scripts/check-portability.mjs`'s
`tarball:matches-source` (the shipped tarball's bytes are the checked-in file's bytes).
There is no offline test that executes the bundle, so a mistake this pair does not see
ships.

## Contracts it relies on

Each was read from the installed harness before writing.

| What | Where it was learned |
|---|---|
| Bundle shape: `window.__ModuleLoader__.load({ id, factory: (require) => { var module = { exports: {} }; var exports = module.exports; … return module.exports } })` | `@deepseek-ai/dsh-client-ui-brand-official/lib/client.js` |
| `dsh.client = { platform: "web", inject: [<dep package ids>] }` | `@deepseek-ai/dsh-client-ui-brand-official/package.json` |
| Registration idiom: `ctx.slots.inject(key, () => ctx.slots.register({ name, id, order, inject }, Component))` | `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js`; `@deepseek-ai/dsh-session-log-export/lib/client.js` |
| `conversation.session.header.actions` is a **list** slot, scope `session`, whose standard props include **`sessionId`** | the slot catalogue in `@deepseek-ai/dsh-cordis-client-runner/lib/client.js` |
| `shell.overlay` is a **list** slot, scope `root`, click-through until an entry opts into pointer events | the slot catalogue in `@deepseek-ai/dsh-cordis-client-runner/lib/client.js`; slot tree in `deepseek-harness/docs/subsystems/slots.md` |
| A host plugin serves a browser by registering an HTTP route: `ctx.webServer.register({ kind, path, handler })`, a duplicate path throws, and the server awaits an async handler | `@deepseek-ai/dsh-host-webserver/lib/index.js` |
| Every route should ask the connection service for a rejection first: `connection.requestRejection(request)` answers 403 for an untrusted authority, then 401 unless the request carries the signed, `HttpOnly`, `SameSite=Strict`, authority-bound browser cookie | `@deepseek-ai/dsh-client-connection/lib/index.js` |
| A plugin can provide and read a service without injecting it: `ctx.provide(name, value)`, `ctx.get(name)` | `@deepseek-ai/cordis/src/reflect.ts` |
| The context publishes an index global through the webserver's injection table: `web.on('webserver/index-inject', (table) => table.push({ kind: 'global', name, value }))` | `@deepseek-ai/dsh-host-webserver/lib/index.js` |
| A plugin that calls `ctx.inject(['webServer'], cb)` and never gets the service stays inert rather than failing the boot | `@deepseek-ai/dsh-client-connection/lib/index.js`; `@deepseek-ai/dsh-app-boot/lib/index.js` |
| A Session id resolves to a workspace through the live registry: `agents.get(id)?.session?.header?.cwd` | `@deepseek-ai/dsh-api-workspace-files/lib/index.js` |
| The browser reaches such a route with an ordinary same-origin `fetch` on a path both halves declare as a constant | `@deepseek-ai/dsh-client-ui-open-in-app/lib/client.js` |

## What is NOT verified without a browser

- That the module loader resolves `require("react")` for a dynamically installed tarball
  plugin. The shipped bundles use `require("react/jsx-runtime")`; `react` itself should
  resolve, but it was not exercised in a browser.
- That the route is reachable from a real browser page. No browser was opened, so the
  page carrying the capability global, the header button rendering and a real click
  round-tripping through the shell remain readings rather than measurements.
- That the host half's write path is exercised end to end over HTTP: the route is driven
  by the plugin's own logic, and nothing in this kit starts a web server and drives it.
- That the registration `inject` factory for a `session` slot receives `sessionId`. The
  plugin avoids depending on it by using the standard `sessionId` prop instead.
- Theme variables (`--dsw-*`) are used with literal fallbacks; the shell's own palette is
  not measured here.

## Fallbacks and deliberate omissions

- **No primitives package.** `@deepseek-ai/dsh-client-ui-primitives` is a peer of the
  shipped bundles but was not present in the installed tree to read, so the panel uses
  plain `React.createElement` elements with inline styles instead of guessing a
  component API.
- **No locale service.** Strings are English literals; registering a `locale` namespace
  is the house style but was left out to keep this version small.
- **An unmounted host half is explained, not guessed.** With no capability global the
  window says the host is not mounted and fetches nothing; it does not try to read specs
  client-side.
- **Graceful failure is by design.** An unreachable route, a project whose listing
  reports a problem, and an unreadable spec all render as text inside the window; the
  header button and the rest of the shell are unaffected.
