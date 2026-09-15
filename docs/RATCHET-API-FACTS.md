# DSH API facts for Ratchet v2 — measured, not recalled

**Written:** 2026-09-13 · **Harness:** `@deepseek-ai/dsh@0.1.5-rc.1` (global) with
`@deepseek-ai/dsh-*` packages resolved at **0.1.5-rc.2** · **Node** v24.21.0 ·
**Evidence:** `reports/ratchet/api-discovery.json` (raw bundle),
`node scripts/probe-dsh-api.mjs` (re-runnable).

**How to read this.** Every claim below is either **measured** (a probe on this
machine produced it, and the command is given) or **declared** (read from the
shipped `.d.ts`, and marked as such). Where the two disagree, the disagreement is
itself a finding, because the declarations are what a reader would otherwise
trust. Nothing here is recalled from documentation.

The probe never touches a live profile: it builds its own `DSH_HOME` under the
system temp directory, copies in credentials only, and mounts its plugin through
the home-level patch layer. `--keep` preserves the scratch home for inspection.

---

## 1. Why this document exists before any Ratchet code

Ratchet v2 rests on four harness capabilities. Each was an assumption that would
have invalidated a module had it been wrong:

| Capability the design needs | Assumption | Result |
|---|---|---|
| The verifier's project root | `exec.agent.session.header.cwd` is the session workspace | **confirmed** |
| The tool contract | `defineTool` compiles schemas; the registry enforces declared outputs | **confirmed** |
| Context assembly for dynamic review | a plugin can attach context to its own result | **confirmed** |
| Dynamic review via a judge agent | a tool body can spawn and read a child agent | **confirmed** — a child was spawned and its structured verdict read back in 2.4–6.5 s |

All four hold. The dynamic layer can spawn its own judge, which was the one
capability whose failure would have forced the design's fallback path.

---

## 2. Confirmed by execution

`node scripts/probe-dsh-api.mjs` → **18/18 checks pass**, exit 0, ~5 s.

### 2.1 Tool declaration and registration

| Fact | Evidence |
|---|---|
| `defineTool` from `@deepseek-ai/dsh-tools` is the supported declaration route | a tool declared with it registers and dispatches |
| The model-facing schema is exactly `{name, description, parameters}` | `keySets: ["description,name,parameters"]` across **31 tools** — `execute`, `isConcurrencySafe`, `timeoutMs` and presenters never reach the model |
| A value violating `output.schema` is **rejected** | `zzprobe_output_bad` returned `{ok:'not-a-boolean', extra:…}` and the call failed: `tool "zzprobe_output_bad" returned invalid output: "value.ok" must be a boolean; "value.extra" is not a declared property (additionalProperties: false)` |
| A conforming value passes the same schema | `zzprobe_output_ok` → `ok=true note=conforming value` |
| `parameters` and `output.schema` are validated as **RAW JSON Schema**, not the author DSL | see §3.1 |

The output-schema rejection is the load-bearing one. It is what lets the Ratchet
declare a **canonical report shape** and have the harness — not a convention —
refuse a tool that returns something else. A gate whose result shape is enforced
by the runtime is a gate; one that is merely documented is not.

### 2.2 The execution context

Measured from inside a dispatched tool (`zzprobe_env`, `zzprobe_services`):

| Field | Observed |
|---|---|
| `exec.name`, `exec.callId`, `exec.token`, `exec.arguments` | present |
| `exec.signal` | an `AbortSignal` (`aborted: false`) — a tool can forward cancellation |
| `exec.deferContext` | a **function** — a tool may attach context to its own result |
| `exec.concludeTurn` | a function |
| `exec.agent.id` | `session-<uuid>`, equal to the session id |
| `exec.agent.session.header.cwd` | the **session workspace**, equal to the directory the run was opened on |
| `exec.agent.session.header.version` | `3` (session format v3) |
| `exec.agent.options` | `{provider: 'deepseek-official', model: 'deepseek-flash'}` |
| `exec.agent.ctx` | present — an agent-scoped context exists |

