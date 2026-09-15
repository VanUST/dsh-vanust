# The panel records a consent through a host route, with no chat message

**Written:** 2026-09-15 · **Kit:** `C:\dsh-kit` @ `main` · **Harness:**
`@deepseek-ai/dsh@0.1.5-rc.1` with `@deepseek-ai/dsh-*@0.1.5-rc.2` · **Node:** v24.21.0.

This is the reasoning behind the proposed decision record it is cited by. It holds the
direction that asked for the change, the measurements the design was chosen from, what was
rejected and why, and what is still not measured.

## 1. The direction, verbatim

Relayed in the work order that requested this change:

> clicking Approve or Decline in the panel must record the decision silently — no chat
> message, no agent in the loop.

An earlier wording of the same direction already lives in this repository, in
`scripts/test-adr-panel.mjs`:

> Buttons in ADR should approve/decline adr directly, without intermediate chat

The two sentences are one requirement. The first names the failure precisely: the panel's
Approve used to submit `/ratify <id>` into the Session composer, which is a chat message,
which is a model-turn-shaped event, which means an agent runs `ratchet_ratify` before a
human's click becomes a consent. The human clicked a button; the consent arrived only after
an agent acted on a message the human never wrote.

## 2. What was measured before anything was designed

Every fact below was produced by a command on this machine, not recalled.

### 2.1 The old flow really did compose a message

`plugins/dsh-adr-panel/client.js`, before this change, held exactly one submitter for the
overlay to call:

```js
inputActions.setDraft("/ratify " + adrId);
inputActions.submit();
```

It was published by the Session-header action because that seat is the only one with a live
composer. So the panel's own consent affordance was a chat message by construction, and the
composer seat's auto-settle existed only to answer the question that message caused.

### 2.2 How a host plugin serves a browser (fetch-api-first)

`@deepseek-ai/dsh-host-webserver` is the HTTP carrier, and a plugin registers a route
through the service it provides:

- `dsh-host-webserver/lib/index.js:176` — `register(route)` puts a `{ kind, path, handler }`
  in an exact or prefix table and returns a disposer; a duplicate path throws.
- `dsh-host-webserver/lib/index.js:228` — the request handler `await`s the route handler, so
  an async handler owns the response.

The shipped example of the pattern is `@deepseek-ai/dsh-host-open-in-app`, whose host half
registers three routes (`dsh-host-open-in-app/lib/index.js:1324-1454`) and whose browser
half fetches a literal path on the page's own origin
(`dsh-client-ui-open-in-app/lib/client.js:22-27`: `hostBase()` + an inlined route constant).
That answers the two questions the design needed: a route is how a host half reaches a
browser, and the browser learns the path as a literal it shares with the host half.

### 2.3 The fence in front of a route

`@deepseek-ai/dsh-client-connection` provides `connection.requestRejection(request)`
(`dsh-client-connection/lib/index.js:553`): the Host/Origin trust check first (403), then
browser authentication (401). Authentication is a signed, `HttpOnly`, `SameSite=Strict`,
authority-bound cookie (`lib/index.js:280-320`, `:431-441`) whose signing secret is the
`client-connection/browser-session` credential record. `dsh-host-open-in-app` puts every one
of its routes behind that call, which is the shape this change copies.

### 2.4 A plugin can provide a service, and how it is scoped

`ctx.provide(name, value)` registers a service owned by the calling fiber and returns a
disposer (`@deepseek-ai/cordis/src/reflect.ts:277-305`). `ctx.get(name)` reads one without
declaring it (`reflect.ts:233`), which is how the ratchet already reaches the optional
`subagents` and `userQuestions` services, and how the panel reaches the ratchet here.

A plugin that calls `ctx.inject(['webServer'], (web) => …)` and never gets the service stays
PENDING as a child fiber, and the loader only fails on ITS OWN rows
(`dsh-app-boot/lib/index.js`, the `did not activate` list is built from loader entries), so a
browser-facing plugin mounted without a web server is inert rather than a failed boot. This
is why the panel's host half declares no hard injection: `dsh-client-connection` itself
reaches `webServer` the same way.

### 2.5 A Session id resolves to a project root

`dsh-api-workspace-files` resolves a Session for the browser with:

```js
const live = scope.sessions.get(sessionId)?.header
const stored = live === undefined ? await scope.get("sessionPersistence")?.stat(sessionId) : undefined
const header = live ?? stored?.header
```

