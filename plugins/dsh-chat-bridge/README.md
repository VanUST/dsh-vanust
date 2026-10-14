# @cc/dsh-chat-bridge — an installable phone client for DSH sessions

A Cordis host plugin that serves one capability-fenced HTTP route, `/chat-bridge`, carrying a
mobile PWA. It exists so a human can read agent output, answer the agent's questions, approve its
risky actions, dispatch new tasks and steer a running turn from a phone.

It adds **no tool, no prompt section and no service** to the model's surface. Its only influence on
a turn is a user message and an answer to a question — exactly what a human at the desk would have
supplied.

## Why a route of its own, rather than the Web GUI

The Web GUI authenticates a browser with a **launch token that lives only in the server process's
memory**. Enrolling a second device therefore means reading the startup URL from a terminal or
restarting the server. This plugin instead mints its own device cookie from a persisted secret, so
a phone can be enrolled at any time without disturbing a running session.

## Routes

All routes are under `/chat-bridge`. Except for the pairing page and `POST /pair`, every route
requires a device cookie.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Pairing page when unpaired (self-contained, no external assets); the app shell when paired |
| `POST` | `/pair` | Exchange a one-time pairing code for a device cookie |
| `GET` | `/api/whoami` | Which device this cookie speaks for |
| `GET` | `/api/sessions` | Session list: id, title, working directory, timestamps, live and subagent flags |
| `GET` | `/api/transcript?sessionId=&limit=` | The tail of one session's log as render items |
| `GET` | `/api/stream?sessionId=&after=` | Server-Sent Events: the opening frame, the live turns, and token-level assistant deltas |
| `POST` | `/api/new` | Start a session: `{text?, cwd?, requestId?}` → `{sessionId, prompted}` |
| `POST` | `/api/prompt` | Send a user turn: `{sessionId, text, mode?: 'queue'\|'steer', requestId?}` |
| `POST` | `/api/cancel` | Stop the turn a session is running: `{sessionId}` |
| `POST` | `/api/answer` | Answer a pending question: `{pendingId, answers: [{id, selected[], custom?}]}` |
| `POST` | `/api/approval` | Decide a pending approval: `{pendingId, outcome: 'allowed-once'\|'rejected'}` |
| `GET` | `/app.js`, `/markdown.js`, `/app.css`, `/manifest.webmanifest`, `/sw.js`, `/icon.svg` | Static app assets |

Assets are served from a **fixed map of known names**, so a request cannot name a file and path
traversal is not a category of bug here.

### Questions and approvals

The bridge claims the harness's two answerer waterfalls — `user-questions/request` and
`approval/request` — so an agent's question or a sandbox-escalation request reaches the phone and
its answer returns into the running turn.

**The policy is desktop-first, and it has three cases:**

| Desktop attached | Phone watching | Behaviour |
|---|---|---|
| yes | — | the bridge **stands down** (`next()`); the GUI shows the card, the phone stays quiet |
| no | yes | the bridge **claims** it, pushes it to the phone, and returns the human's decision |
| no | no | the bridge **delegates** — the harness behaves exactly as it would with no bridge installed |

That third case is the one worth being deliberate about. A bridge that claimed a question with
nobody to answer it would convert a fail-closed default into a hung turn, which is strictly worse
than the default.

Details that matter:

- **The request's own signal is the deadline, not this plugin's window.** The timed
  `ask_user_question` tool waits 120 s by default and then returns a *pending* notice; a bridge
  holding the request past that is answering a question the harness has stopped asking. When the
  signal aborts, the request resolves as unanswered immediately.
- **Answers are validated against the questions actually asked.** The harness does not do this: an
  answer whose `id` matches no question is passed straight into the tool result (measured). The
  bridge refuses an unknown id, an unoffered label, and more selections than a single-select
  question allows — and leaves the request open so a corrected answer still works.
- **`unavailable` is not a human decision.** The phone may send `allowed-once` or `rejected`, never
  the harness's own fail-closed value.
- **Neither listener can throw into a turn.** Both wrap their work and fall back to `next()`.

### The composer

`queue` adds a turn to the agent's inbox; `steer` redirects the turn that is running **right now**.
That is the difference between dispatching work and guiding it.

The app uses one composer for both halves of that:

- **On the session list**, the composer **starts a new session** (`POST /api/new`) and opens it. That
  is dispatch: the only way to begin work that does not exist yet.