`exec.agent.session.header.cwd === <run workspace>` is the fact the whole
`rootFor(exec)` pattern depends on. It was confirmed by string equality against
the workspace the probe passed to `spawnSync`, not by inspection.

### 2.3 Services a plugin can reach

From the plugin context, comparing **both** access routes — `ctx.get(name)` and
the `ctx[name]` property:

| Service | `ctx.get` | `ctx[name]` | Constructor |
|---|---|---|---|
| `tools` | yes | yes | `ToolRuntime` |
| `llm` | yes | yes | `LlmRuntime` |
| `agents` | yes | yes | `AgentRegistry` |
| `fs` | yes | yes | `SandboxedFileSystem` |
| `storage` | yes | yes | `Storage` |
| `settings` | yes | yes | `FileSettingsProvider` |
| `systemPrompt` | yes | yes | `SystemPrompt` |
| `codeRuntime` | yes | yes | `WorkerThreadCodeRuntime` |
| `loader` / `hmr` / `timer` | yes | yes | `Loader` / `Hmr` / `TimerService` |
| `session` | **no** | **no** | — |
| `approval` | yes | yes | `ApprovalService` (the seam is `ctx.approval`; nothing registers the name `userApproval`) |
| `userQuestions` | yes | yes | `UserQuestionService` |
| `subagents` | yes | yes | `SubagentRuntime` |
| `subagent` | **no** | n/a | — (nothing registers this name) |

`ToolRuntime.schemas(scope)` is callable from a plugin body, so a plugin can read
the live model-facing tool surface — the mechanism a Ratchet context bundle would
use to describe the tool surface without duplicating it.

**`ctx.get(name)` resolves a mounted service without the plugin declaring it in
`inject`.** The row measuring this declares only `inject: ['tools']` and still
resolves `subagents`, `llm` and `agents`. A declaration is what makes the
`ctx.<name>` PROPERTY route legal, not what makes `get` work — see §3.3.

### 2.4 Plugin mechanics

| Fact | Evidence |
|---|---|
| A row may be mounted by absolute `file:` URL from the home patch layer | all three probe rows load this way |
| A plugin is registered inside `ctx.effect(fn)` and disposed by the returned disposer | three rows register, dispose and re-register without a duplicate-name failure |
| `inject` is a **hard gate**, not a hint | §3.3 |
| A loader row takes the module's default export or its `apply` member | a row with `config: {export: …}` failed the whole tree — §3.4 |

### 2.5 The consent seam (`ctx.userQuestions`)

Measured by `node scripts/probe-dsh-api.mjs --ratchet-ratify` (10/10), which mounts
the ratchet plugin and drives the PRODUCTION ratification path against a fixture
project while a stub answerer stands in for the human.

