# @cc/dsh-adr-panel

A standalone Web-UI plugin for DeepSeek Harness. It adds a **button to the Session
header** that opens a **frame-wide overlay** listing the project's decision records
(`docs/adrs/*.adr.md`) and spec documents (`docs/specs/*.spec.md`), and **Approve** and
**Decline** on a decision the ratchet's queue lists as waiting for a human — agent- or
human-authored. Authorship is not what the queue keys on: a human-authored record that is
still `proposed` is put into force by the human's own recorded consent, so it is offered
the same question as an agent's proposal instead of reading as `not in force` with no
action.
A **blocked** record is a pending item, not a dead end. Its card reads the ratchet's resolve
plan from a third route, `/adr-panel/resolve`, and draws it — the steps, whether any needs a
human, and the reasons a human already declined — then offers **Resolve** and **Decline with
a reason**.

**Resolve QUEUES; closing the window dispatches.** One resolver per click is wrong for a
reason that is not cost: a resolver edits the project's `.dsh/project.json`, so six of them
running at once produced one surviving edit, five lost ones and an unrelated change, while
no zone was declared. So a click marks the record queued, the window states the queue
(N queued · which ids · Clear), and **closing the window sends ONE request** carrying every
queued id. The ratchet builds one prompt from the whole batch, stating a step several
records share ONCE — four records naming one zone are one decision about that zone. The host
starts ONE continuable child on that prompt, and a later batch **steers the resolver already
working** on this project (`sendMessage` to the same child) rather than starting a rival; a
dispatch from a different Session is refused `resolve-busy`, because delivery follows the
direct-parent relation and a rival would race it for the same manifest. A plan with a step
no agent may carry is left out of the batch and reported in `humanRequiredIds`, so one
`humanOnly` record cannot poison the rest. Starting a resolver mints nothing: the child
writes a `proposed` record and the human still approves it through the row's own Approve.

**A start is called started only once the runtime accepted it.** The route awaits
`startContinuable`/`sendMessage`: a rejected start is a refusal carrying the runtime's own
message, never a success the human cannot distinguish from work that never began.
**Decline** records why the proposed resolution is wrong, so the next attempt can differ.


The window is **four tabbed parts, not one long scroll**: a sticky navigator offers
`Needs a human (N)`, `Decisions (N)`, `Consents (N)` and `Specs (N)`, each stating its
count, and exactly one part is drawn at a time. The active tab is component state; until
it is chosen the window opens on the first non-empty part in that order (so the actionable
part leads), else Decisions. Each part carries its own heading and a one-line explanation.
A pending ratification question is drawn above the navigator, because a question waiting
on the human must not be behind a tab. Every part holds the same data the single scroll
held; nothing is removed.

A click records the decision silently: no chat message, no model turn, no agent in the
loop. The host half serves two routes: `GET /adr-panel/state` returns the ratchet's view
model (every record's force, its provenance, the ratify queue and the compiled spec
documents), capped by the ratchet to record, spec and needs-a-human counts and a byte
budget with a `truncated` member naming anything it dropped, and derived off the event
loop so a large corpus cannot stall the harness; the panel RENDERS it unchanged — it
derives nothing itself. Approval and
decline use the second route, `/adr-panel/consent`; the panel asks it for the ratchet's own
question about that decision, renders the question in the row — the ratchet's header and
text, the record's own bytes, both labels it put on the question — and posts back the label
belonging to the button that was pressed, together with that same question. The route hands
both to the ratchet's own `ratify` operation, which writes the approval ADR and its
transcript. A `POST` body that does not complete within the route's deadline is refused
`408` and its socket destroyed, so an unfinished write cannot pin the route.

**Decline asks why.** Pressing **Decline** puts a reason box in the row instead of sending
at once; the human types their reason and confirms, or cancels and sends nothing. The words
travel with the refusal as the `comment` field of the same `POST /adr-panel/consent`, and
the ratchet records them — trimmed and bounded — beside the refusal in the append-only
ledger. A reason is never read as an answer: the label and the question decide that, and an
approval discards any reason sent with it. A whitespace-only box is sent as `null`, never as
an empty string, so a silent decline stays silent, and the outcome repeats the recorded
reason back so the human can see what the ratchet stored. The route passes `comment` through
unread; it attaches no meaning to it.

