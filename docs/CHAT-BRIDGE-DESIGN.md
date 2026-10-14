# Chat bridge — driving DSH sessions from a phone

**Status:** design agreed; **increments 1–8 built and verified** — route, device pairing, session
list, transcript, live stream with the per-session `seq` watermark, the composer (`queue` / `steer`,
idempotent on `requestId`), the two answerer waterfalls with the desktop-first policy measured in
all three of its cases, the phone app (list, transcript, streaming, composer, question and approval
cards), and a UX pass adding safe Markdown rendering, follow-the-reader scrolling, a working
indicator and a working Stop control, new-task dispatch, a steer gesture, and the two core
delivery guarantees measured (multi-viewer stream sharing, and watermark resume across a restart).
Evidence in `reports/chat-bridge-m1.md` … `m8.md`.
**Packaged** in the kit's inventory with `mounted: false`, so the tarball and row exist without
arming a live-profile change. Nothing is mounted in the live profile, and no Tailscale exposure has
been made.
**Objective:** a human reads agent output, answers the agent's questions, approves its risky
actions, dispatches new tasks and steers a running turn — from a phone, without a laptop.

This file records *why* the thing is shaped the way it is and what was measured before designing
against it. It deliberately contains no implementation.

---

## 1. Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Client | **Purpose-built mobile PWA**, served by the bridge plugin itself | Full control of a phone-shaped chat UI; no third party in the loop |
| Reachability | **Tailscale**, with `tailscale serve` proxying the existing local server onto the private tailnet | Telegram is strictly blocked here; a public relay is avoidable |
| Where the bridge runs | **In-process Cordis plugin** in the `web` profile | Only an in-process plugin can join the sessions the GUI already owns |
| Who answers when both are attached | **Desktop-first**; the phone is claimed only when the desk is unattended | No duplicate prompts, no stolen answers |
| v1 surface | Chat + questions + approvals + dispatch, **no slash commands** | The UI is spatial — you are *in* a session, you do not name one |
| Stage 0 (expose the existing desktop GUI on the phone first) | **Declined** | Go straight to the bridge |

A Telegram adapter is *not* abandoned as a concept — the seam that matters (a `ChatSurface`
abstraction over "render this event" / "ask this question") keeps it available — but it is not
part of this plan. See §12.

---

## 2. What was measured (the evidence base)

Everything here was read out of the installed harness (v0.2.0-rc.2) or probed on this machine.
Paths are abbreviated: **P** = `/home/iustimov/.npm/node/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`,
**K** = `/home/iustimov/dsh-kit`, **H** = `/home/iustimov/.npm/dsh`.

### 2.1 The harness has the seams the bridge needs

| Need | Seam | Evidence |
|---|---|---|
| Read what the agent says | `ctx.on('session/event', (session, event) => …)`, or the `session/follow` stream (snapshot + durable events + live assistant chunks) | P/dsh-sdk-jsonrpc-server/lib/index.js:68; P/dsh-api-session-controller/lib/types/types.d.ts:459-527 |
| Know a turn ended | `agent/status` `running → idle` | P/dsh-agent/lib/types/runtime-types.d.ts:252; already used by K/plugins/notify/plugin-notify.mjs:293 |
| Send a message into a session | `sessionController.prompt({requestId, sessionId, mode:'queue'\|'steer', content})` | P/dsh-api-session-controller/lib/types/types.d.ts:319 |
| Create a session | `session/create` | P/dsh-api-session-controller/lib/types/types.d.ts:279 |
| Answer an agent's question | waterfall `'user-questions/request'`, `(request, next) => Promise<AskUserQuestionAnswer>` | P/dsh-user-questions/lib/types/types.d.ts:145, :32-81, :117-160 |
| Approve/refuse a risky action | waterfall `'approval/request'`, `(req, next) => Promise<ApprovalOutcome>` | P/dsh-user-approval/lib/types/types.d.ts:81, :26, :54-70 |
| List / read / search sessions | `ctx.sessionQuery`: `listSessions`, `listEvents`, `readSession`, `searchEvents`, `readTitle` | P/dsh-session-query/lib/types/index.d.ts |
| Is the desktop GUI attached? | `ctx.typertGateway.hasLiveClient()` — public | P/dsh-api-gateway/lib/types/index.d.ts:72 |
| Serve our own HTTP route | `ctx.webServer.register(...)`, fenced by the plugin | P/dsh-host-webserver/lib/types/index.d.ts; worked example K/plugins/dsh-adr-panel/index.js:107,:517-525,:756 |
| Control waterfall ordering | `ctx.on(name, fn, { prepend })` | P/cordis/lib/types/events.d.ts:88, :101-103 |