| Fact | Evidence from the run |
|---|---|
| A plugin tool body can reach `ctx.userQuestions` with the live root agent and get an answer | check `ratchet_ratify.channel_reached_with_a_live_root_agent`: `servicePresent=true channelAvailable=true agentScoped=true questions=2` |
| The question carries the record's own text as `detail`, which is what the content hash covers | check `ratchet_ratify.human_sees_the_record_itself`: `detailBytes=871`, `detailHasFrontmatter=true` for an 871-byte ADR |
| One question per record, with exactly the two labels the derivation compares against | the same run's question payloads: `options: ["Approve","Reject"]` |
| An answer whose label matches no option is not a consent | check `ratchet_ratify.answers_are_derived_from_labels`: the deliberately unreadable answer minted nothing, and the re-ask (`ratify-again-0001`, labels `Approve ADR 0001` / `Reject ADR 0001`) produced the approval |
| An unambiguous answer mints immediately | check `ratchet_ratify.clean_answer_minted_in_the_first_round`: the clean answer's approval id sorts before the re-asked record's |
| The written approval is an ordinary ADR that parses clean and puts the law into force | checks `ratchet_ratify.approvals_are_clean_records` and `ratchet_ratify.consent_takes_effect`: two approvals, two laws in force, zero compile problems |
| A listener registered at the ROOT scope receives an agent-scoped dispatch | the stub answerer registers with `ctx.on('user-questions/request', …)` and was asked; the harness runs the listener chain from the root down |
| `ask()` authenticates the exact live runtime root | `UserQuestionService.ask` rejects with `CALLER_NOT_LIVE` / `DELEGATED_CALLER`; the probe passes `exec.agent` and is admitted |
| The answer shape is `{ answers: [{ id, selected, custom? }] }`, and for a single-select question `custom` OVERRIDES the selection | `@deepseek-ai/dsh-user-questions` README, §"Public API"; it is why a free-text answer arrives with `selected: []` and is treated as unreadable rather than guessed at |
| The client renders `detail` as Markdown above a radio group, and the `plan-review` intent is presentation-only and requires exactly two options plus a detail | `dsh-client-ui-user-questions/lib/client.js` (`planReviewOf`, `QuestionComposer`); the ratchet uses the generic flow, not the intent, so an ADR is not presented as a plan |

**Two properties of the ratchet's own seam, measured by breaking them first.** Both
were added after an adversarial pass falsified the earlier design, and both are
regression-tested by name:

- **The consent covers the text the human was SHOWN, not the text on disk when the
  answer arrives.** The quiz freezes each record's content hash when the question is
  built, and an answer about a record that changed while the question was open is
  refused with `RATIFICATION_STALE`. The earlier version re-derived the queue after
  asking, so a concurrent writer could have an approval bind a substitute the human
  never read.
- **Nothing on the tool surface accepts an answer.** `ratchet_ratify` has two arguments,
  `ids` (which records) and `root` (which project holds them) — both are questions the
  ratchet asks, and the operation refuses an answer it cannot pair with a quiz it built. The
  earlier version took an `answers` object, which made it an agent mint with extra
  steps — an agent could read the quiz it was handed, type the approve label and mint
  law, with no human channel composed at all. The reproduction that falsified it is
  three lines of Node against the registered tool definition.

**The harness approval seam is real and is not the right door here.** `ctx.approval`
(`@deepseek-ai/dsh-user-approval`) is a one-shot, fail-closed permission seam with an
`approval/asked` + `approval/decided` audit pair, and it is gated by the session's
permission preset. The deployment runs `danger-full-access`, whose bundled policy is
`never` (`dsh-permission-presets`, default table), so a request in those sessions is
rejected deterministically before any answerer is consulted — the runtime-context
sentence "Approval prompts are disabled in this session…" IS that service's
`NEVER_SENTENCE`. It also carries no tool arguments, so a human would see a tool name
and a reason rather than the record. Both facts are why ratification asks a question
instead of requesting an approval; §8 of `docs/RATCHET-V2-DESIGN.md` records the
rejection.

---

### 2.6 A question can carry a presentation intent, and the panel can claim the seat

The ADR panel is to offer a proposed decision's ratification as two buttons instead of the
generic question flow. Two halves had to be measured, and only one of them can be measured
from a terminal.

**Measured by execution (the asking half).** The ratchet stamps its question with
`intent: { kind: 'ratify-decision', approve: <approve label> }`, and the question still
crosses the seam, is answered, is re-asked differently when the answer cannot be read, and
produces an approval and a transcript:

| Fact | Evidence |
|---|---|
| A question may carry an `intent` the asker defines; the seam does not reject it | `node scripts/probe-dsh-api.mjs --ratchet-ratify` → **10/10**, and the approved records land |
| A two-button presentation may claim it: the batch is a binary single choice over one record | the same run's questions read `options: ["Approve","Reject"]`, one question per record, no multi-select |
| A re-ask stays claimable | `[{id:"ratify-again-0001", options:["Approve ADR 0001","Reject ADR 0001"]}]` |

