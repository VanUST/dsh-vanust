# Ratchet mechanism review — judge persistence and bureaucracy

Status: research output, unratified. No code was changed. Every claim below is either a
`path:line` citation or a number produced by a command quoted in this file.

Scope: `plugins/ratchet/**`, `scripts/test-ratchet.mjs`, `.dsh/project.json`, and the
installed harness packages under `@deepseek-ai/dsh-*`. Runtime evidence is read-only from
`$DSH_HOME/sessions/--home-iustimov-dsh-kit--`.

The two questions this answers:

1. The judge is not persistent — every call appears to create a new child. Why, and what
   makes one genuinely long-lived?
2. The ratchet overloads the models that use it. Where is the cost, and what can be removed
   without weakening the guardrail?

---

## 0. Executive summary

| # | Finding | Evidence |
|---|---|---|
| F1 | A judge pool already exists and is deployed; the symptom is not a missing feature. | `ratchet-tools.mjs:440`, `diff` kit vs installed `@cc/dsh-ratchet@0.2.82` = identical |
| F2 | Reuse is gated on a prefix that contains the spec hash and law count, so the corpus edit the judge is reviewing invalidates the judge. | `ratchet-judge.mjs:346-351`, `ratchet-dynamic.mjs:313-314` |
| F3 | The liveness check treats "not currently resident" as "dead"; in this harness that is the normal between-turns state. | `ratchet-judge.mjs:250-253`; harness `continuation.js:254-255`, `continuation-activation.js:559-567` |
| F4 | The pool is keyed per parent Agent and `ratchet_review` has no root guard, so N callers produce N judges. | `ratchet-judge.mjs:191-192`, `ratchet-tools.mjs:831-920` |
| F5 | One `ratchet_compile` runs the compile pipeline ~4× and synchronously runs 2 judge turns. | `ratchet-tools.mjs:636-642`, `ratchet-ops.mjs:567` |
| F6 | The fixed per-request tax is ~45 KB of rules and ~45 KB of tool schema; 11 ratchet tools are 35% of the schema. | measured below |

The guardrail that actually enforces anything — the deterministic write guard and
`ratchet_verify` — is cheap and cached. The expensive part is model judgement, and it is
currently on the hot path of every compile.

---

## 1. The judge is not persistent

### 1.1 A pool exists, and it is the deployed code

`ratchet-judge.mjs` implements "one durable judge child per calling parent", and
`ratchet-tools.mjs:440-453` constructs it once per plugin activation:

- `ratchet-judge.mjs:191-192` — `Parent Agent -> { childId, … }`, a `WeakMap` keyed by the
  exact parent Agent.
- `ratchet-tools.mjs:466-472` — `judgeSpawner(exec)` returns a closure over
  `judgePool.judge({ parent: agent, … })`.

The kit source and the installed plugin are byte-identical:

```
$ diff -q plugins/ratchet/ratchet-judge.mjs \
    ~/.npm/dsh/profiles/web/node_modules/@cc/dsh-ratchet/ratchet-judge.mjs
(no output; exit 0)
```

So the observation "each call creates a new subagent" is a real failure of the pool, not an
undeployed fix.

### 1.2 Root cause A — the reuse key is the thing the work changes

`runCall` recreates the child whenever the static prefix no longer matches:

```js
// ratchet-judge.mjs:346-351
const needsCreate =
  entry.childId === null ||
  entry.dead === true ||
  entry.staticText === null ||
  !task.startsWith(entry.staticText)
```

For a review job the static prefix is everything up to `\n# Question`
(`ratchet-ops.mjs:1206`), which is `renderStableContext` and contains:

```js
// ratchet-dynamic.mjs:313-314
`Laws in force: ${laws.length}`,
`Spec hash: ${bundle === null ? '(none)' : bundleHash(bundle)}`,
```

Any ADR added, edited, ratified or removed changes that hash and therefore the prefix. The
behaviour is even pinned by a test: "a changed static prefix recreates the judge rather than
serving stale orientation" (`scripts/test-ratchet.mjs:1714`).

The ratchet exists to change the corpus. So the workload is precisely the sequence that
invalidates its own cache: judge → ingest/compile/ratify → judge.

Measured on a real root session, two continuable judge children were created hours apart,
with corpus changes between them:

```
$ # subagent/catalog events, label = ratchet-judge, mode = continuable
1789995736220  (2026-09-21T13:02:16Z)  child f1d2dee8…
1790005671028  (2026-09-21T15:47:51Z)  child 6747bdc0…

$ git log --since=2026-09-21 --until=2026-09-25 --pretty='%h %ad %s' -- docs/adrs
71c6327 2026-09-21 16:38:15 +0300  Run the verifications the kit declared…
4e53787 2026-09-21 17:03:00 +0300  Critic over the ratchet design…
0311749 2026-09-21 17:53:22 +0300  Fix all twenty critic findings…
3bf0baa 2026-09-21 18:37:34 +0300  Ratify ADR 0075 and ADR 0076…
```

Five corpus changes fall between the two creates. This is the recreation path being taken
in production.

### 1.3 Root cause B — normal non-residency is read as death

```js
// ratchet-judge.mjs:250-253
const live = agents.get(childId)
if (live === undefined) {
  entry.dead = true
  throw new Error(`the judge child ${String(childId)} did not become resident`)
}
```

The installed harness defines `continuable` as a **durable Session with a disposable
Agent**:

- `dsh-subagent/lib/types/index.d.ts:118-131` — "A running target admits it at the nearest
  step boundary; an idle target starts a turn, and an absent direct child cold-resumes from
  persistence."
- `dsh-subagent/lib/types/continuation.js:254-255` — `if (activation === undefined) return
  this.coldResume(parent, childId, content, options);` — absence is a handled state.
- `dsh-subagent/lib/types/continuation-activation.js:559-567` — a child that goes idle with
  an empty inbox and no owned children is disposed; `:624` removes it from the registry.
- `dsh-agent/lib/types/index.js:349-351` — `agents.get` is a plain map read.

`sendMessage` does return with the child resident (it materializes inside the per-child lock,
`continuation.js:143`), so the check usually passes. But the window between a fast turn
finishing and the watcher disposing the agent is exactly the window this line runs in, and
the durable notion of "alive" is "resumable", which `sendMessage` already establishes. A
transient `undefined` therefore destroys a healthy child and pays for a new one.

The same over-eager marking happens on stop reason:

```js
// ratchet-judge.mjs:274-276
if (read.stopReason === 'error' || read.stopReason === 'refusal' || read.stopReason === 'max-tokens') {
  entry.dead = true
}
```

`max-tokens` is a bad answer to one question, not a dead agent; it permanently poisons the
pool entry for the rest of the session.

### 1.4 Root cause C — the pool is not "one judge", it is one judge per caller

The `WeakMap` is keyed by the calling Agent (`ratchet-judge.mjs:191-192`). The automatic
review is guarded to root callers (`ratchet-tools.mjs:489-498`, `:615-616`), but the
`ratchet_review` tool is not: its `execute` reaches `judgeSpawner(exec)` directly
(`ratchet-tools.mjs:916`). Every subagent that reviews gets its own judge child, and
the harness offers no reuse-by-role API to avoid it (`dsh-subagent/lib/types/types.d.ts:176-191`
lists only `maxDepth`, `toolFilter`, `persona`).

So the number of judge children is `(distinct callers) × (distinct corpus states)`.

### 1.5 What it costs when it does work

When the corpus is stable the pool does reuse, and the accumulated conversation is re-read on
every turn. Measured token usage of the two judge children:

| child | LLM calls | total tokens | input | output |
|---|---|---|---|---|
| `f1d2dee8…` (created, then corpus changed) | 2 | 178,654 | 33,138 | 34,924 |
| `6747bdc0…` (recreated, then served 13 jobs) | 13 | 1,419,748 | 54,166 | 57,422 |

13 calls × ~110 KB of retained context ≈ the measured 1.42 M tokens. The conversation reuse
saves agent creation but pays the whole orientation back on every turn.

---

## 2. Bureaucracy — where the effort actually goes

### 2.1 Fixed tax, paid on every single model call

| item | bytes | source |
|---|---|---|
| Rules file injected by `@cc/dsh-kit-rules` | 45,270 | `wc -c ~/.npm/dsh/AGENTS.md` |
| Tool definitions, all 42 tools | 45,314 | last `request/header` in the session (25,262 desc + 20,052 schema) |
| — of which the 11 `ratchet_*` tools | 15,918 | same; **35.1% of the whole tool schema** |

The ratchet adds ~16 KB to every request before the agent does anything, and the rules file
carries a further ~4 KB section (§0a) describing the ratchet's own organisation.

### 2.2 Judge prompts are large and almost entirely fixed

```
$ node plugins/ratchet/ratchet-cli.mjs review --job review_corpus --root .
total bytes: 105,749   '\n# Question' at: 104,260          → static part 98.6%
```