(`dsh-api-workspace-files/lib/index.js:372-389`). The panel's route uses the same two
services for the same reason: the project a consent is about must come from the Session the
human is looking at, never from the server's launch directory.

### 2.6 A browser plugin CANNOT invoke a registered tool

This was the human's first choice, so it was measured rather than assumed:

- `@deepseek-ai/dsh-tools/package.json` declares **no `dsh.client` row and no `./client`
  export**; its own entry is `lib/index.js`, which imports Node built-ins. It is not a
  browser-loadable package.
- Grepping every shipped browser bundle for a tool-invocation call
  (`Select-String -Path "<harness>/node_modules/@deepseek-ai/dsh-client-ui-*/lib/client.js"
  -Pattern 'tools\.invoke|tools\.call|invokeTool|callTool'`) returns **no match**.
- 55 installed packages declare `dsh.client`, and not one of them holds a tool runtime.

So the client half has no surface through which a tool can be invoked; a plugin that wants
its browser half to cause something host-side must own a host half and expose it — a route,
an RPC channel or a Remote namespace. The route is therefore not a detour around a simpler
tool call: it is the only mechanism available.

### 2.7 The route, driven end to end

```
node scripts/probe-dsh-api.mjs --adr-panel-consent
```

mounts the panel's host half, `@cc/dsh-ratchet`, `@deepseek-ai/dsh-host-webserver` (port 0)
and `@deepseek-ai/dsh-client-connection`, then drives the route over real HTTP on loopback,
minting a browser session through the production `authorizeIndex` and reading the panel's
capability out of the harness's own index-injection table. Observed, 16/16 with exit 0:

| Fact | Observed |
|---|---|
| The capability reaches a page through the harness's index injection | `route=/adr-panel/consent capabilityBytes=43 browserSessionMinted=true` |
| The project root comes from the Session | `sessionCwd=<scratch>/workspace workspace=<scratch>/workspace` |
| An unauthenticated loopback caller is refused and writes nothing | `status=401 wrote=0d/0s` |
| A browser session without the capability is refused | `without=403 tampered=403` |
| The route returns the ratchet's own question | `detailBytes=822 detailHasFrontmatter=true labels=["Approve","Reject"] frozenHash=sha256:4154ab…` |
| A label with no quiz mints nothing | `codes=["RATIFICATION_UNPROVEN"] wrote=0d/0s` |
| A quiz the ratchet did not build mints nothing | `codes=["RATIFICATION_UNPROVEN"] wrote=0d/0s` |
| A record in a `humanOnly` zone mints nothing | `codes=["ADR_FIELD_INVALID"] wrote=0d/0s` |
| The stub human's answer writes the approval and its transcript | `ratified=["0001"] wrote=[…ratification-0001.md, …0004-ratify-adr-0001.adr.md] wrote=1d/1s` |
| The written consent names the surface that carried the question | `approvalChannel="adr-panel" transcriptChannel="adr-panel"` |
| The consent takes effect | `laws=[{id:"api.request-budget", approvedBy:"0004"}] problems=[]` |
| The same answer twice mints once | `codes=["ADR_FIELD_INVALID"] wrote=0d/0s` |
| A record edited while the question was open is refused | `codes=["RATIFICATION_STALE"] wrote=0d/0s` |
| The ratchet's own reject label declines and writes nothing | `rejected=["0003"] wrote=0d/0s` |

## 3. The design

- **The ratchet owns consent, and now provides it as a service.** A new module,
  `plugins/ratchet/ratchet-consent.mjs`, exports `createConsentService()`, and
  `ratchet-tools.mjs` provides it as `ratchetConsent`. Both of its operations are one call
  to `ratify`: `ask` is `ratify({root, ids})` and `settle` is
  `ratify({root, ids, quiz, answer, askedBy, channel})`. The answer is built from the
  question's own `roles` map, so the question id is the ratchet's and the label is carried
  through unchanged for `deriveDecisions` to compare. No question is constructed and no
  answer is interpreted outside the ratchet.
- **The consent names the surface that carried it.** A consent the tool or the command
  obtains records `channel: user-question`, because the harness user-questions seam
  delivered the question. A consent this route obtains records `channel: adr-panel`,
  because the panel's decision window did. The two are the same act in every other respect
  — the same question builder, the same derivation from the selected label, the same frozen
  content hash — and the difference a reader needs is which surface put the question in
  front of the human. `RATIFICATION_CHANNELS` is the closed vocabulary that holds both, and
  its own documentation states the rule this followed: "a channel nobody has implemented is
  not a channel, so this list grows by implementing one". Recording `user-question` for a
  panel answer would have put a false statement in a durable record — the approval's own
  `Decision` section would have said the harness delivered a question the panel delivered —
  and would have made the two indistinguishable in the corpus.