The intent matters because of a constraint in the harness rather than in this kit: a
presentation may claim a question **only when it can send every answer that question
allows** — "an intent changes the layout, never which answers are reachable"
(`dsh-client-ui-user-questions/lib/client.js`, `planReviewOf`). A ratify question is a
binary single choice over one record, so two buttons express every answer it has.

**Read, not yet measured (the presenting half).** A client plugin can claim the composer
seat, and there is a shipped precedent, but this is a source reading with citations and not
an executed fact:

- the seat is a **chain**: `dsh-client-ui-conversation/lib/client.js:14932` renders
  `conversation.composer` with `renderSlotChain`;
- the election is the first entry whose `select()` returns non-null
  (`dsh-client-ui-renderer/lib/client.js:828-849`, a throwing selector counts as declining);
- `dsh-client-ui-user-questions/lib/client.js:874-879` owns the seat today with a `select`
  over its own `PendingQuestion` and no `priority`;
- `dsh-client-ui-approval/lib/client.js:265-282` is a **second claimant of the same seat**,
  at `priority: 1`, with its own `select` and its own pending-interaction domain — which is
  the pattern the panel would follow.

Three consequences are what still need running, and they are the implementation's first
task: that a third-party bundle's `select` is reached at all, that claiming the seat
suppresses the generic flow rather than duplicating it, and that the claimed interaction
exposes an `answer` the panel can call with the same batch shape the generic flow sends.
The panel must also recognise the question **structurally** (`questions[0].intent`) because
`PendingQuestion` is not exported and a third-party bundle cannot use `instanceof`.

**Settled afterwards (2026-09-15), by a decision rather than by the probe.** The panel
does NOT put the question in the Conversation. An agent's decision is answered in the
decision window, so the composer claim renders a **pointer** — the decision's name and a
button that opens the window — and the question's text, record text and answer labels
appear only in the panel. The seat is claimed in order to **suppress** the harness's card,
not to replace it with a second one. A **grilling session** is the one exception, and the
ratchet now says which case a question is in: `buildQuiz(entries, { present })` attaches
`intent: { kind: 'ratify-decision', … }` only for `'panel'` (the default), so the grill
entry (`ratchet_ingest_source` with `ratify: true`) declares no intent, nothing claims it,
and the harness's own card asks — and blocks — in the Conversation, which is what a grill
is for. An unrecognised `present` is treated as the Conversation's, because a value that
does not say "panel" is one no client may claim on the ratchet's behalf.

Two of the three consequences are now exercised, and the third is not:

- **Measured**: the panel's `select` accepts the ratchet's real question and refuses every
  shape it cannot answer completely, and the batch each button sends is read back by the
  ratchet's own `deriveDecisions` as `approved` / `rejected` rather than `unreadable` —
  `node scripts/test-adr-panel.mjs`, which imports `buildQuiz`/`deriveDecisions` and drives
  the shipped bundle through a stub loader. The seat renders no button carrying either
  answer label, so the Conversation cannot answer the question; the window renders both.
- **Measured**: the intent literal is one value with two copies (a Node plugin and a
  browser closure that cannot import each other), and `scripts/check-consent-surface.mjs`
  fails when they stop being equal.
- **Still a reading**: that the running shell elects the panel's entry. See the panel
  README's "What is NOT verified without a browser".

---

## 3. Where declarations and behaviour diverge

Five findings. Each is a trap a reasonable implementer would walk into, which is
why each is recorded with its reproduction rather than as advice.

### 3.1 `{type: 'json'}` is a `defineTool` DSL node, not a JSON Schema type

Declared: `dsh-tools` exports `ValueSchemaSpec` including `JsonValueSchemaSpec`
`{type: 'json'}`.