All four jobs that can be built from the CLI share the same static prefix:

| job | total | static prefix |
|---|---|---|
| `review_change` | 105,714 | 104,260 |
| `grill_preparation` | 105,997 | 104,260 |
| `review_corpus` | 106,152 | 104,260 |
| `review_duplicates` | 105,912 | 104,260 |

`review_proposal`, `review_conflict`, `explain_violation` cannot be built by the CLI (no
`--proposal`/`--conflict`/`--violation` flag) and return a ~460-byte "needs X" refusal;
their static prefix is the same corpus material.

The material is every law in force with all of its checks — 79 laws for this project. A
judge asked one question reads the entire corpus to answer it.

### 2.3 One compile call runs the pipeline four times and two judges

`ratchet_compile` (`ratchet-tools.mjs:698-712`) calls `compile()` and then
`reviewWhenRequired()`. Counting the work:

1. `compile()` → `compileProject` (`ratchet-ops.mjs:873` path) and `draftNeedsHuman(root,
   { write: true })` (`ratchet-ops.mjs:567`) — the drafting pass re-reads the whole corpus.
2. `reviewWhenRequired` → `review('review_corpus')` → `contextFor(root)`
   (`ratchet-ops.mjs:1136`) → `compileProject` again.
3. → `review('review_duplicates')` → `contextFor(root)` → `compileProject` again.
4. → `rechecked = await compile({ root })` (`ratchet-tools.mjs:642`) → `compileProject`
   **and** `draftNeedsHuman` again.

So a single tool call performs four full compiles and two full corpus reads for drafting, and
blocks on two judge turns (`ratchet-tools.mjs:636-637`). The judge turns are synchronous and
cannot be opted out of except with `review: false`.

This is what makes the ratchet feel like bureaucracy rather than a guardrail: the cheap,
deterministic part (`verify`) is not the thing that runs on every compile, and the expensive,
advisory part runs automatically.

### 2.4 Where the agent's own time goes

In the same root session, tool-result text totalled 4,963,418 bytes:

| tool | calls | text bytes |
|---|---|---|
| `bash` | 2,563 | 2,768,839 |
| `read` | 428 | 1,543,269 |
| `web_fetch` | 11 | 190,697 |
| `job_output` | 166 | 117,323 |
| `grep` | 17 | 82,994 |
| … | | |
| all `ratchet_*` | 8 | 49,557 (**1.0%**) |

Direct ratchet tool output is 1% of the agent's context. The ratchet's cost to the agent is
therefore *not* its tool output — it is (a) the fixed tax of §2.1, (b) the model turns of
§2.3, and (c) the follow-up work its findings trigger. In this particular session the
follow-up work was large — the subagent catalogue contains dedicated ratchet workers such as
"Implement ratchet falsify breaker", "Break the three ratchet fixes", "Breaker: semantic
contradiction gate", "Tests for ratchet review fixes", "Ratify refuses contradictions".

**Caveat, stated so the number is not over-read:** that session's task *was* developing the
ratchet, so its ratchet-themed subagents overstate the overhead a normal project pays. The
1% figure and the fixed-tax figures in §2.1 are not affected by that caveat; the
follow-up-work observation is.

---

## 3. Proposed design

Each proposal names what would fail if it were not done, because a rule nobody can check is
a preference.

### P1 — key the judge on the project, not on the corpus hash

Stop putting `Spec hash` and `Laws in force` in the cached prefix. The child holds the
invariant orientation (role, authority rule, answer format); the current corpus travels with
the question, as a diff of the laws that changed since the child last saw it, or in full on a
cold child. Then `needsCreate` never fires because the corpus moved.

- Removes F2.
- Enforced by: extend `scripts/test-ratchet.mjs` so that two calls whose *only* difference is
  the corpus produce `reused: true`, and that the second call's material contains the changed
  law.
- Risk: the per-call payload grows when the corpus is re-sent; measure with the existing
  prompt-size command.

### P2 — treat `undefined` as "cold", never as "dead"

Use `sendMessage` as the liveness oracle (it cold-resumes), delete the
`agents.get(...) === undefined → dead` branch, and never mark a child dead for `max-tokens`
or `refusal`. A dead child is one whose *send* throws.

- Removes F3.
- Enforced by: a test in which `agents.get` returns `undefined` between two calls and the
  pool must still report `reused: true` with one spawn.
- Harness basis: `continuation.js:254-255`, `continuation-activation.js:559-567`.

### P3 — one judge per session root

