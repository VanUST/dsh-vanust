# @cc/dsh-session-budget

A deterministic handoff reminder: count the steps of the current session, and at 300, 400
and 500 steps put one fixed message in front of the agent and one popup in front of the
human. No model call, no daemon, no exception in the turn.

The point is timing. A long session is not a failure — it is expensive: every step re-sends
the derived history, and compaction then re-bills the prefix. The cheap moment to write a
handoff note (what is done, what is left, the proof, the next step) is *before* the context
is unaffordable, not after.

```
Step 300: [soft]  write the handoff note now, while the context is still affordable
Step 400: [soft]  the same reminder, second threshold
Step 500: [hard]  stop starting new work; write the note, end the turn, start a new session
```

Each threshold fires once per session. The reminder is a `user/message` surface event whose
text ends with a marker line:

```
[session-budget soft 300]
```

## Where the text enters the model context

`agent/pre-step` is the waterfall the agent loop runs **before** it appends `step/start` and
derives the request (`dsh-agent-loop/lib/index.js:907-936`; `docs/agent-lifecycle.md` in the
0.2.1-rc.2 source). The loop then calls `session.deriveMessages()` (`buildRequest`,
`dsh-agent-loop/lib/index.js:1214-1290`), so a `user/message` appended during that waterfall
is in the same request the step sends.

That is not an inferred seam: `@deepseek-ai/dsh-compaction-basic` delivers its compaction
checkpoint the same way — `ctx.on('agent/pre-step', ...)` at
`dsh-compaction-basic/lib/index.js:839`, and the
`session.append('user/message', checkpointMessage, {surfaceOp: {...}})` at `:650`. The
listener here mirrors it (`session.append('user/message', message, {surfaceOp: 'append'})`).

## Why the counter survives compaction

The count never reads the surface. It is a `sessionProjections` unit (`ctx.sessionProjections`,
mounted by `@deepseek-ai/dsh-base`, `cordis.patch.yml:172`) that folds the **append-only
event log**:

- `step/end` events count completed steps — one per entered step, appended by the loop in a
  `finally`, so completed, failed, cancelled and max-token steps each count once (the same
  authority `@deepseek-ai/dsh-session-stats` documents);
- the marker text in the plugin's own `user/message` events records which thresholds fired.

A compaction appends `compaction/summary` plus a replacement `user/message` whose
`surfaceOp` is `{op:'replace', startSeq, endSeq}`. It shadows surface nodes; it **deletes no
events**. The projection folds the whole log, so both the step count and the fired set are
unchanged — verified by `proof/proof.mjs`, which performs a real replacement on a real
`Session` and shows the count and the marks still there while `deriveMessages()` no longer
contains the shadowed reminder.

The mark lives in the message **text** on purpose: the persisted v4 row of a
`user/message` keeps its content, not its producer source, so a source-based mark would not
survive a reload.

## Configuration

| key | default | meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` registers nothing. |
| `thresholds` | `[300, 400, 500]` | ascending step counts; the last is **hard**, earlier ones **soft**. |
| `notify` | `true` | raise a desktop notification when a reminder fires. |
| `notifyChildren` | `false` | also notify for delegated child sessions (the reminder still reaches the child). |
| `notifyStyle` | notifier default | `overlay` or `daemon`, forwarded to `notificationCommand`. |

`@cc/dsh-notify/core` is imported lazily, once, when the first reminder fires:
`@cc/dsh-notify` is a peer of this package, so a profile without it loses the popup (logged
once) and never the reminder. The specifier is a literal, because the kit's portability gate
rejects `import(<variable>)` — a real Windows bug when the variable holds a filesystem path.

## The notification

`@cc/dsh-notify/core`'s `notificationCommand({title, body, style})` returns
`{command, args, env}`. The plugin spawns it `detached`, `stdio:'ignore'`, with the command's
`env` merged over the process environment, consumes the child's `error` event (an unhandled
one on a detached child would crash the process) and calls `unref()`. The turn never waits
for it.

## Failure containment

`apply()` never throws. The pre-step listener catches everything — projection state, message
construction, append, notification — logs **once per failure kind** and always calls
`next()`. A broken projection or a failing append therefore costs a reminder, never a turn.

## Proof

```
node plugins/session-budget/proof/proof.mjs
```

It drives the real plugin (`apply`, the real projection fold, a real `Session`) through 299,
300, 400 and 500 steps, repeats 500, then compacts the surface and checks the count and the
marks again. It also proves the notification is built by the real `notificationCommand` and
spawned detached, and that a broken projection/append/notifier is logged instead of thrown.
Exit code 0 is the pass; the table names each scenario.