Measured: registering a bare definition through `ctx.tools.register()` whose
`output.schema` was `{type: 'json'}` was **rejected**:

```
JsonSchemaError: unsupported JSON schema: schema.type must be one of
object/array/string/number/integer/boolean/null
```

**Consequence for Ratchet:** every tool must be built with `defineTool`. The
declaration helper is not sugar — it is what compiles an author schema into the
enforced subset.

### 3.2 `required` is a per-property DSL annotation; an empty parameter map must go through `defineTool`

Measured, two shapes:

- `properties: { ok: { type: 'boolean', required: true } }` **inside a raw
  schema** → `schema.properties.ok.required is not supported on type "boolean"`.
  `required` is a DSL annotation (`ParameterPropertySpec & {required?: true}`),
  not the JSON-Schema array keyword.
- A bare definition with `parameters: {}` → the **model request** fails:
  `INVALID_REQUEST: Invalid schema for function '<name>': schema must be a JSON
  Schema of 'type: "object"', got 'type: null'`. This aborted the whole one-shot
  run, not merely that tool.

**Consequence for Ratchet:** even a zero-argument tool (`ratchet_status`,
`ratchet_compile`) must be declared through `defineTool`, or the deployment
cannot talk to the provider at all.

### 3.3 The subagent runtime is called `subagents`, and one wrong character cost a false finding

This is the finding that most changed during discovery, and it is recorded in full
because the intermediate wrong answer was convincing.

**What was claimed first, and why it was wrong.** A probe declaring
`inject: ['tools']` asked for `ctx.get('subagent')` (singular), got `undefined`,
and read `ctx.subagent`, which threw:

```
Error: cannot get property "subagent" without inject
```

Declaring `inject: ['subagent']` then failed the whole boot:

```
Error: dsh: plugin tree failed to load: dsh: 2 entries did not activate
  …/api-probe/index.mjs: pending (waiting for service: subagent)
```

Those two observations were combined into "the subagent runtime is unreachable
from a plugin", which would have forced the dynamic layer onto its fallback path.

**What is actually true.** The runtime registers itself as **`subagents`** —
plural — from its own constructor:

```js
constructor(ctx) {
  super(ctx, "subagents");
  …
}
```

The row id is `subagent`, and the package's `.d.ts` prose says `ctx.subagents`,
so the singular spelling appears everywhere except where the service is actually
registered. Correcting the name changed every result:

| Probe | Result |
|---|---|
| `ctx.get('subagents')` from a row declaring only `['tools']` | resolves to `SubagentRuntime` |
| `ctx.subagents` from a row declaring `['tools','subagents']` | resolves |
| `ctx.subagents.list()` | `["spawn","fork"]` — both providers registered |
| `ctx.subagents.start('spawn', {label, prompt, parent, signal, outputSchema})` | a child agent runs |
| `run.result` | `stopReason: "completed"` in **2.4–6.5 s** |
| `result.structured` | `{verdict: "ok", reason: "RATCHET_JUDGE_OK"}` — the requested schema was honoured |

Reproduction: `node scripts/probe-dsh-api.mjs --probe-judge` → **6/6 facts
confirmed**, exit 0.

**Two legs, measured separately — and why that mattered.** The probe runs one
child with no schema and one with `outputSchema`, because asserting a single
result for both conflates a working judge with a working schema. The first version
of this probe made exactly that mistake: it asserted the structured branch
unconditionally and **passed while `structured` was silently `null`**, because the
child had answered correctly in text and the schema capture had failed.

The measured behaviour, now that both legs are separate:

| Leg | Result |
|---|---|
| no schema | `stopReason: 'completed'`, `output: "RATCHET_JUDGE_OK"`, ~1.5 s |
| with `outputSchema`, prompt says "reply with ONLY this JSON object" | `stopReason: 'completed'`, `structured: {verdict:'ok', reason:'RATCHET_JUDGE_OK'}` |