Make judge creation root-only, as the automatic path already is
(`ratchet-tools.mjs:615-616`): a non-root caller gets the degraded self-review route, not a
new child. Then the count is `corpus states`, not `callers × corpus states`.

- Removes F4.
- Enforced by: a test that drives `ratchet_review` with a non-root `exec.agent` and asserts
  `spawned.length === 0`.
- Alternative, if per-caller judges are genuinely wanted: cap total judge children per
  session and report the cap.

### P4 — take the model out of `compile`

`ratchet_compile` should return the static verdict immediately and report
`contradictionReview.stale` as a fact. Meaning-review becomes an explicit
`ratchet_review` (or a panel button), optionally queued in the background. The staleness fact
is already computed (`ratchet-ops.mjs:365-366`) and already visible in `status`.

- Removes half of F5 (the blocking judge turns).
- Enforced by: a test that `ratchet_compile` never calls a judge and returns under a
  wall-clock budget on the fixture corpus.
- Risk: nobody runs the review. Mitigation is that the fact is *reported*, and the panel can
  offer it as an action — the same trade the deployment already made for the semantic checks
  it decided must not gate.

### P5 — compile once per call

Thread the compiled bundle through the call instead of recomputing it: reuse it for the
drafting pass, for the review context, and drop the `rechecked = await compile({ root })`
(which exists only to refresh problems after the review records a report that does not change
the law set).

- Removes the other half of F5.
- Enforced by: a counter test that `compileProject` runs once per `ratchet_compile`.

### P6 — send the judge only what the question needs

For `review_change`/`review_proposal`, include the laws whose zones the change touches, plus
a one-line law index; let the judge ask for more if it needs it. This turns a 104 KB prompt
into a few KB and removes the haystack the answer is buried in.

- Attacks §2.2.
- Enforced by: a prompt-size assertion per job (the command in §2.2 already exists).
- Risk: a missed law. Mitigation: the index names every law id, so the judge can request one.

### P7 — cut the ratchet's share of the fixed tax

The 11 tools at 15,918 bytes are 35% of the schema. The three ingest tools overlap
(`ratchet_ingest`, `ratchet_ingest_source`, `ratchet_ingest_batch`); `ratchet_reconcile`
returns advice. Keep a small guardrail surface (`status`, `compile`, `verify`, `ratify`,
`review`) and route the rest through the CLI, which pays no tool-schema tax.

- Attacks §2.1.
- Enforced by: a budget assertion on the total `ratchet_*` description+schema bytes.

### P8 — make the cheap guardrail the default and the model the exception

The write guard is already cached on the decisions-directory signature
(`ratchet-guard.mjs:525-528`) and `verify` is deterministic. The proposal is to make those
the path an agent is told to follow after every change, and to make model judgement
pull-only. That is the difference between a guardrail and a toll booth.

---

## 4. What I could not determine

- Whether `dsh-compaction-basic` is mounted in this deployment's subagent composition. It
  auto-registers on `agent/pre-step` and overflow by default
  (`dsh-compaction-basic/lib/index.js:76`, `:798-800`, `:820-831`), so a reused judge's
  history would be compacted if it is mounted — but I did not inspect the loader, so I cannot
  assert per-child compaction is on. This matters for P1.
- Whether the three jobs the CLI cannot build (`review_proposal`, `review_conflict`,
  `explain_violation`) really carry the same 104,260-byte prefix — they go through the same
  `renderStableContext`, but I could not render them without the tool layer.
- The counterfactual cost of the one-shot path that preceded the pool. The old code is
  visible only in transcripts, not in git here.
- Whether the pool has actually recreated a child because of the `agents.get` race in
  production, as opposed to the corpus-hash cause. The catalog events prove two children
  existed and the git timeline explains them without needing the race; the race is a latent
  defect confirmed from the harness contract, not a measured occurrence.

## 5. Falsification plan

Each claim can be broken cheaply, and should be before the fix is trusted:

| claim | the command that should fail if the claim is wrong |
|---|---|
| F2 causes recreation | `node --test scripts/test-ratchet.mjs` — the existing changed-prefix test passes today, which *is* the proof of the predicate |
| F3 is live | a test where `agents.get` returns `undefined` between two calls: today it spawns twice |
| F5 counts four compiles | instrument `compileProject` and run one `ratchet_compile` on the kit |
| judge cost | sum `usage.totalTokens` in a judge child session (the command in §1.5) |
| fixed tax | re-read the last `request/header` and `wc -c AGENTS.md` (the commands in §2.1) |
