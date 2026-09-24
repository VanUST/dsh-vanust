# Harness compaction on high context load: a measured review

How this deployment condenses a conversation approaching the model's context limit, what
actually happened in a long real session, and the one defect that explains it. Every claim
is measured — from the harness code installed here, or from this deployment's own session
log — not inferred from documentation.

**Headline:** the automatic pressure trigger can never fire before the provider rejects the
request. It sits 7,424 tokens *above* the highest input the provider will accept, so
pressure is unreachable by construction. All six compactions this session performed were
overflow recoveries, not the designed trigger.

## 1. How it works

Four packages, all mounted by `dsh-base` and therefore live in this deployment:

| Package | Role |
|---|---|
| `dsh-token-meter` | the single measurement that decides when to condense |
| `dsh-compaction` | the contract: three operations, a log-recorded bracket, tool-pairing boundaries |
| `dsh-compaction-basic` | the shipped backend: pressure trigger, overflow recovery, summarizer |
| `dsh-compaction-tool-result-pruner` | trims oversized tool results first (`thresholdChars: 8192`, `headChars: 4096`, `tailChars: 1024`) |

Paths below are relative to
`…/@deepseek-ai/dsh/node_modules/@deepseek-ai/`; `basic/…` is `dsh-compaction-basic/lib/index.js`,
`meter/…` is `dsh-token-meter/lib/index.js`.

- An `agent/pre-step` listener calls `meter.measure(agent.session)` and compares it to a
  threshold (`basic:798`, `basic:800`, compare at `basic:900`).
- `measure` prices the **last routed request's envelope plus the surface delta accumulated
  since it** (`meter:664`, `meter:682`), so the previous step's tool results *are* visible
  to the trigger. (I hypothesised a stale-envelope defect first; the code refutes it.)
- On pressure, the pruner runs, then the oldest tool-pairing-balanced span is replaced by
  one `user/message` carrying `<compacted-summary>`, bracketed by log-only
  `compaction/start` / `compaction/summary` / `compaction/end` events.
- A provider-classified `CONTEXT_WINDOW_EXCEEDED` bypasses the threshold and attempts one
  maximal balanced head reduction (`retainTokens = 0`, `basic:891`), then retries.
- The tail is priced newest-first until the retain budget is met (`basic:401-405`), then
  walked back to the nearest balanced cut (`basic:407-410`).
- `resolveCompactSpec` derives both budgets from the routed window (`basic:108-113`):

```js
const thresholdTokens = Math.floor(contextWindow * policy.thresholdRatio);   // basic:111
const retainTokens = policy.retainTokens === void 0
  ? Math.floor(contextWindow * policy.retainRatio) : policy.retainTokens;    // basic:112
if (retainTokens >= thresholdTokens) throw new TargetPressureConfigError(…); // basic:113
```

Defaults are `thresholdRatio: 0.8`, `retainRatio: 0.16`, overridable per model. This
deployment does not override them.

**The semantic mismatch underneath the defect.** `dsh-llm/lib/types/types.d.ts:292` documents
the field compaction consumes as *"Maximum combined request and response context in tokens."*
A combined figure is not a prompt budget, but `resolveCompactSpec` treats it as one: the
adapter supplies it unmodified (`dsh-llm-deepseek/lib/index.js:1580,1588`) while separately
reserving the response with `maxTokens: 256e3` (`:1998`, default at `:1394`). Nothing
subtracts the reservation.

## 2. What this deployment declares, and what the provider enforces

| Quantity | Value | Source |
|---|---|---|
| Declared context window | **1,000,000** | `dsh-llm-deepseek/lib/index.js:1392` (`DEFAULT_CONTEXT_WINDOW = 1e6`), restated in `profile/cordis.patch.yml` |
| Completion reservation | **256,000** | `dsh-llm-deepseek/lib/index.js:1394` (`DEFAULT_MAX_TOKENS = 256e3`), sent as the request's `maxTokens` |
| Provider hard limit | **1,048,576** | the provider's own rejection text, §3 |
| Compaction threshold | **800,000** | `Math.floor(1,000,000 × 0.8)` |

The provider counts **`messages + completion`** against its limit. With a 256,000-token
completion reservation the highest input that can ever be accepted is
`1,048,576 − 256,000 = 792,576`. So:

```
threshold 800,000  −  feasible ceiling 792,576  =  +7,424
```

A request at the trigger needs `800,000 + 256,000 = 1,056,000`, which is rejected. Waiting
cannot fix this; the trigger point is infeasible.

`resolveCompactSpec` receives only `(policy, contextWindow)` (`basic:111`), and the context
comes from `resolveModelInfo` (`basic:895`). The request's `maxTokens` appears in the
package in exactly one place — the summarizer's own output cap (`basic:297`) — and never in
the pressure decision. A grep across all four packages finds no completion reservation in
any comparison.