- **Inside a session**, it messages that session (`queue`).
- **While a turn is running**, a **Steer** button appears beside Send. Two buttons rather than a
  hidden mode, because sending mid-turn is genuinely ambiguous — "and then also…" versus "no, do
  this instead" — and a mode the human forgot they set is worse than one extra tap.

`POST /api/prompt` is **idempotent on `requestId`**, and a client should send its own: the harness
returns `{accepted:true}` for a request id it has already admitted without enqueuing a second turn
(`hasPromptRequest`, dsh-api-session-controller/lib/index.js:855). On a network that drops
connections, a phone that loses the response can simply retry the same id.

One sharp edge worth knowing: the service's `prompt` takes `(request, signal)` and dereferences
the signal **unconditionally** at its first statement. Omitting the second argument is a
`TypeError` reading `throwIfAborted` of undefined, not a readable error. The signal is checked once,
at entry, so the bridge ties it to the client's connection — a phone that gave up before the turn
was admitted should not have it enqueued.

### The stream

`/api/stream` is `text/event-stream`. Every frame is `event: item` with a JSON body whose `kind`
is one of `open`, `user`, `answer`, `assistant`, `tool`, `result`, `turn-end`, `assistant-stream`,
`gap` or `error`. A first frame `event: ready` reports the session, the requested watermark and the
**durable address** that was resolved for it.

Two properties make the phone's reconnect honest:

- Every durable item carries the harness's monotonic `seq`. A client sends the highest `seq` it
  holds as `?after=`, and the bridge suppresses anything at or below it — so a phone that slept
  through a turn gets exactly the gap, and a phone that did not gets no repeat.
- A viewer joining a stream that is **already open** is caught up from a bounded replay buffer. If
  its watermark is older than the buffer, the bridge sends `kind:'gap'` rather than a transcript
  with a silent hole in it, and the client reloads the transcript.

Delivery is **at-least-once**. There is no exactly-once protocol here, and a crash between
publishing and the client's acknowledgement can duplicate one bubble.

### Session addresses

A top-level session is followed as `{kind:'session', sessionId}`. A **subagent child** is not:
the harness refuses that shape with *"subagent Sessions require their durable parent address"*, so
the bridge resolves the header and sends `{kind:'subagent', parentSessionId, childSessionId,
mode:'unknown'}` instead. The discriminator is `header.origin === 'subagent'` — not the mere
presence of a parent, and not the field name it looks like. `mode` is `'unknown'` because the
header does not record whether the child was one-shot or continuable, and the protocol's own
vocabulary admits exactly that uncertainty.

## Configuration

```yaml
- insert:
    - id: chat-bridge
      name: '@cc/dsh-chat-bridge'
      config:
        enabled: true
        stateDir: ~/.npm/dsh/chat-bridge   # secret, devices, pairing code
        pairWindowMs: 900000               # how long a pairing code stays valid
        cookieDays: 30                     # how long a paired device stays paired
        sessionLimit: 50                   # largest session list returned
        maxStreams: 4                      # sessions followed at once
        streamIdleMs: 900000               # close a viewerless stream after this long
        historyLimit: 500                  # render items replayed to a late viewer
        answerWindowMs: 600000             # safety net; the request's own signal is the real deadline
```

`cwd` is the only placement control `POST /api/new` offers. `workspaceId` is deliberately not
exposed: a workspace id names a host-side registry entry that a phone has no way to discover, so
offering it would be a field the client can only get wrong.

`DSH_CHAT_BRIDGE_DISABLED=1` disables it without editing the profile.

## State, and what it is worth

Everything lives in `stateDir`, mode 0600:

| File | Contents |
|---|---|
| `secret` | 32-byte HMAC key that signs device cookies. Never leaves the machine |
| `devices.json` | Paired devices: id, label, creation time. **No token is stored** — a device cookie is a signed assertion, so a stolen state file cannot be replayed as a device, and deleting a row revokes it |
| `pairing.json` | The open one-time code, written for the operator. Removed the moment it is spent or once a device exists, so the file never shows a code that no longer works |

A corrupt `devices.json` reads as "no paired devices" rather than crashing. A `secret` shorter than
32 bytes **throws** rather than being regenerated: regenerating would silently un-pair every device.

## Pairing