It never derives a decision's state and never records a consent of its own. A panel that
re-derived force would be a second implementation of one truth — the defect that read
`status: proposed` as "unpaid" and hashed a record from a paged read one byte short — and a
panel that minted a consent would be a second consent path; the deployment's whole model
rests on there being exactly one of each. The panel builds no question, interprets no
answer, computes no hash and matches no consent: every force fact is the ratchet's, every
label it sends is one the ratchet put on that question, and the only artifact is the one
the ratchet writes.

The **Needs a human** part is the ratchet's single set. It is the developer's entry point:
the consents waiting in the ratify queue, the decidable contradictions between a proposal
and law in force, the duplicates with the resolution the drafting pass wrote, a **stale**
generated spec document together with the withdrawal note the ratchet drafted for it, and a
red gate read from the persisted verification report. Each entry carries the ratchet's own
reason and action and, when the ratchet drafted a settlement, its `draft` (`{ id, path }`) —
rendered as the drafted record or note — or a `draftReason` saying why none could be
produced. A hand-edited, missing or orphaned spec document is a blocking problem, not an
advisory note, and so is not shown as a drafted fix. **Every need is read and acted on in place — there is no redirect.** Each card carries
**Read the decision** (the record's own four sections, revealed where you are) and the action
the ratchet is waiting for: **Approve**/**Decline** for any record whose `canRatify` the queue
sets — a consent, and the drafted resolution a contradiction or a duplicate is settled by —
and **Resolve**/**Decline with a reason** for a blocked one. `canRatify` is the gate, not the
kind, because a drafted resolution is a proposed record like any other. The Decisions row
keeps its own Approve/Decline, because the host caps the needs set and a record whose need was
cut must still be actionable somewhere. The ratchet derives every entry from its own functions; the panel
copies the set unchanged and never grows a finding of its own. When the set is empty the
part still renders, with a plain statement that nothing needs a human, rather than
disappearing — its tab still states `Needs a human (0)`.

The set is **grouped by kind**, because the finding is a batch but the act changes tone. A
`consent`, a `contradiction` and a `duplicate` each need one distinct decision, so each
stays an individual card with the ratchet's reason and action. Everything else is one
collapsible batch card — `Stale specs · 7` — whose header always states the batch name, its
count and what the batch is, and whose default-collapsed body expands to each document with
its path, a one-line reason, the drafted note path and the ratchet's full action. The order
is fixed: consents, contradictions, duplicates, the grouped batches, then the red-gate fact.
A full `sha256:<64 hex>` in any rendered reason, action, problem line or spec header is
**shortened for display only** — twelve hex characters and an ellipsis — with the full value
kept in the element's `title`, so what is abbreviated is never what is lost; no rule, hash
or artifact changes. When the host's `needsHuman` cap cut the set, the section states the
shown and total counts and every kind that lost an entry, and a cut batch's header says
`shown of total`, so a partial to-do list reads as partial rather than complete.

A **decision row's collapsed preview** is one line per fact: the id, the title, the state
pill, the provenance pill and the author pill, then a single-line summary clipped with an
ellipsis. The metadata grid, the laws the record decided and the four body sections appear
only on expand, rendered as headings, paragraphs and lists. The summary is the panel's one
display derivation here: it strips a leading list or ordered marker and markdown emphasis,
takes the first sentence that actually contains a letter, tries Decision then Context then
the body's first paragraph then the title, and caps the result at 140 characters. A Decision
written as a numbered list beginning `1. **The fiction is adopted…**` therefore reads
`The fiction is adopted…` — the reported bug where such a row read `1.` is fixed at the
rendering, not by changing the data.

A **spec law is a compact row too**: collapsed it shows the law id, a clipped statement, one
toned chip per check kind with its count, and the `decided in` chip; expanded it shows the
full statement, the authority, every check with its type and target/pattern, and — parsed
from the generated document's own `- checks: none, and this law says why:` or
`- not fully covered:` line — the reason nothing enforces the law. The zone grouping, the
check histogram, the toned chips and the `decided in` tone are unchanged.

No part draws an unbounded list: each section, and each spec's law list, draws at most 50
rows and then offers a `Show N more` control beside a `Showing X of Y` line. The rows past
the cap are loaded and revealed by the control, never dropped, and the host's own
`truncated` fact is stated separately, so a client-side cap and a server-side cap are not
confused.

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
| `index.js` | Host half: registers the read-only `/adr-panel/state` route and the `/adr-panel/consent` route on `webServer`, guards both with `connection.requestRejection` and a per-activation capability, calls the ratchet's `ratchetDecisions` service for the view model and its `ratchetConsent` service for an answer, and bounds a `POST` body with a read deadline. It derives no state, builds no question and writes no artifact; a consent `GET` writes only the ratchet's audit ledger line. |
| `client.js` | The hand-written browser bundle (`window.__ModuleLoader__.load`), no build step. It fetches the state route and renders the ratchet's view as four tabbed parts — the `needsHuman` set, the decisions, the consents and the specs — with one part drawn at a time; it derives no force. |
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
| A route answers JSON over the same origin; the browser reaches it with an ordinary `fetch` carrying the capability header | this plugin's own `index.js` routes and `client.js` `consentRequest`; the host signature and the browser-session fence rows above |

The panel reads NO file: the ratchet's host-side `ratchetDecisions` service reads the
corpus, derives every force fact with its own functions (`compileProject`,
`readManifest`, `resolveActiveSet`, `compileLaws`, `ratificationQueue`, `renderSpecs`,
`detectSpecDrift`) and serves the resulting view model at `/adr-panel/state`. The browser
half renders that view and derives nothing: the old `resolveZonePolicy`, `governingZones`,
`parseRatification`, `contentHashOf`, `buildRelations`, `displayedState` and
`canOfferRatify` are deleted, so a change to the ratchet's derivation moves the window
with no panel edit. A route it cannot reach is reported as **state unavailable**; the panel
never falls back to reading the corpus. The host half writes no artifact of its own. A `GET`
on the consent route has exactly one durable effect: the ratchet's `ratify` prepare path
appends one audit event to `.dsh/ratchet/ledger.jsonl` — it writes no approval ADR and no
transcript, and it does not touch the corpus. A `POST` that approves writes the approval and
the transcript, by the ratchet inside the `ratchetConsent` call. `scripts/check-consent-surface.mjs`
fails when either service name, route, capability header or capability global stops being the
same value across the ratchet, this host half and the bundle, when any registered tool names
one of them, or when the provided services stop behaving as required — including the exact
ledger/approval distinction above.
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
be verified instead of silently listing it as unpaid. The host half writes no artifact of
its own: a consent `GET` appends only the ratchet's audit ledger line, and the approval and
transcript are written by the ratchet inside the `ratchetConsent` call.
`scripts/check-consent-surface.mjs` fails when the route, the service name, the capability
header or the capability global stops being the same value on both halves, when any
registered tool names one of them, or when the provided consent service stops refusing the
payloads it must refuse.

## What is NOT verified without a browser

Rendering is no longer on this list: `scripts/test-adr-panel.mjs` executes the shipped
bundle offline — a stub module loader, a minimal React, `apply` driven with a fake client
context — and asserts the rendered tree (the four section tabs and their counts, switching
one part at a time, the collapsed one-line decision summary — including a numbered-list
Decision that must not summarise as `1.` — the compact spec law row with its clipped
statement and on-expand checks, the 50-row cap with its stated count, filled states,
outlined provenance, the state tones, the `decided in` chip). What that cannot reach is the
harness-runtime surface below: it stubs the loader and the injected services, so it
measures what the bundle does with them, not whether the running shell supplies them.

- That the module loader resolves `require("react")` for a dynamically installed
  tarball plugin. The shipped bundles use `require("react/jsx-runtime")`; `react`
  itself should resolve, but it was not exercised in a browser.
- That the state route is reachable from a real browser page. The offline test drives
  `loadPanel` against a stub state route whose payload is computed by the REAL
  `ratchetDecisions` service, so what the bundle does with an answer is measured; that a
  running shell serves the route and that `fetch` carries the browser cookie is a reading.
  Where the route is unreachable the window says so and shows no decisions — a visible
  degradation, never a fallback derivation.
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
- The panel no longer needs `crypto.subtle`, `atob` or `TextDecoder`: it computes no hash,
  so a non-secure origin cannot make a consented record read as not in force. The content
  hashes it displays are the ratchet's, computed host-side over the file's own bytes.

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
- **Graceful failure is by design.** An unreachable state route, a project whose view
  reports problems, and a spec document whose generated text does not parse all render as
  text inside the window; the header button and the rest of the shell are unaffected.