## 3. The measurement

This deployment's session log for the session that produced this review
(`$DSH_HOME/sessions/--home-iustimov-dsh-kit--/session-8610654b-…/session.v3.jsonl.zstd`)
records **6 compactions** and **55 prunes**.

| Turn | Last successful request | Provider's message count at rejection | Requested total | `requested − messages` |
|---|---|---|---|---|
| 28 | 798,881 | 796,942 | 1,052,942 | **256,000** |
| 39 | 794,802 | 792,915 | 1,048,915 | **256,000** |
| 55 | 793,058 | 794,988 | 1,050,988 | **256,000** |
| 78 | 791,199 | 796,028 | 1,052,028 | **256,000** |
| 100 | 795,989 | 792,732 | 1,048,732 | **256,000** |
| 126 | 797,723 | 793,731 | 1,049,731 | **256,000** |

Every compaction followed a provider rejection by 34–202 ms. The provider's own text:

```
This model's maximum context length is 1048576 tokens.
However, you requested 1052942 tokens (796942 in the messages, 256000 in the completion)
```

Three conclusions follow directly:

1. **`requested − messages` is exactly 256,000 in all six cases.** The failure is fully
   explained by the completion reservation, so **no token-meter error is needed to account
   for it** — the `CHARS_PER_TOKEN = 4` heuristic, which I suspected first and which the
   README itself flags for CJK and JSON, is *not* implicated. The meter is accurate and
   compaction under-triggers.
2. **The conversation sat 1,199–8,801 tokens below the 800,000 trigger** at each last
   successful request. The trigger was not skipped; it was unreachable.
3. **6/6 were overflow recoveries.** No `/compact` was ever run (only `ratify` and
   `permission` commands), and all six brackets carry a numeric `turn`, which is the
   automatic path — manual compaction stamps `turn: null` (`basic:944`).

Cost in tokens rather than currency: the six summarizer calls replayed 756,099–787,633
tokens each (~4.6M total), of which only 791,168 were cache-read; the other ~3.8M were fresh
input. Each also paid a rejected request of ~1.05M tokens and an unusable round trip.

## 4. Findings

**R1 — HIGH — the trigger is above the feasible ceiling.** §2. Code path: `basic:111` →
`basic:900`. Wrong outcome: the request overflows and enters the `agent/request-error` path
(`basic:820-846`) before `totalTokens` ever reaches the threshold, so automatic pressure
never fires. This is the 6/6 observation above.

**R2 — HIGH — `/compact` reports every failure as `busy`.** `compactNow` re-catches its own
classified error and replaces it (`basic:961-969`), so the `summary` / `changed` / `commit`
codes produced by `throwManualFailure` (`basic:507-511`) and `compactSurfaceRegion`
(`basic:501`, `basic:508-510`) never reach the caller. The user sees *"Compaction is
unavailable because this process has an active compaction, or the agent is not idle."*
(`dsh-command-compact/lib/index.js:19-22`) for a summarization failure, and the specific
handlers at `dsh-command-compact/lib/index.js:31-42` are dead code. An `agentSignal`-only
cancellation is mislabelled the same way.

**R3 — LOW — a ratio retention that passes at load can throw at first use.** `basic:135`
compares ratios only, but `basic:111-113` floors them: `contextWindow=3, thresholdRatio=0.8,
retainRatio=0.7` gives `thresholdTokens=2` and `retainTokens=2`, and the first routed use
throws `TargetPressureConfigError`. Only tiny windows, hence LOW.

**R4 — MEDIUM — a compaction that landed can still be reported as a failure.**
`basic:907-919`: if a later retry iteration finds no range while a previous one succeeded,
the loop breaks (`:913`) and then throws *"compaction still above threshold…"* (`:919`),
turning a landed surface replacement into a logged error. The branch carries
`/* v8 ignore else */` and I could not name a session state that reaches it, so this is
reported as a code-path defect rather than a measured one.

**R5 — observability — the trigger's reason is not recorded.** `compaction/start` carries
only `{ compactionId, turn }`. Distinguishing pressure from overflow from manual required
the forensic reconstruction in §3; a `trigger` field would make it a glance.

**R6 — pruning cannot prevent the crossing it would help with.** The pruner runs only after a
condensation trigger qualifies, so oversized tool results accumulate until pressure — which
per §2 is too late. It freed ~154K tokens across 55 prunes here, all after a trigger.

**Honesty gap.** The seam's JSDoc promises a taxonomy the backend collapses:
`dsh-compaction/lib/types/index.d.ts:105-107` documents `compactNow` as throwing for
*"busy, agent-cancellation, changed-span, summarization/shrink, commit-stage, or persistence
failures"*, while `basic:967-969` delivers `busy` for all of them (R2). Separately, the
backend's README documents first-use failure only for an *absolute* `retainTokens` budget
(`README.md:77`); a *ratio* retention can fail the same way by floor equality (R3).