1. On activation with no paired device, the bridge logs a six-digit code and writes `pairing.json`.
2. Open `/chat-bridge/` on the phone and enter the code — or open `/chat-bridge/?code=<code>`, which
   fills it in and submits, so nothing is typed on a phone keyboard.
3. The code is spent on first use; no open code exists while any device is paired.

## Reaching it from a phone

### Over the USB cable (one command, nothing exposed)

```sh
make connect-usb-device            # PORT=3080 by default; OPEN=1 also tries to launch it
```

This runs `adb reverse tcp:<port> tcp:<port>`, which asks the **phone** to forward a port over the
cable to the same port on this machine. The phone's browser then reaches this machine's loopback
interface, so:

- the trust fence sees `Host: 127.0.0.1:<port>` and already trusts it — no `--trusted-host` needed;
- nothing is exposed to any network, and the tunnel exists only while the cable is attached.

### The route applies its own trust rule, and why

This route does **not** use the harness's `requestRejection`. That fence refuses any request whose
`Sec-Fetch-Site` is `cross-site` (`dsh-client-connection/lib/index.js:211`), and a phone launching
the **installed app from its own icon** — or tapping a link to it — sends exactly that. Measured on
the same server and the same loopback Host: `cross-site` → **403**, `none` → **200**. With the
harness's rule in force the installed app showed *"forbidden"* every time it was opened, which is
the one thing an installed app must do.

So the rule is narrowed to what each half of it is for:

| Concern | Kept? | How |
|---|---|---|
| DNS rebinding | **yes, in full** | the `Host` must be loopback or a hostname declared in `allowedHosts` |
| Cross-site request forgery | **yes, for anything but a read** | a `cross-site` request that is not `GET`/`HEAD` is refused |

A navigation is a read, so opening the app is allowed; a `POST` from another site is not. Cross-site
reads lose nothing, because the device cookie is `SameSite=Strict` and is *not sent* on a cross-site
request — so such a read arrives unauthenticated and gets the pairing page.

`OPEN=1` still warns rather than promises: a launch from an app opens a browser tab, which is not
the installed app.

### As an icon, like any other app

Once the page is open in the browser, use its menu to **Add to Home screen** / **Install app**. The
manifest and the icons are deliberately served **without** a device cookie — a browser reads the
manifest to decide whether the app is installable, and it does that before any pairing exists, so
serving them 401 would mean the install affordance never appears. `app.js` and the rest of the app
stay behind the cookie.

Installed, the flow is: plug in → `make connect-usb-device` → tap the icon.

A WebAPK keeps its **own cookie store**, separate from the browser's tabs. The installed app
therefore shows the pairing page once, on its own screen, and pairs from there; after that the icon
opens straight into the session list. Verified: launched from its own activity the app renders with
**no address bar, no tabs and no browser menu**.

When the browser announces that the app is installable, the app shows an **Install** button itself,
because hunting for "Add to Home screen" in a browser menu is the part people do not do. Android
offers no supported way to create that icon from outside the browser — `cmd shortcut` has no create
command on the device this was built against — so the tap is the platform's, not the app's; the app
just puts it in the right place at the right moment. Installed, it runs standalone: no address bar
and no browser menu, which is the whole point of installing it.

### Several computers

The app keeps a set of the computers this phone has talked to and shows them as chips above the
session list, with the current one marked. Tapping a chip goes to that machine.

`localStorage` is per-origin and every machine is a different origin, so the set cannot simply be
stored in one place. Instead it is **carried in the URL** when you move between machines: whichever
machine you arrive at learns every machine you already knew, and passes the merged set on. That
needs no configuration on any machine and no cross-origin request — a chip is a link, not a fetch,
because reading another machine's sessions would require that machine to allow it and none does.

**This becomes useful once machines are reachable at the same time.** Over USB only the attached
machine's port is forwarded, so the chips mostly save you typing a URL; over a tailnet every machine
is reachable at once and the chips are a real switcher.

**With the cable out**, the icon still opens: the service worker serves the shell, the app shows the
last session list it saw and labels the connection `offline`, and the message names the actual fix
rather than reporting a failed fetch — because over USB an unreachable harness almost always means
the cable, not the harness.

`make connect-usb-device` also reads the open pairing code and prints a link that carries it, so the
first pairing needs no digits typed on a phone keyboard:

```
  pairing code: 201767 (expires in ~15 min)
  pair in ONE step (no digits typed): http://127.0.0.1:3099/chat-bridge/?code=201767
```

The code is single-use and short-lived — the same secret the human would have typed — and the page
removes it from the address bar on arrival, so it does not linger in history or in a bookmark.

### Over a private tailnet (no cable)

The route is reached over a private tailnet rather than the public internet:

```sh
tailscale serve --bg 443 http://127.0.0.1:3080
```

`tailscale serve` preserves the `Host` header, so the request arrives bearing the `*.ts.net`
authority and the harness's browser-trust fence refuses it — **403**, measured through a local proxy
that reproduces that Host. Declare the authority on the command line:

```sh
dsh --profile web --trusted-host <node>.<tailnet>.ts.net
```

It is a **flag, not a config row**: the composed row is `id: connection`, and its `trustedHosts` is
the expression `!!js ctx.webRuntime.trustedHosts`, which a patch would replace rather than extend.
`webRuntime.trustedHosts` is `[...lanAddresses, ...extra]`, and `--trusted-host` is `extra`. Measured
after declaring it: 200 for the shell, the API and SSE through the same proxy, while an undeclared
authority still gets 403.

Note on that fence: `connection.requestRejection(req)` returns **403** when the Host/Origin fence
refuses, and **401** when the request merely lacks a *Web-GUI* browser cookie. Only the 403 is a
refusal for this route — a phone carries a device cookie and never a GUI session, so 401 is
expected and ignored.

## Security posture

- The plaintext device token is never written to disk; the cookie is a signed assertion and the
  device list is the revocation list.
- The cookie is `HttpOnly`, `SameSite=Strict`, scoped to `/chat-bridge`, and `Secure` when the
  request arrived over HTTPS.
- Model output is rendered as **text**, never as markup, so agent output cannot become code in the
  client.
- The pairing code is compared in constant time, is single-use and expires.

## Developing it

The plugin can only be mounted in a profile, and mounting it into a live profile needs a restart
that drops whatever session is open in the GUI. Development therefore runs against a scratch
profile on its own port:

```
probes/chat-bridge/scratch/home/          # scratch DSH_HOME (gitignored)
  cordis.patch.yml                        # mounts this plugin by absolute file: URL
  profiles/dev/package.json               # bundles: dsh-base + dsh-web-app
```

Mount by an absolute `file:` URL naming the **entry file**: the directory form fails with
`ERR_UNSUPPORTED_DIR_IMPORT` (observed on 0.2.0-rc.2).

The plugin has **no dependencies** — node builtins only — so it mounts in a scratch home without
`node_modules`, exactly like `@cc/dsh-notify`. Nothing here may import `schemastery` or any other
harness package without a resolution story.

## The app

One HTML shell, one JS module, one stylesheet, no framework and no build step — the file the host
serves is the file a human edits. It renders the session list, opens a session's transcript and
follows it live, sends what you type, and puts questions and approvals in a card above the composer
so a decision the turn is blocked on cannot scroll away.

Three rules shape it:

- **Model output is data.** The agent's Markdown is rendered, but by `web/markdown.js`, which
  tokenises the text and *constructs* DOM nodes — nothing is ever parsed as HTML. A link is only
  given an `href` for `http:`/`https:`, so `javascript:` and `data:` targets render as literal
  text. Your own typed messages stay literal: reformatting a human's own words back at them is
  surprising.
- **Nothing is re-rendered wholesale.** Items are appended as they arrive, keyed by the harness's
  monotonic `seq`, so a reconnect cannot duplicate what is on screen.
- **Following is a choice, not a policy.** New output scrolls only when you were already at the
  end; otherwise a *Latest* button appears, because a chat that yanks you away from what you are
  reading is worse than one that is slightly behind.

A turn in flight shows an *agent working* indicator and a **Stop** control
(`POST /api/cancel`, whose `aborted` turn-end is rendered as a visible *Stopped* marker rather than
as an error — you asked for it).

## What is not implemented yet

- **The Markdown subset is small on purpose:** headings, bold, italic, inline code, fenced blocks
  with a copy button, lists, blockquotes, rules and links. Tables and nested emphasis degrade to
  literal text rather than half-rendering.
- Reaching the app from a phone over Tailscale, and packaging this plugin into the kit's inventory
  (which changes the live profile and has not been done).