- **The panel's host half is a transport, not a consent path.** `plugins/dsh-adr-panel/index.js`
  registers one exact route, `/adr-panel/consent`, on `webServer`; `GET` asks the service
  for the question about one decision and returns it, `POST` passes `{adrId, label, quiz}`
  through to the service. It builds no question, maps no label, and writes no file.
- **The browser learns where and how at mount time.** The host half mints a 32-byte
  capability per activation with `randomBytes`, holds it in memory, and publishes
  `{ route, token }` as the index global `__DSH_ADR_PANEL_CONSENT__` through the harness's
  own `webserver/index-inject` row, which is rendered into the page before any module runs.
  The bundle reads it, sends the token in `x-adr-panel-consent`, and falls back to naming
  the CLI command when the global is absent.
- **One click, and the human sees what they consented to.** Approve or Decline asks the
  route for the question, renders it in the row — the ratchet's header, its question text,
  the record's own bytes and both labels — sends the label for the button that was pressed
  together with that question, and then renders the outcome: the approval ADR and its
  transcript, or the ratchet's own reason for refusing.
- **The composer entry stays, for the questions it still serves.** A question the ratchet
  asks through another path — an agent calling `ratchet_ratify`, or `/ratify` — is still
  claimed from the composer chain, so the Conversation gets the pointer and the window
  answers it. A grilling session's question still declares no panel intent and is still
  answered in the Conversation. What is gone is the row-click path through the composer.

## 4. Why an agent cannot mint a consent through this route

Stated as the four things that are true, and then the gap that remains.

1. **It is not a tool, and nothing on the tool surface names it.** The route exists only as
   an HTTP route; the service it calls is provided, never registered as a tool. `node
   scripts/check-consent-surface.mjs` scans EVERY tool the ratchet registers — name,
   description and parameters — for the route, the service name, the header and the
   capability global, and fails when any of them appears; it also drives the provided
   service itself and requires the refusals to hold.
2. **The token is not obtainable through any tool.** It is minted per activation with
   `randomBytes`, kept in the plugin's memory, delivered only as an index global into the
   page this process served, and written to no file and no log line. There is nothing on
   disk for a tool to read and no tool result that carries it. The probe obtains it the way
   a browser does — from the index-injection table — which is a host-side call, not a tool.
3. **Every request must also pass the harness's browser fence.** A loopback request with no
   browser session is answered 401 by `connection.requestRejection` and writes nothing
   (measured above). The cookie is `HttpOnly` and lives in the browser's jar.
4. **Even a caller that reaches the route cannot compose an answer.** The answer must carry
   the question the ratchet built for the records waiting now: the ratchet rebuilds it and
   refuses a mismatch (`RATIFICATION_UNPROVEN`), refuses a record changed since the question
   was asked (`RATIFICATION_STALE`), refuses an id that is not waiting, and refuses a record
   whose zone reserves its paths to a human. The approvals it writes are derived from the
   selected label, exactly as the chat quiz's are.

**The gap, stated plainly.** The cookie-signing secret is the
`client-connection/browser-session` record in `$DSH_HOME/.credentials.yaml`, and this
deployment's sessions run with file access that could read it. An agent that read that file
could forge a browser cookie, fetch `/` to read the published capability, and call the route
with a label — and it would then have done by hand what this design exists to prevent. Two
things bound that: it is not a new capability (the same agent can hand-write an approval ADR
that reproduces the ratification block, which hard rule 12 already names as the residual gap
in the whole consent model, since a file cannot prove who wrote it), and the route adds no
tool, no CLI verb and no argument that accepts an answer, so it does not widen the surface
`scripts/check-consent-surface.mjs` measures. It is written here rather than left implicit
because "unreachable by an agent" is exactly the kind of claim that gets read as stronger
than it is.

## 5. Alternatives rejected

- **A client plugin invoking a tool directly.** Measured impossible (§2.6): no client half
  has a tool surface, and `@deepseek-ai/dsh-tools` is not browser-loadable. The direction
  taken instead — a host route — is the only mechanism available, and it is what the
  human's first choice would have had to become.