## 5. Mitigations

### M1 — align the completion reservation with reality (deployment config, immediate)

Set an explicit `maxTokens` for the routed model in `profile/cordis.patch.yml` under
`llm-deepseek.config.models`. Observed outputs here were 3,169–5,877 tokens with reasoning up
to 5,238; a 256,000-token reservation buys nothing and costs 256,000 tokens of input ceiling.

| `maxTokens` | Feasible ceiling | Margin below the 800,000 trigger |
|---|---|---|
| 256,000 (today) | 792,576 | **−7,424 (infeasible)** |
| 64,000 | 984,576 | +184,576 |
| 32,000 | 1,016,576 | +216,576 |

This removes the defect rather than dodging it, and needs no upstream fix.

### M2 — put the trigger below the ceiling (deployment config, immediate)

Lower `thresholdRatio` for the routed model.

- Keeping `maxTokens: 256000` (ceiling 792,576): `thresholdRatio: 0.72` → 720,000, margin
  72,576.
- With M1 at `maxTokens: 32000` (ceiling 1,016,576): the default 0.8 → 800,000 clears it by
  216,576, and no ratio change is needed.

### M3 — correct the declared window, with the ratio (deployment config)

`request/context` records `contextWindow: 1000000` while the provider enforces 1,048,576. If
the declared window is corrected, the ratio must come down with it: `0.70 × 1,048,576 =
734,003`, clearing the 792,576 ceiling by 58,573. Correcting the number *without* lowering
the ratio makes the defect worse (`0.8 × 1,048,576 = 838,861`).

### M4 — enforce the invariant with a command (fits this kit's own rules)

It is a one-line inequality, so it can be a law rather than a paragraph:

```
floor(contextWindow × thresholdRatio) + maxTokens  <  providerMaxContext
```

A check reading the profile's `llm-deepseek` model config and the compaction policy would
have caught this before a session ran. This kit already enforces rules this way, which is
where the mitigation belongs.

### M5 — upstream asks

1. Subtract the completion reservation in `resolveCompactSpec`, or threshold against
   `contextWindow − maxTokens` (`basic:108-113`). The field is documented as a *combined*
   budget (`dsh-llm/lib/types/types.d.ts:292`); treat it as one.
2. Stop collapsing classified compaction failures into `busy` (`basic:967-969`).
3. Do not throw after a compaction that succeeded but did not reduce enough (`basic:919`).
4. Record `trigger` on `compaction/start`.

## 6. Checked and found clean

- **The token meter is not implicated.** Every failure is exactly `messages + 256,000`, so
  the `chars/4` heuristic did not cause them. Its documented CJK/JSON weakness remains a
  separate, unmeasured accuracy question.
- **Trigger input is not stale.** `measure` adds the surface delta since the anchored
  request (`meter:664`, `meter:682`).
- **Tool-pairing.** The bundled and standalone copies of the balance walk are logically
  identical, and the `replaceGeneration` cache rebuild is correct.
- **Pruner arithmetic.** The load-time guard (`pruner:43-44`) plus `totalChars >
  thresholdChars` (`pruner:93`) guarantee `removedStart < removedEnd` and a home for the
  marker; the post-check at `pruner:122` re-validates. It rewrites only the single
  `ToolResultBlock` of a `tool/result`, preserving `callId`/`step`/`source`, so a pair is
  never orphaned.
- **Lock staleness.** An unmatched `compaction/start` unblocks only once a newer
  `session/end-seed` exists (`basic:519-522`), so a crashed bracket is detectable and a live
  one reports `busy`.
- **Signal forwarding.** The abort signal reaches `GenerateOptions.signal` (`basic:300`).
- **No summary was truncated.** All six summaries carry all eight required sections and end
  at a section boundary. Outputs were 3,169–5,747, with one run at 2,005 reasoning + 5,747
  output = 7,752 of 8,192 (95%). That margin is the one to watch: because the instruction
  demands the sections *in order*, truncation removes `## Next Step` and `## Critical
  Context` last.
- **No orphaned bracket, and recovery works.** Six starts, six summaries, six ends; every
  overflow recovery succeeded first time, dropping the conversation from ~1.05M to
  20,539–29,906 tokens.

## 7. Not verified

- The provider's 1,048,576 limit and its `messages + completion` accounting are taken from
  its own rejection text — authoritative for this route, not for every route.
- Pricing is deliberately not computed; token counts are given because I did not verify the
  current tariff.
- Whether the pruner's discarded middle (everything but head 4096 + tail 1024 of an
  oversized tool result) ever mattered was not assessed.
- Whether an unmatched `compaction/start` can outlive a session with no `session/end-seed`
  appended, which would hold the lock indefinitely (`basic:520`), depends on the session
  seed path and was not traced.