Both answerer seams are **waterfalls**: a listener returns a value to *claim* the request, or calls
`next()` to hand it downstream. That is what makes a phone a first-class answerer rather than a
notification side-channel.

### 2.2 The installed SDK cannot attach to the running GUI

`@deepseek-ai/dsh-sdk-app` offers a clean newline-delimited JSON-RPC 2.0 stdio transport
(`initialize`, `session/prompt`, `shutdown`; notifications `session.event`, `session.status`,
`subagent.started`, `subagent.finished` — P/dsh-sdk-protocol/lib/types/types.d.ts:59-117). But it
**spawns its own harness process and owns its own agents**
(P/dsh-sdk-jsonrpc-server/lib/index.js:219-228), and sessions are single-owner on disk
(`session.lock`). A second process gets a *different* set of sessions, so "chat inside the session
I already have open" rules it out.

### 2.3 Telegram is strictly blocked; the network is also flaky

Measured over repeated attempts (the project's internet spec warns that retries may be needed):

| Host | Result | Reading |
|---|---|---|
| `api.telegram.org` | **000 ×5**; TCP connects, then the TLS handshake blackholes — with **no SNI** and across other Telegram ranges (`149.154.167.51`, `91.108.56.130`) | Not SNI filtering; the address space is dropped |
| `ntfy.sh` | 200 ×5 | The only perfectly stable host tested |
| `pkgs.tailscale.com`, `login.tailscale.com` | 200 ×4-5/5 | Tailscale is installable from here |
| `trycloudflare.com` | 200 ×2/5 | Flaky — a public tunnel inherits this |
| `pkg.cloudflare.com` | **000 ×6** | `cloudflared` cannot be apt-installed |
| `developers.cloudflare.com`, `fcm.googleapis.com`, `api.push.apple.com` | reachable | Push from this box is viable |
| `cloudflare.com`, `github.com`, `example.com` | 301 / 200 / 000, varying between runs | The filter drops connections intermittently, not by a fixed list |

The box runs a Kaspersky endpoint agent (`kesl_in`/`kesl_out` interfaces), i.e. category filtering
with an additional connection-level failure mode. **Any design here must tolerate intermittent
connectivity** — the bridge already does (backoff, no blocking, bounded buffers).

### 2.4 Session storage

`H/sessions/<projectKey>/<session-uuid>/session.v3.jsonl.zstd` plus `session.lock` — JSONL,
zstd-compressed, one independent zstd frame per append (P/dsh-session-persistence-jsonl/lib/types/format.d.ts:19,:28,:97-125).
Records are `{type, seq, time, data}` with monotonic `seq`. The bridge reads through
`ctx.sessionQuery` rather than parsing this, because the frame-per-append layout makes naive
readers wrong.

### 2.5 Browser authentication, and why it does not block us

`connection.admit()` is a Host/Origin fence *then* a signed cookie; the cookie's signing secret
**is persisted** in the credentials store (`AUTH_RECORD_KEY`,
P/dsh-client-connection/lib/index.js:322-341), so an authenticated device stays logged in for the
cookie's lifetime (default 30 days). The **launch token, however, is memory-only** and is only
printed inside the startup URL (P/dsh-client-connection/lib/index.js:350-410) — so attaching a new
device to the *existing* GUI means reading that URL from the terminal or restarting once.

This is a reason to favour our own route with our own device token over piggybacking on the GUI's
session, and it is why Stage 0 was the weaker idea.

---

## 3. Shape of the solution

One plugin, one small static app, one network path. No relay, no third party.

```
        phone (PWA)                         this machine
 ┌──────────────────────┐          ┌──────────────────────────────────────────┐
 │  chat-bridge PWA     │          │  dsh web  (profile: web), 127.0.0.1:3080 │
 │  installable,        │◀────────▶│                                          │
 │  session list,       │  HTTPS   │  ┌────────────────────────────────────┐  │
 │  transcript,         │  over    │  │ @cc/dsh-chat-bridge (Cordis plugin)│  │
 │  question/approval   │  tailnet │  │  routes: /chat-bridge/*  (SSE+POST)│  │
 │  cards, composer     │          │  │  reads:  session/follow            │  │
 └──────────────────────┘          │  │  writes: sessionController.prompt  │  │
           ▲                        │  │  claims: user-questions, approval  │  │
           │                        │  └────────────────────────────────────┘  │
           │                        └──────────────────────────────────────────┘
           │                                        ▲
           └──────── tailscale serve ───────────────┘
              (TLS onto the private tailnet; the server keeps binding 127.0.0.1)
```

- The bridge adds **no tool, no prompt section and no service** to the model surface. Its only
  influence on a turn is a user message and an answer to a question — exactly what a human at the
  desk would have supplied.
- The server keeps its loopback-only bind. `tailscale serve` terminates TLS on the tailnet and
  forwards to `127.0.0.1:3080`, so nothing is exposed publicly and no inbound port is opened.

---

## 4. Reachability: Tailscale

- Install on the box (from `pkgs.tailscale.com`, which answers) and on the phone.
- `tailscale serve` exposes the local server to the tailnet with a real certificate; the phone
  reaches it from anywhere, including cellular, without a public IP or an inbound port.
- **The bridge route no longer uses the harness's fence — measured, not preferred.** That fence
  refuses any request whose `Sec-Fetch-Site` is `cross-site`
  (P/dsh-client-connection/lib/index.js:211), and a phone launching the **installed app from its own
  icon** sends exactly that. With the fence in force the installed app rendered *"forbidden"* on
  every launch — the one thing an installed app must do. The route therefore applies its own rule:
  the `Host` must be loopback or a declared `allowedHosts` entry (DNS rebinding, kept in full), and a
  `cross-site` request that is not `GET`/`HEAD` is refused (CSRF, kept for anything that changes
  state). Cross-site reads are harmless because the device cookie is `SameSite=Strict` and is not
  sent on a cross-site request. This is a deliberate, documented narrowing of a security control, and
  it is the reason the tailnet flag below is about the **Web GUI's** `/api` path rather than this
  route.

- **Launch consequence — required, not optional, and it is a FLAG, not a config row.**
  `tailscale serve` preserves the `Host` header, so a request arrives bearing the `*.ts.net`
  authority that the harness's browser-trust fence refuses. Measured through a local proxy that
  reproduces exactly that Host: **403**, and with the authority declared: **200** for the shell, the
  API and SSE. An undeclared authority is still refused, so the grant is narrow.

  The authority is declared on the **command line**, not in a patch row:

  ```sh
  dsh --profile web --trusted-host <node>.<tailnet>.ts.net
  ```

  This corrects the earlier instruction in this file. The composed profile's row is
  `id: connection` (not `client-connection`, which the loader rejects with *"patch: entry
  'client-connection' not found"*), and its `trustedHosts` is the expression
  `!!js ctx.webRuntime.trustedHosts` — so patching `config` would *replace* that expression and
  discard the LAN addresses it derives. `webRuntime.trustedHosts` is
  `[...lanAddresses, ...extra]`, and `extra` is exactly what `--trusted-host` supplies
  (P/dsh-web-app/lib/index.js:87, :173; P/dsh-web-app/lib/startup.js:46).

- **Installation is a system change on this machine and needs the operator's explicit approval**,
  separately from the network path itself. Nothing in this design assumes it has been granted.

---

## 5. The plugin

### 5.1 Home and lifecycle

A Cordis plugin mounted by one `insert` row in the `web` profile patch, following the `notify`
pattern (K/profile/cordis.patch.yml, K/plugins/notify/). Adding it touches the kit's own
machinery, and `node scripts/check-portability.mjs` is the existing enforcement point that fails
when a plugin's source, tarball, inventory row and mounted profile row disagree — the design leans
on that rather than inventing a new gate.

Mounting it into the **live** profile needs a `dsh web` restart, which would drop the session open
in the GUI at that moment. That restart is a deliberate, operator-agreed step, not something the
build assumes (see §11).

### 5.2 Read path: one stream per open session

For each session the phone is looking at, the bridge opens **one** `session/follow` stream
(`{address:{kind:'session', sessionId}, assistantStream:true}`,
P/dsh-api-session-controller/lib/types/types.d.ts:459-527). It yields, in order:

1. one `snapshot` (header, cursor, records) — catch-up after a restart or on first open,
2. durable `event` frames — `assistant/message`, `tool/call`, `tool/result`, `turn/end`,
3. optional `assistant-stream` `start`/`chunk`/`end` frames — the live typing effect.

One source for catch-up and live traffic is what makes the watermark exact: durable events carry
monotonic `seq`, so "what has the phone already seen?" is a single integer comparison and every
render is idempotent. Streams are opened lazily for sessions actually being viewed and closed on a
timeout, so a phone left on a shelf does not hold the whole harness open.

### 5.3 Write path

```
composer text            → sessionController.prompt({sessionId, mode:'queue', content:[{type:'text',text}]})
"steer" on a reply       → sessionController.prompt({sessionId, mode:'steer', content:[…]})
"New task"               → session/create, then prompt
"Stop"                   → session/cancel
```

`queue` vs `steer` is the difference between *dispatching* work and *guiding* work already in
flight; both are needed and the mode field already distinguishes them.

### 5.4 Claim policy

```
if desktopAttached()  return next()      // the desk owns it — the GUI card is already showing
if !phoneConnected()  return next()      // nobody to ask; leave the harness's fail-closed default alone
return await askPhone(request, window)   // the phone owns it, held open for `window`
```

Three properties, all of which matter:

- With the desk attended, the phone stays quiet — no duplicate prompt to reconcile.
- With **nothing** attached, the bridge delegates rather than holding the agent hostage. This is
  the important asymmetry against a naive "always claim" design: an unattended bridge must not
  turn a question into a hung turn.
- If the phone disappears mid-question, the bounded window resolves it instead of hanging.

`desktopAttached()` is `ctx.typertGateway.hasLiveClient()` — which is *false* when only our PWA is
connected, because the PWA uses its own route and never registers as a Remote event client. That
is exactly the behaviour we want, and it is why the PWA does not need to be excluded explicitly.

The listeners are defensive in the `notify` sense: they must **never throw into the turn** and must
always return a value or delegate. Approvals return the harness's own vocabulary
(`allowed-once` / `rejected` / `cancelled`); "allow" is never sticky, and the harness's
`unavailable` fail-closed floor stays underneath.

### 5.5 Transport to the PWA

**SSE down, POST up.** `GET /chat-bridge/stream` is a `text/event-stream` carrying session events,
status changes and pending questions; `POST /chat-bridge/*` carries prompts, answers and control.
SSE is chosen over a WebSocket because it is a plain HTTP response — it survives the tailnet proxy
without upgrade handling — and the host already uses SSE for plugin HMR (`/plugins/events`), so
the mechanism is proven in this deployment. Bidirectionality is not needed: there is no
server-initiated request that is not already a response to a stream the client opened.

---

## 6. The PWA

A small static app (one HTML shell, one JS module, one manifest, one service worker) served by the
plugin from its own package. Mobile-first, no framework, no build step — it must stay readable and
cheap to change.

**Layout**

- **Sessions drawer** — live and recent sessions with titles, working directory and running/idle
  state, from `sessionQuery.listSessions` plus `api-session/status`-style updates.
- **Transcript** — the durable log rendered as a chat: user turns, assistant text, a terse
  tool-call line each (`🔧 bash · npm run build`), and an explicit error block for
  `turn/end` with `reason.kind:'error'` so a broken turn is never silently quiet.
- **Question card** — inline in the transcript where the agent asked, rendered from the request the
  waterfall handed us, *not* re-derived from the transcript. The encoding is exact and small
  (P/dsh-user-questions/lib/types/types.d.ts:6-11, :32-60):

  ```ts
  Item   { id, question, detail?, header?, options?: { label, description? }[], multiSelect?, intent? }
  Answer { answers: [{ id, selected: string[], custom? }] }
  ```

  One card per item; `multiSelect` renders toggles with an explicit confirm; `custom` is free text
  offered alongside the options. A `detail` is shown but never folded into an option label, because
  the label is what the answer echoes back.
- **Plan-review cards** — an item carrying `intent: { kind:'plan-review', approve }` is a plan
  submitted for a verdict, and the approved option is **named** rather than positional
  (P/dsh-user-questions/lib/types/types.d.ts:13-29). The card renders the plan in a scrollable
  block with Accept/Decline taken from that named label — the app never guesses which option means
  "yes", and a future intent tag it does not understand degrades to the generic option list.
- **Approval card** — `Allow once` / `Reject`, with the tool name and the asker's reason, rendered
  from `ApprovalRequestEvent`.
- **Composer** — a prompt (`queue`); a long-press or a reply-to gesture issues `steer`; a stop
  control issues `session/cancel`.

**Rendering rules**

- Text is rendered as text, never as injected HTML or Markdown markup. Model output is untrusted
  input to this app exactly as it is to a terminal.
- Streaming: assistant chunks are coalesced on a ~100 ms budget and appended to the open bubble;
  the durable `assistant/message` event finalises it. The transcript is never re-rendered wholesale.
- Streams are limited by construction: the drawer holds at most `maxStreams`, the transcript one.

**Notifications (increment 2, not v1)** — Web Push is viable from here (`fcm.googleapis.com` and
`api.push.apple.com` both answer), but it needs VAPID keys and per-platform care, so v1 shows state
in the app and v2 adds push. Nothing in v1 depends on it.

**Installability** — `manifest.json` + service worker so it can be added to the home screen. On
iOS that is the only way in; there is no native option.

---

## 7. State model

Bridge state is one atomically-written file under `H/chat-bridge/` plus an append-only journal.
Nothing in it is load-bearing for the harness: deleting it costs re-pairing the device and at worst
a duplicate render, never a lost turn.

| State | Purpose |
|---|---|
| `sessions{sessionId → lastSeq}` | the render watermark per session |
| `device{tokenHash, label, createdAt}` | the paired phone; the plaintext token is never stored |
| `pending[]` | in-flight question/approval: `{kind, sessionId, callId, options, selected[], expiresAt}` |
| `journal.jsonl` | append-only `{sessionId, seq, ok}` delivery ledger |

**Delivery: at-least-once, deduped by `(sessionId, seq)`.**

- Render only `seq > lastSeq`; advance the watermark after the client acknowledges.
- A reconnect replays from the watermark, so nothing that happened while the phone was asleep is
  lost, and nothing already seen is shown twice.
- A crash between send and watermark can duplicate one bubble; the journal narrows that window and
  makes it detectable. This is stated rather than hidden — there is no exactly-once protocol here.
- Writes are tmp-file + `rename`, so a killed process cannot leave half-written state.

---

## 8. Security model

| Asset | Where it lives | Why |
|---|---|---|
| Device token | cookie on the phone; **hash only** on disk | A stolen state file cannot be replayed |
| Pairing code | printed once to the server's log/terminal | Same pattern as `notify`'s diagnosability; short-lived, single use |
| Session content | in transit over the tailnet, TLS-terminated by Tailscale | Never leaves the private network |

- **The tailnet is the network boundary.** No public URL, no inbound port, no third-party relay
  holding a credential. The phone reaches the box because both are on the same tailnet, not because
  anything was published.
- Every `/chat-bridge/*` request is authenticated by the device cookie; the routes are fenced the
  way `dsh-adr-panel` fences its own (K/plugins/dsh-adr-panel/index.js:517-525), not left to the
  GUI's cookie.
- The bridge exposes **no new tool** to the model. A message from the phone is a user message and
  nothing more — the trust level of the composer is the trust level of typing at the keyboard, with
  the same prompt-injection characteristics, no better and no worse.
- The PWA renders model output as text, never as markup, so agent output cannot become code in the
  client.
- Secrets are never logged, never written into a session and never echoed into a prompt.

---

## 9. Failure modes and limits

- **Tailscale down or phone offline** — SSE reconnects with backoff; the watermark makes the
  recovery gap-free. Nothing blocks a turn on the phone being reachable.
- **Nobody attached** — questions delegate to the harness's fail-closed default instead of hanging
  (§5.4). This is the mode that matters most: an unattended harness must behave exactly as it does
  today.
- **`dsh web` restarts** — the plugin re-registers its answerers; open question cards are marked
  resolved-by-restart rather than pretending to still be live.
- **Both answered** — first answer wins; the later one is reported as already resolved. The harness
  already discards a late answer from a still-pending answerer, so this is a UI concern only.
- **Flooding** — per-session coalescing of stream frames, a bounded per-connection buffer, and an
  explicit drop-and-resync when the buffer overflows: drop the deltas, keep the durable events,
  because the transcript is always reconstructible from `seq` and the typing effect is not
  important.
- **Intermittent network** (§2.3) — every outbound path retries with backoff and never fails a turn.

---

## 10. Configuration

```yaml
- insert:
    - id: chat-bridge
      name: '@cc/dsh-chat-bridge'
      config:
        enabled: true
        stateDir: ~/.npm/dsh/chat-bridge     # watermarks, device, journal
        maxStreams: 4                        # simultaneously followed sessions
        streamIdleMs: 900000                 # close a stream after this long with no client
        answerWindowMs: 600000               # how long the phone may hold a question open
        showToolCalls: true
        streamEdits: true
```

Environment overrides mirror `notify`'s habit so a machine can be silenced from a shell:
`DSH_CHAT_BRIDGE_DISABLED=1`.

---

## 11. How this gets built

### 11.1 Development without disturbing the live session

The plugin can only be mounted in a profile, and mounting it into the live `web` profile needs a
restart that would drop the session open in the GUI. So the build does **not** run there:

1. A **scratch home** under the system temp dir with a scratch `web` profile on its own port, as
   `scripts/probe-dsh-api.mjs` already does — restarting it freely costs nothing.
2. The PWA is verified in a **real browser** with the Playwright MCP against that scratch server:
   the product is rendered and driven, not asserted about.
3. Only when the app works is the row added to the live profile, with the operator's agreement and
   at a moment that suits them. `node scripts/check-portability.mjs` gates the packaging.

### 11.2 Milestones, with the evidence that closes each

The house rule is that verification means running the product and reading what it printed. No test
file is written for any of this; each milestone names the observable that would differ if it were
broken.

| # | Milestone | Evidence that closes it |
|---|---|---|
| 1 | Plugin loads in a scratch web profile and serves the PWA shell | `curl -i http://127.0.0.1:<port>/chat-bridge/` returns the shell; unauthenticated requests are refused; `check-portability.mjs` exits 0 with the new row |
| 2 | Session list + transcript render | Playwright: the drawer lists the scratch profile's real sessions; opening one shows text the session actually produced |
| 3 | Composer dispatches | Text typed in the browser appears as a `user/message` in that session's log (`node scripts/session/session-log.mjs <id>`) and the agent answers |
| 4 | Question answered from the phone | With no desktop client attached, `ask_user` renders a card; choosing an option completes the tool call and the turn continues. With a desktop client attached, the card does **not** appear and the GUI answers |
| 5 | Approval decided from the phone | A sandboxed command raises the card; refusing produces a refused turn, allowing produces the command's output |
| 6 | Streaming and resume | Text arrives progressively; reloading mid-turn resumes from the watermark with no duplicate and no gap |
| 7 | Phone over the tailnet | The real phone, on cellular, opens the installed PWA, reads a live turn and answers a question |

### 11.3 Unknowns, and what measuring them settled

These were cheap probes against a scratch harness — running the real code, not reading types. Each
could have invalidated a choice above. `scripts/probe-chat-bridge.mjs` ran them in-process and
recorded its own claims; the results below are its, with the claims it could NOT establish named as
such rather than quietly dropped.

**Measured, and they held:**

- **The terminal without an answerer is a VALUE, not a throw.** `{"kind":"rejected","error":…}`. That
  matters because a throw and a value are handled differently in `AskBroker`: a rejection can be
  forwarded to the phone as a refusal, whereas an exception would have to be caught and turned into
  one.
- **`hasLiveClient()` is faithful in both directions.** False on a freshly booted harness with no
  client; it flips **true** when a client opens the gateway's `$events` stream, and flips back to
  **false** when that stream is aborted. The desktop-first claim rests on this signal, so a value
  that stayed true after a window closed would have made the bridge stand down forever.
- **`session/follow` opens in-process with no Remote carrier**, and its first frame is a `snapshot`
  before any live frame — which is what makes the replay/watermark design sound rather than
  hopeful. Over one run it delivered 141 durable event frames plus 18 `assistant-stream` starts.
- **`sessionController.create`, `prompt` and `prompt` with `mode:'steer'` are all accepted
  in-process**, and the model answered a prompt injected with no SDK stdio transport.
- **The `ask_user_question` request shape is captured in full** at the
  `user-questions/request` waterfall.

**Claimed but NOT established, and left open on purpose:**

- Driving an approval-requiring tool call to completion from a claimed answerer — the model never
  retried with `sandbox_permissions`, so `approval/request` was never reached (the same gap as
  `allowed-once` in the milestone reports).
- Completing a real `ask_user_question` tool call end to end from a claimed answer.
- Whether iterating `session/follow` blocks other plugin work; the check as written did not
  separate the two, so it proves nothing either way.

The first two are exercised by hand against a live turn rather than by the probe; the third is
unresolved and is not claimed anywhere.

The original unknowns, for the record:

1. **Answer shapes and the terminal `next()`** — the exact `AskUserQuestionItem` /
   `AskUserQuestionAnswer` and whether a no-answerer terminal yields a value or throws
   (P/dsh-user-questions/lib/types/types.d.ts:32-81, :117-160; P/dsh-user-approval/lib/types/types.d.ts:26, :54-110).
2. **In-process `session/follow`** — whether a plugin can open it with no Remote carrier, and its
   exact signature (P/dsh-api-session-controller/lib/types/index.d.ts:196).
3. **~~Route registration~~ — resolved from source.** `ctx.webServer.register({kind, path, handler})`
   returns a disposer; the handler owns the full response lifecycle, which is what makes an SSE
   route legal here (P/dsh-host-webserver/lib/types/index.d.ts:36-45, :77-84). Routes mounted this
   way are **not** behind the `/api` fence — that prefix is itself a route registered by
   `dsh-client-connection` — so the plugin fences itself. It must, because `requestRejection`
   reintroduces the Host check that §4 now accounts for. Proven pattern:
   K/plugins/dsh-adr-panel/index.js:756-782.
4. **`hasLiveClient()` fidelity** — whether it is true only for a GUI that can actually answer, and
   how quickly it flips on disconnect (P/dsh-api-gateway/lib/types/index.d.ts:72).

`K/scripts/probe-sdk-roundtrip.mjs` is the precedent for how to do this: a scratch `DSH_HOME`, a
scratch profile, and evidence read out of what the harness did rather than out of the model's prose.

---

## 12. Alternatives rejected

| Alternative | Why not |
|---|---|
| Telegram, directly | Strictly blocked: TLS to its ranges blackholes even with no SNI (§2.3) |
| Telegram via a Cloudflare Worker relay | The agreed fallback if a PWA proves unacceptable. Rejected as the plan because it adds a public relay, moves the bot token off the machine, and depends on Cloudflare edge reachability that measured 2/5 from here — for a UI we would still have to build |
| A public tunnel to the existing GUI (Stage 0) | Exposes the full-power desktop UI; the launch token is memory-only, so a new device needs a restart anyway (§2.5) |
| Native Android app | Best background reliability, but a whole client to build, maintain and sideload — and it locks out the second phone. Revisit only if the PWA proves insufficient |
| `ntfy` as the transport | Rock-solid host and real push, but notification-shaped: session multiplexing and free-text replies are awkward. Worth keeping as the *notification* half if v2 push gets fiddly |
| Separate process over the SDK stdio transport | Owns a different agent set; cannot join the GUI's sessions (§2.2) |
| An MCP server | The harness ships an MCP **client** bridge only; and MCP is the wrong shape for "a human is answering" |
| Watching the `.jsonl.zstd` files | Frame-per-append zstd makes naive readers wrong, and `ctx.sessionQuery` already exposes the same data correctly (§2.4) |

---

## 13. What this design does not cover

- **Attachments** — sending or receiving files and images is a later increment.
- **Multi-user** — one paired device. The schema allows a list, but nothing about shared sessions is
  designed here.
- **Transcript search** — `sessionQuery.searchEvents` exists and would be easy; it needs its own UI
  and is not in v1.
- **The Telegram adapter** — the `ChatSurface` seam keeps it possible; no code is planned for it.