- **The host half writing the approval itself.** Rejected: that is the second consent path
  the deployment refuses, and it is the forgeable shape hard rule 12 names. The route calls
  `ratify`, so the quiz rebuild, the stale check and the artifact write are the ratchet's.
- **Keeping the composer path and adding the route beside it.** Rejected: two ways to record
  one consent means the composer one still produces a chat message and an agent turn, which
  is the failure the direction names. The composer path is gone from the row; the seat claim
  stays only for questions the ratchet asks through other paths.
- **Rendering the question in the panel and sending a decision name rather than a label.**
  Rejected: a `decision: "approve"` field is the panel composing an answer, and the ratchet
  would have to map it onto a label. The wire carries the label the ratchet itself put on
  the option, and the panel reads it through the same `ratifyQuestionOf` predicate the
  composer seat uses.
- **Trusting the client's copy of the question's text.** Not accepted as a guarantee, but
  not restructured for either: the client echoes the quiz it was given, and the ratchet
  refuses a quiz it did not build. A client that tampered with the `detail` prose while
  keeping the roles would be showing text the hash does not cover — but the same is true of
  the chat card, which renders whatever the question carries, and the panel's bundle is the
  page's own code.
- **Recording the panel's consent under `user-question`.** Rejected after the route was
  working: it is the value that existed, and reusing it would have avoided a change to a
  closed vocabulary. It is false — the seam did not carry that answer — and it would have
  erased the one distinction a reviewer of the corpus needs, which is which surface put the
  question to the human. The vocabulary's own documentation anticipated a second value.

## 6. A law in force that this record does not satisfy as written

`shipped-plugins.consent-travels-the-human-channel` (ADR 0007, restated by ADR 0010 and in
force) says: "A ratification question reaches the human through the harness user-questions
channel carrying the record's own text, and its answer is derived from a selected label
rather than interpreted."

The route does not put its question through that channel. It puts the ratchet's own
question to the human in the panel and derives the answer from the selected label, but the
harness seam is not in the path. Read as a claim about the seam, that law is now a claim
about ONE of the two channels and not about every ratification — and the honest thing to do
with a law in force that a change contradicts is to put the amendment to a human rather than
to reinterpret it quietly.

So this record does **not** edit ADR 0007 (editing a ratified record voids the consent that
put it in force) and does not re-declare its law id (two records declaring one law id is the
corpus contradicting itself). It declares the weaker, true claims it can: the route reaches
the same `ratify` operation, the answer is paired with a question the ratchet built, and the
record it writes names the channel that actually carried it. Widening
`consent-travels-the-human-channel` to "the ratchet's own question reaches the human through
a channel that is recorded, and the answer is derived from a selected label" is an amendment
a human has to ratify, and it is flagged here rather than left for a reader to notice.

## 7. What this change removed, and one guarantee that moved

- **Removed:** the composed `/ratify <id>` message, the `inputActions` submitter the header
  action used to publish, the recorded click (`adrId`, `decision`, `at`) and the composer
  seat's auto-settle effect.
- **Moved, not lost:** the armed-click expiry (`REQUEST_TTL_MS`, 120 s). With one round trip
  there is no click waiting to be paired with a later question, so nothing can be answered
  with an answer about older text; the equivalent guarantee is now the ratchet's frozen
  content hash, exercised by the probe's `RATIFICATION_STALE` case and by
  `scripts/check-consent-surface.mjs`'s stale fixture.
- **Coverage gained:** the previous design's transport — a browser click travelling over the
  Remote to a waiting host — was measured by nothing, and the panel's own notes said so. The
  route is measured over real HTTP, against the real webserver and the real browser fence.

## 8. What is still not measured

- **The panel bundle talking to a live server in a browser.** `scripts/test-adr-panel.mjs`
  executes the shipped bundle with a stub host and asserts what it sends and renders; the
  probe drives the real route with a stub human. The wire between a real browser and this
  route is the same kind of gap ADR 0019 recorded for the composer path.
- **The capability global reaching a real page render.** The probe reads the injection table
  the renderer consumes (`collectIndexInjections`) and mints a browser session through the
  production `authorizeIndex`, but no browser was opened, so "the page actually carries the
  global" rests on the renderer, not on this measurement.
- **The signed-cookie edge cases** — expiry, authority mismatch, a cookie from another
  process — are the harness's tests, not this kit's.