A child that answers correctly but fails capture reports `stopReason: 'error'`
with the right text in `output` and `structured: null` (observed). So schema
capture is reliable **when the prompt asks for JSON and nothing else**, and
unreliable otherwise — the child's prose is what the parser sees.

**Consequence for Ratchet:** the dynamic layer must read `structured` first and
fall back to `output`, and its judge prompts must demand JSON with no surrounding
prose. Treating `structured` as guaranteed is how a review silently returns
nothing; treating a failed capture as a failed review would discard a correct
verdict.

**What the gate really is.** Both original observations were correct *about the
singular name*: no service registers `subagent`, so `ctx.get('subagent')` is
`undefined` and a row injecting it stays pending forever. The lesson is narrower
and more useful than "inject is a hard gate":

- A row that injects a name **no service registers** fails the entire boot with
  `pending (waiting for service: <name>)`. The error names the dependency, not the
  typo, so it reads as "the runtime is unavailable" when it means "that name does
  not exist".
- Reading `ctx.<name>` for a service **outside the declared injection** throws
  `cannot get property "<name>" without inject`. `ctx.get(name)` does not throw;
  it answers `undefined`.
- `ctx.<name>` for an injected-but-absent name silently reads
  `Object.prototype[name]` — `ctx.name` is the **string** `"name"`. A truthiness
  test on that route reports eleven phantom services. The probe now compares the
  read against `Object.prototype[candidate]` to remove the whole class.

**Consequence for Ratchet:** a plugin that wants the runtime must declare
`inject: ['tools', 'subagents']`. With that declaration the child is spawned,
awaited and read back through `SubagentResult.output` and
`SubagentResult.structured`, and `run.dispose()` reaches quiescence. The dynamic
layer is buildable as designed.

### 3.4 A directory `file:` URL does not resolve through `package.json` exports

```
Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import 'C:\dsh-kit\probes\api-probe'
is not supported resolving ES modules
  Did you mean to import "file:///C:/dsh-kit/probes/api-probe/index.mjs"?
```

**Consequence for Ratchet:** a plugin mounted by absolute URL must name its entry
**file**. This is also why the probe needs one entry module per plugin:
a loader row takes the default export or an `apply` member, and Cordis offers no
config selector for a different export (§3.5 in the probe's own comments).

### 3.5 `undefined` is not lossless JSON

A diagnostic payload whose `describe()` helper always emitted a `preview` key
failed with `tool "<name>" returned invalid output: value is not lossless JSON`
whenever the value was not a string, because `JSON.stringify` had dropped the
`undefined`.

**Consequence for Ratchet:** the report shapes are canonical and enforced, so
every field must be omitted rather than set to `undefined` in any code path that
runs without a `JSON.stringify` round trip in between. This is a real class of
bug for a compiler that builds report objects from optional inputs.

---

## 4. Facts about session logs (used for evidence and by the ledger design)

Measured on a session the probe produced (`session.v3.jsonl.zstd`):

| Fact | Observed |
|---|---|
| Record vocabulary present | `session`, `permission/preset`, `sandbox/mode`, `approval/policy`, `agent/inbox/spliced`, `turn/start`, `step/start`, `system/message`, `user/message`, `request/header`, `request/context`, `assistant/message`, `tool/call`, `tool/result`, `session/title`, `session/title-llm-request`, `step/end`, `turn/end` |
| `tool/call` shape | `data.{turn, step, callId, name, arguments}` |
| `tool/result` shape | `data.message.content[]`, one block per result **in the batch**, each with `toolCallId`, `isError`, and `content[]` |
| One record may carry several results | a batch of six calls produced six `tool/call` records and six results across `tool/result` records — never assume one result per record |
| File encoding | concatenated zstd frames; decoded in this kit by `scripts/session/session-log.mjs` |

**Consequence for Ratchet:** reading `tool/result` as a flat
`{callId, content, isError}` yields **zero** results while every record is
present — a silent-empty bug of exactly the kind the Ratchet is meant to catch.
The ledger's own reader must go through `data.message.content[]`.

A related trap was hit while building the probe: an edit made with a PowerShell
text pipeline joined lines and silently reverted a `tool/result` reader, and the
probe then reported "no tool/result records" while the run had exit 0. **Any tool
that reports absence must distinguish "absent" from "unreadable".**

---

## 5. What this means for the Ratchet v2 design

1. **Zones, laws and reports are buildable as designed.** The workspace root, the
   enforced report shape, and `ctx.effect` disposal are all confirmed.
2. **`ratchet_compile` / `ratchet_verify` / `ratchet_status` must be `defineTool`
   definitions with explicit object-rooted parameters** — even with no arguments.
3. **The dynamic layer is buildable as designed, not merely as a fallback.** A
   judge child agent can be spawned from a tool body, awaited, and read back as a
   validated structured verdict. The self-review fallback remains useful as a
   degraded mode, but it is no longer the only supported path.
4. **Every absence report must be a three-valued fact** — present, absent, or
   unreadable — because the harness hands back an empty list for a structure the
   reader misunderstood, and a service name that was never registered looks
   exactly like a capability that is missing. §3.3 is that failure, made real.
5. **`tool/result` reading for the ledger follows §4's shape**, and the ledger
   reader is part of the tested surface, not incidental plumbing.

---

## 6. Reproducing all of this

```powershell
# 18/18 confirmed facts, exit 0, evidence to reports/ratchet/api-discovery.json
node scripts/probe-dsh-api.mjs --out reports/ratchet/api-discovery.json

# 6/6: spawns a real judge child agent and reads its structured verdict back
node scripts/probe-dsh-api.mjs --probe-judge --out reports/ratchet/api-discovery-judge.json

# 11/11: the ratchet's own review AND ingestion, end to end through production code
node scripts/probe-dsh-api.mjs --ratchet-review --out reports/ratchet/api-discovery-review.json

# 10/10: the ratification quiz against a stub answerer — no model turn, ~4 s
node scripts/probe-dsh-api.mjs --ratchet-ratify --out reports/ratchet/api-discovery-ratify.json

# 3/3: boots the kit's @cc/dsh-ratchet plugin and confirms its tools register
node scripts/probe-dsh-api.mjs --ratchet

# keep the scratch home to inspect the profile, the session log or stderr
node scripts/probe-dsh-api.mjs --keep

# measure a capability against a different bundle set
node scripts/probe-dsh-api.mjs --profile apiprobeweb \
  --bundles "@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app"
```

Requirements: an authenticated `$DSH_HOME/.credentials.yaml` (copied, never
printed), Node ≥ 24, and the pinned harness. The probe exits **1** when a fact is
not confirmed, so it can gate a kit change.

`--probe-judge` and `--ratchet-review` cost one short child turn on the deployment's
flash model and take 3–120 s depending on how long the driving model deliberates
before calling the tool. `--ratchet-ratify` costs no model turn beyond the one that
calls the probe tool: its questions are answered in-process by the stub answerer, and
the whole run takes about 4 s.

## Appendix — environment

| Fact | Value |
|---|---|
| Harness CLI | `@deepseek-ai/dsh@0.1.5-rc.1` at `%APPDATA%\npm` |
| Harness packages | `@deepseek-ai/dsh-*@0.1.5-rc.2` (resolved by the `^0.1.5-rc.1` ranges) |
| Node / pnpm | v24.21.0 / 12.4.1 via corepack |
| Live `DSH_HOME` | `C:\Users\1\.dsh` (never written by the probe) |
| Scratch home | `%TEMP%\dsh-api-probe-<profile>` (removed unless `--keep`) |
| Scratch bundles | `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-headless` |
| Model used by the probe runs | `deepseek-flash` (the deployment's flash-only policy) |
