# Ratchet v2 — module contracts and technical design

**Written:** 2026-09-13 · **Supersedes nothing** · **Status:** static layer built and
tested; dynamic layer contract specified, not yet built.

**How to read this.** This document fixes the *contracts between modules*: what
each module owns, what it may not know about, and what an implementation must keep
true for the tests to mean anything. It is deliberately not a description of the
code — the inline `PURPOSE/INPUTS/OUTPUTS/KEYWORDS` blocks next to each function are
the per-unit answer, and duplicating them here would create a second copy that
drifts. What lives here is the reasoning a reader cannot recover from any single
file: why the boundaries are where they are, what was rejected, and what is still
unproven.

Measured harness facts this design rests on are in `docs/RATCHET-API-FACTS.md` and
are re-runnable with `node scripts/probe-dsh-api.mjs`. Where a design choice depends
on one of them, the fact is cited by section.

---

## 1. What is built, and what that proves

| Artifact | State | Evidence |
|---|---|---|
| `plugins/ratchet/ratchet-schema.mjs` | built | 25 tests |
| `plugins/ratchet/ratchet-compiler.mjs` | built | 24 tests |
| `plugins/ratchet/ratchet-verifier.mjs` | built | 22 tests |
| `plugins/ratchet/ratchet-state.mjs` | built — reports, state, ledger, drift | 7 tests |
| `plugins/ratchet/ratchet-bootstrap.mjs` | built | 2 tests |
| `plugins/ratchet/ratchet-ops.mjs` | built — the four operations plus review | covered via the gate and review tests |
| `plugins/ratchet/ratchet-dynamic.mjs` | built — bundle, six prompts, parsing, strict validation | 21 tests |
| `plugins/ratchet/ratchet-cli.mjs` | built — **the enforcement point**, plus `review` | 8 gate tests incl. 4 falsification cases |
| `plugins/ratchet/ratchet-tools.mjs` | built, boots in a live profile | `node scripts/probe-dsh-api.mjs --ratchet` → 3/3 |
| dynamic review, end to end | built — a real judge reviewed a real fixture | `--ratchet-review` → **6/6** |
| `scripts/test-ratchet.mjs` | **120 tests, 0 failures** | `node --test scripts/test-ratchet.mjs` (~1.8 s) |

The static layer is complete and gated by a command that exits non-zero. The
dynamic layer is built, tested without a harness, and proven end to end through
its production code path.

---

## 2. Module boundaries

```
                    ┌─────────────────────────────┐
                    │  ratchet-schema.mjs         │  identity + well-formedness
                    │  one file, the manifest     │  no relations, no code
                    └──────────────┬──────────────┘
                                   │ records + problems
                    ┌──────────────▼──────────────┐
                    │  ratchet-compiler.mjs       │  relations + authority
                    │  the corpus → a spec bundle │  no code, no model
                    └──────────────┬──────────────┘
                                   │ bundle + reviewRequired
                    ┌──────────────▼──────────────┐
                    │  ratchet-verifier.mjs       │  bundle + code → problems
                    │  deterministic, no model    │
                    └──────────────┬──────────────┘
                                   │ problems
                    ┌──────────────▼──────────────┐
                    │  ratchet-state.mjs          │  reports, state, ledger
                    │  artifacts + drift          │  no judgement of meaning
                    └──────────────┬──────────────┘
                                   │ persisted evidence
                    ┌──────────────▼──────────────┐
                    │  ratchet-dynamic.mjs        │  the only module that
                    │  prompts + validation       │  composes model input
                    └──────────────┬──────────────┘
                                   │ prompt + verdict schema
                    ┌──────────────▼──────────────┐
                    │  ratchet-ratify.mjs         │  consent: the quiz, the
                    │  questions + derivation     │  answer, the bound hash
                    └──────────────┬──────────────┘
                                   │ quiz, then an approval record
                    ┌──────────────▼──────────────┐
                    │  ratchet-ops.mjs            │  the operations
                    │  status/compile/verify/     │  no harness, no model client
                    │  bootstrap/review/ratify    │  judge AND human are INJECTED
                    └───────┬──────────────┬──────┘
                            │              │
        ┌───────────────────▼──┐      ┌────▼──────────────────────┐
        │  ratchet-tools.mjs   │      │  ratchet-cli.mjs          │
        │  harness adapter     │      │  the shell gate           │
        │  spawns the judge,   │      │  never spawns a judge,    │
        │  asks the human      │      │  never mints a consent    │
        └──────────────────────┘      └───────────────────────────┘
```

The arrows are one-way and the dependency rule is absolute: **a module never
imports one that sits below it in this picture, and only `ratchet-tools.mjs`
imports the harness.**

Two consequences make the rule worth keeping. The static layer is testable by
running Node — 248 tests in about 4 s with no harness, no credentials and no model.
And the *judge* is injected into `ratchet-ops.review` while the *human channel* is
injected into `ratchet-ops.ratifyInteractively`, which is what lets both paths run
under a two-line fake in a test and under a real child agent or a real question
channel in production without either knowing about the other.

The other consequence is honesty: if `ratchet-verifier.mjs` could import a model
client, the temptation to "just ask" about a check it cannot decide would
eventually win, and the gate would stop being deterministic.

### 2.1 What each module may NOT know

| Module | Must not know about |
|---|---|
| `ratchet-schema.mjs` | other ADRs, supersession, authority policy, the codebase, the harness |
| `ratchet-compiler.mjs` | the codebase, the harness, any model |
| `ratchet-verifier.mjs` | where laws came from — it receives a bundle, not a corpus |
| `ratchet-state.mjs` | whether a law is *right* — it records what happened, never judges it |
| `ratchet-dynamic.mjs` | the filesystem, the harness, the subagents runtime — it receives text |
| `ratchet-ratify.mjs` | the harness, the question channel, any model — it builds questions as plain data and derives decisions from plain answers |
| `ratchet-ops.mjs` | the harness, the subagents runtime, the question channel, any model client — it receives `spawnJudge` and `askHuman` |
| `ratchet-tools.mjs` | how any of it works — it resolves a root, finds the two channels, and shapes a response |
| `ratchet-cli.mjs` | anything beyond parsing argv, calling ops, and choosing an exit code |

The verifier's ignorance of provenance is load-bearing: it means a law can be
tested by handing the verifier a synthetic bundle (the test suite does exactly
that for the unimplemented-check case), and it means a compromised or buggy
compiler cannot make the verifier lenient.

---

## 3. Contracts

### 3.1 `ratchet-schema.mjs` — identity and well-formedness

**Owns:** the problem-code vocabulary, ADR frontmatter parsing, filename identity,
section requirements, manifest and zone configuration, the zone↔path resolver, the
source hash.

**Returns:** `{ record, problems }` from `parseAdr`, where `record` is `null` only
when the file declares no id at all. A file that parses but breaks a rule returns
**both** — because the compiler must still reason about the corpus while the gate
fails, and the two disagreeing about what exists is a defect.

**Three rules that are not negotiable, each fixing a reproduced predecessor defect:**

1. Identity comes from frontmatter `id`, and the filename must agree. The
   predecessor took `filename.slice(0, 4)`, so `README.md` became decision `READ`
   — test `schema: a filename that is not NNNN-slug.adr.md is ADR_FILE_INVALID`.
2. Supersession is a declared list, never prose. The predecessor regex-matched
   `## Status`, so `Superseded by 3` silently failed to retire anything.
3. Absent, empty and unreadable are three distinct codes (`DIR_MISSING`,
   `NO_VALID_ADRS`, `DIR_UNREADABLE`). The predecessor returned `problems: []` for
   a missing directory, which reads as "nothing wrong".

**Frontmatter parser.** A recursive block reader over indentation, supporting
nested mappings, sequences of scalars, and sequences of mappings nested four deep
(`laws` → law → `checks` → check → `patterns`). It is not a YAML engine: anything
outside that subset is reported as `ADR_FRONTMATTER_INVALID` rather than guessed.
The first implementation passed a guessed child indent and collapsed every nested
value to empty; the contract is now explicit — **a child block discovers its own
indent from its own first line**.

### 3.2 `ratchet-compiler.mjs` — relations and authority

**Owns:** reading the corpus, supersession graph validation, the active-set
resolution, authority enforcement, law compilation, the bundle hash, spec
rendering.

**The authority model, exactly.** A record is in force when its status is `active`,
or when it is `proposed` and a **human-authored** `approval` ADR names it in
`approves`. An approved ADR keeps its own author authority — the approval changes
whether the decision is in force, never who made it. An agent-authored approval
ADR is rejected (`ADR_AGENT_REQUIRES_APPROVAL`) and activates nothing.

Zone policy governs a decision; **a record that declares no zone falls under the
manifest default**, so an unzoned agent decision cannot escape regulation by
staying unzoned. `humanOnly` + agent + in force → `ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE`.
`proposeOnly` + agent + self-declared `active` → `ADR_AGENT_REQUIRES_APPROVAL`.

**Collisions are reported, never resolved.** A duplicate law id with different
statements is `LAW_CONFLICT` **and the contested law is removed from the bundle**.
Removal is the non-obvious half: leaving the first declaration in place made the
bundle hash depend on ADR file order, so a conflicted project could obtain two
different "current laws" by renaming a file.

Two records declaring one law id, one statement and different checks is **not** a
provable conflict — whether two check sets are compatible is a question about
intent — so it becomes a `reviewRequired` entry for the dynamic layer. That
distinction is the compiler's central discipline: **decide what is provable, hand
the rest on, and never silently drop.**

**Hash contract.** `bundleHash` covers laws, statements, checks, zones, authority
and provenance, and nothing else. Report timestamps, file order and formatting are
excluded, so the hash changes when what the ratchet enforces changes and not
otherwise. `specFileMatches` compares generated text to disk after line-ending
normalisation, which is what makes `SPEC_HASH_MISMATCH` a statement about a human
edit rather than about a checkout.

### 3.3 `ratchet-verifier.mjs` — the gate

**Owns:** the file walk, glob semantics, every check type, dependency-manifest
reading, the verification report.

**Two rules, written to be hard to get wrong because the failure mode is silence:**

1. **A check that cannot be evaluated is a problem, not a pass.** An unimplemented
   check type reports `DYNAMIC_REVIEW_REQUIRED` with the words "NOT evaluated". A
   `required_text` whose `paths` match no file reports that nothing was searched.
   A dependency law in a project with no manifest at all reports that nothing was
   searched. An empty bundle reports `NO_VALID_ADRS`.
2. **Every result names what it looked at** — the law, the decision that produced
   it, the file, and the line where one exists.

**`path_boundary` semantics, settled.** `deny` globs are repository-relative and are
matched against files the zone owns. The consequence is that a deny which cannot
overlap its zone can never fire — the design brief's own example (`zone: auth`,
`deny: src/legacy/**`) is such a case — so it is reported rather than left inert.
Shipping a restriction that reads as a restriction while matching nothing is the
exact class of defect this subsystem exists to remove, and it would be perverse to
introduce one in the verifier.

**Why `node_modules` and friends are never walked:** a dependency check reading
`node_modules` would report the ecosystem's choices as the project's, and a text
check would report a stale build artifact. Tested: `verifier: dependency checks
never read node_modules`.

### 3.4 `ratchet-tools.mjs` — the harness adapter

**Owns:** project-root resolution from the session workspace, the seven tool
declarations, bootstrap generation and application, and nothing else.

Seven tools: `ratchet_status`, `ratchet_bootstrap`, `ratchet_compile`,
`ratchet_verify`, `ratchet_review`, `ratchet_ingest_source` and `ratchet_ratify`.
`ratchet_verify` compiles first and refuses to verify against a bundle the corpus
no longer produces — judging code by a law nobody currently decides is worse than
not judging it.

`inject: ['tools']` is the entire declared dependency. The subagent runtime, the
user-questions channel and the agent registry are resolved opportunistically at call
time through `ctx.get`, never injected: declaring a service a composition does not
mount fails the whole boot, so a row that injects them would be a plugin that cannot
be mounted on the base bundle. A deployment that mounts only the base bundle can
therefore compile, verify and bootstrap; it loses the judge, the question channel and
the human quiz, and each of those paths says which capability is missing instead of
failing (API facts §2.3, §2.5).

Every tool is a `defineTool` declaration. This is not style: a definition
registered directly is validated as raw JSON Schema, and a zero-argument tool
whose parameter root lacks a `type` makes the provider reject the **entire
request** with `Invalid schema for function …` (API facts §3.2).

`ratchet_bootstrap` exists because of the predecessor's first defect — inert until
a manifest exists, which is precisely when an agent needs it. It generates a plan
as data so preview and apply share one code path, and `bootstrapApply` never
overwrites: every skipped path is reported.

---

### 3.5 `ratchet-ratify.mjs` — consent

| Function | Job |
|---|---|
| `ratificationQueue` | which decisions wait for a human, with the text and content hash a "yes" would cover — and which cannot be ratified at all, with the reason |
| `buildQuiz` | the questions as PLAIN DATA: one per waiting record, its own file text as the detail, exactly two options, and a `roles` map that makes derivation a lookup |
| `deriveDecisions` | a selected label equal to the question's approve label is an approval, equal to its reject label is a rejection, and everything else is unreadable with what actually arrived |
| `renderTranscript` | the questions asked and the answers received, uninterpreted, as the source the approval cites |
| `renderApprovalAdr` | the `type: approval` record: `approves`, plus a `ratification` block with the channel, the time, the asker and one content hash per approved record |
| `writeRatification` | both artifacts, transcript first, refusing to overwrite either |
| `renderScalar`, `checkIsRenderable` | the subset of values the frontmatter format can hold without changing them, shared with ingestion |

Three properties are the contract:

**The quiz is data, not a call.** `buildQuiz` returns exactly the payload the
harness user-questions seam accepts and nothing else — no private fields, because
anything else would have to survive the wire — and the caller passes it on. That is
what lets the whole consent path be tested with a literal answer object and probed
against a real channel without changing a line.

**Derivation is exact and nothing else counts.** There is no fuzzy matching, no
"probably a yes", and no reading of free text. An unreadable answer is re-asked once
in a differently shaped question — the second attempt names the decision in its
labels and carries the previous answer — and after that the answer is reported as
unenforceable and nothing is minted. A machine that keeps rephrasing a question
until it gets the answer it expected has stopped asking.

**The consent covers a text.** Every approved record is hashed as it stood when the
question was asked, and the compiler honours the approval only while the file still
hashes to that value. The transcript holds the questions and answers; the record
holds the hash; together they make "the human read this and said yes" checkable
rather than asserted.

---

## 4. Problem codes

The vocabulary in `PROBLEM_CODES` is closed and stable. A caller branches on the
code, so **adding a code is compatible and renaming one is not**. The table also
serves as an enforcement point: a code emitted but absent from the table is a
defect, and that is checkable.

Codes are grouped by the question they answer:

| Group | Codes |
|---|---|
| Manifest and configuration | `MANIFEST_MISSING`, `MANIFEST_INVALID`, `RATCHET_DISABLED`, `ZONE_INVALID`, `ZONE_PATH_INVALID`, `ZONE_OVERLAP` |
| Directory state | `DIR_MISSING`, `DIR_NOT_A_DIRECTORY`, `DIR_UNREADABLE`, `NO_VALID_ADRS` |
| One ADR | `ADR_FILE_INVALID`, `ADR_UNREADABLE`, `ADR_FRONTMATTER_MISSING`, `ADR_FRONTMATTER_INVALID`, `ADR_FIELD_MISSING`, `ADR_FIELD_INVALID`, `ADR_ID_MISMATCH`, `ADR_ID_DUPLICATE`, `ADR_SECTION_MISSING`, `ADR_MISSING_REASONING`, `ADR_SOURCE_MISSING`, `ADR_SOURCE_HASH_MISMATCH`, `ADR_SOURCE_HASH_FORM` |
| Relations and authority | `ADR_SUPERSEDES_DANGLING`, `ADR_SUPERSEDES_CYCLE`, `ADR_SUPERSEDES_SELF`, `ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE`, `ADR_AGENT_REQUIRES_APPROVAL`, `APPROVAL_TARGET_UNKNOWN` |
| Consent | `RATIFICATION_UNPROVEN`, `RATIFICATION_STALE` |
| Laws | `LAW_DUPLICATE`, `LAW_CONFLICT`, `LAW_ZONE_MISSING`, `LAW_TARGET_DANGLING`, `LAW_UNCHECKED` |
| Specs | `SPEC_HASH_MISMATCH`, `SPEC_OUT_OF_DATE` |
| Code | `CODE_REQUIRED_FILE_MISSING`, `CODE_FORBIDDEN_FILE_PRESENT`, `CODE_REQUIRED_GLOB_MISSING`, `CODE_FORBIDDEN_GLOB_PRESENT`, `CODE_REQUIRED_DEPENDENCY_MISSING`, `CODE_FORBIDDEN_DEPENDENCY_PRESENT`, `CODE_REQUIRED_TEXT_MISSING`, `CODE_TEXT_FORBIDDEN_PRESENT`, `CODE_COMMAND_FAILED`, `CODE_COMMAND_OUTPUT_MISMATCH` |
| Process | `VERIFY_NOT_RUN`, `DYNAMIC_REVIEW_REQUIRED` |

Two codes are declared and not yet emitted: none. `ADR_SOURCE_MISSING`,
`ADR_SOURCE_HASH_MISMATCH`, `SPEC_HASH_MISMATCH`, `SPEC_OUT_OF_DATE` and
`VERIFY_NOT_RUN` all have emitters and appear in the gate tests.

Three of the consent-and-enforcement additions are worth their own line, because
each replaced a rule that read as enforced and was not:

- **`RATIFICATION_UNPROVEN`** — an approval ADR with no well-formed `ratification`
  block, or one that does not cover a decision it names. Before the block existed,
  an approval ADR activated a decision outright and any file could be one.
- **`RATIFICATION_STALE`** — the decision changed after it was approved. The old
  model approved a title and inherited every later revision of the file.
- **`LAW_UNCHECKED`** — a law in force with no check and no stated reason. Silence
  used to read as "nothing to check here", which is the exemption no longer passes;
  `unenforced: <why>` is the explicit form and is accepted, because a claim a reader
  can weigh is different from a claim nobody made.
- **`CODE_COMMAND_FAILED` / `CODE_COMMAND_OUTPUT_MISMATCH`** — a command check that
  exited non-zero, and one that exited zero without printing what the law says it
  prints. Both used to be reported as `CODE_REQUIRED_TEXT_MISSING`, which sent the
  reader looking for a text check that did not exist.

`LAWS_NONE` is separate from `NO_VALID_ADRS` on purpose, and the distinction is a
correction the kit's own dogfooding produced. A decisions directory with no ADR is
unusable (exit `2`); a corpus where every record parses but none is in force — all
proposed, rejected or withdrawn — is a readable project with nothing enforced, which
is a finding (exit `1`). Collapsing them sent the reader to look for a broken file
when the answer was "that proposal is not approved yet", which is exactly what
happened when the kit's own six ADRs were all agent-authored and `proposed`.

---

## 5. The dynamic layer (`ratchet-dynamic.mjs`)

### 5.1 What it is for

Six jobs, in the design's own order: ingest a raw source into a proposed ADR;
review a proposed decision; review a proposed code change; explain why a violation
matters; detect the semantic conflicts static checks cannot prove; support a
grilling session.

### 5.2 The capability is proven

`node scripts/probe-dsh-api.mjs --probe-judge` → **6/6**, exit 0. A plugin
declaring `inject: ['tools', 'subagents']` called
`ctx.subagents.start('spawn', { label, prompt, parent, signal, outputSchema })`, and
`run.result` resolved with `stopReason: 'completed'` in 1.5–6.5 s.

Four properties of that result shape the contract:

- **A requested `outputSchema` is honoured — when the prompt asks for JSON and
  nothing else.** With a prompt demanding a bare JSON object the child returned
  `structured: {verdict: 'ok', reason: 'RATCHET_JUDGE_OK'}`. Without that
  instruction the same request came back `stopReason: 'error'` with
  `structured: null` and the correct text in `output`, because the capture parses
  what the child says and a helpful sentence is not JSON.
- **Read `structured`, fall back to `output`.** The two legs are measured
  separately for that reason. A judge whose verdict is correct but whose capture
  failed must not be read as a failed review, and a `structured` field assumed
  present is how a review silently returns nothing.
- **`start` needs a parent `Agent`**, which a tool body has as `exec.agent` and
  nothing else does. The judge must therefore be spawned from a tool body.
- **`dispose()` is mandatory.** The run contract requires it to reach quiescence;
  skipping it on the cancellation path leaks the work being cancelled.

This is also a lesson about probes: the first version of the judge probe asserted
the structured branch unconditionally and **passed while `structured` was null**.
A check that cannot fail is not a check, which is why the assertion is now the
disjunction the behaviour actually supports.

### 5.3 What is built

`ratchet-dynamic.mjs` is implemented, and its most important function is the one
that distrusts. The pieces:

| Function | Job |
|---|---|
| `renderStableContext` | the corpus, zones and authority rule as the cacheable prefix |
| `buildContextBundle` | stable and volatile as **separate strings**, plus what material is missing |
| `renderReviewPrompt` | one prompt per job, with that job's own output contract |
| `parseVerdict` | reads an answer from `structured`, plain JSON, a fence, or embedded text |
| `validateVerdict` | **re-checks every citation against the laws that exist** |
| `validateAgenda` | the same distrust applied to a grilling agenda |
| `degradeToSelfReview` | the prompt plus the note, when no judge can be spawned |
| `buildReviewReport` | the report, well formed even when the answer was unusable |

Six jobs: `review_corpus`, `review_change`, `review_proposal`, `review_conflict`,
`explain_violation`, `grill_preparation`. Five answer with a verdict; the sixth
answers with an agenda, and the format instruction is the job's own — a judge sent
the verdict contract where questions were wanted returns findings, because the format
is what it actually answers. An agenda with no questions is reported rather than
accepted: it looks like completed preparation while asking the human nothing.

A job whose material is missing is **not asked** — the call reports what is missing,
because asking anyway invites the judge to invent the absent half.

**Validation is the load-bearing part.** A model asked to review will sometimes cite
a law that does not exist or return a `kind` outside the vocabulary. A finding that
fails a reference check is reported as unusable rather than dropped: a discarded
hallucination and a missed real finding look identical to the reader otherwise. Two
falsification tests cover it — one asserts a fabricated `lawId` is not forwarded,
another covers a nonexistent `sourceAdr` and an unknown `kind`.

A finding with **no** citation is accepted. Not every real problem has a law to point
at, and requiring one would push a judge into inventing a citation to satisfy the
format. The live probe asserted otherwise on its first run and had to be corrected:
the judge emitted one finding with a law id and one without, which is the designed
behaviour.

### 5.4 Ingestion — `ratchet-ingest.mjs`

The front door. A grilling transcript is not a decision record, and asking a human to
write frontmatter is how a project ends up with none, so a judge reads the source and
proposes the structured parts. Two things a model cannot be trusted to do are done
here instead:

**Provenance is checked, not asserted.** Every claim the judge makes about *why* a
decision is right carries a `basis`: the sentence from the source it came from. That
sentence is looked for in the source text, verbatim — whitespace and case folded, and
a fragment of a longer sentence accepted, so reformatting is not mistaken for
fabrication. A justification that appears nowhere in the source means the record is
refused, because a plausible explanation the source does not contain is exactly the
fabricated rationale this subsystem exists to prevent.

**Refusal is a result.** A source that states a decision without stating why returns
`INSUFFICIENT_REASONING` naming what is missing. That is the honest answer — it means
the reasoning needs capturing — and it is "never invent reasoning" made operational
rather than aspirational.

Four further properties:

- **Nothing is written unless asked.** `ingest` returns the record text; `write: true`
  places it. A generator that writes as it generates cannot be reviewed.
- **A generated record is always `proposed` and agent-authored**, whatever the judge
  said. A generator that could emit `active` would be an agent activating its own
  decision.
- **Generation is not finished until the record parses.** The generated text runs
  through `parseAdr` — the same rule set a written record faces — before it is
  offered, so a malformed proposal cannot exist on disk even briefly.
- **Re-ingesting a recorded decision is refused** with `ALREADY_RECORDED`. Two records
  for one decision compile perfectly, both laws agree, and nothing else would ever
  report the duplication. The check matches on the title's slug rather than the id, so
  it is about the decision rather than the file.

#### Derived checks, and the enforcement gap

A record ingested before this had `checks: []` and said nothing about it, so a law it
created read as enforced while nothing checked it. The judge now derives checks from
the source, and every derived check carries a `basis` — the sentence that requires
it — which is looked for in the source verbatim, exactly as the reasoning is. A
check whose basis is not there is **dropped and reported**, never recorded: an
invented check is worse than a missing one, because it fails a build over a decision
the project never took. A check the ratchet cannot evaluate (an unknown type, a
missing required field, a field the record format cannot hold without changing it) is
dropped the same way, with the reason kept, rather than repaired by guessing what the
judge meant.

A law nothing can check is recorded as `unenforced: <why>`, with its own quoted
basis, and the verifier accepts that. A law that says nothing is `LAW_UNCHECKED`.
The distinction is the point: an explicit admission is a claim a reader can weigh,
and silence was an exemption nobody granted.

#### The submit path

`ratchet_ingest_source` takes an `ingest` argument: a result the caller produced
itself. It goes through the same parser, the same `validateIngest`, and the same
provenance checks as a spawned judge's — which is what turns the degraded case (a
session with no subagents runtime) from a dead end into a slower path. The operation
that returns the prompt now also returns `submitHint`, naming the argument that
files an answer.

### 5.5 The dynamic layer, measured

`node scripts/probe-dsh-api.mjs --ratchet-review` → **11/11**. The probe imports the
production modules and drives them against a fixture ratchet project: a review of a
change that contradicts a law, and an ingestion of a second source into a new record.
Both spawn a real judge child agent.

| Job | Round trip, judge spawn included |
|---|---|
| `review_change` over a two-law corpus | **6.8–8.8 s** |
| ingestion of a six-line source, two laws produced | **7.7–14.4 s** |

The spread is model deliberation, not plumbing: the same fixture produced 6.8 s and
8.8 s on consecutive runs. For scale, one review over a two-law corpus costs about
8 s, so a session reviewing a dozen changes pays roughly 1.5 minutes of judge time.
That is acceptable for a pre-merge advisory step, and it is the reason review is a
tool the agent chooses rather than something wired into every edit.

The ingested record, quoted from the run, is the honest summary of what the layer
produces:

```markdown
title: Move background job retries to exponential backoff with a dead-letter queue
status: proposed
author: { authority: agent, name: ratchet-ingest }
zones: [jobs]
laws:
  - jobs.retry.exponential-backoff
  - jobs.failure.dead-letter-queue
## Reasoning
Immediate retries during an outage burn the attempts before the dependency recovers,
and a dead-letter queue makes the failure visible instead of losing it.
```

Every clause of that reasoning is in the source. The judge chose the zone that fits
rather than the only zone available — on the first run the fixture declared one narrow
zone, the judge correctly declined to put a background-jobs decision in it, and the
guard reported `LAW_ZONE_MISSING`. That was a thin fixture rather than a defect, and
the fix was to give the fixture a second honest zone.

### 5.6 The seam, proven end to end

**The judge is injected, never reached for.** `ratchet-ops` receives
`spawnJudge` as a parameter, so the module never imports the harness, "no judge
available" is a value a caller passes rather than a failure found deep in a call
stack, and the whole review path is testable with a two-line fake. Only
`ratchet-tools.mjs` reaches `ctx.get('subagents')`, opportunistically at call
time — never through `inject`, because declaring a service a composition does not
mount fails the entire boot (API facts §3.3).

### 5.7 Advisory by construction

`exitCodeForReview()` returns `0` unconditionally, and there is a test asserting
that `ratchet review` exits 0 even when no judge ran. The CLI description says so
too, because a reader who assumes a review can fail a build will wire it into CI
and then learn to re-run it.

The CLI never spawns a judge: a shell has no agent to parent one with, and the
runtime refuses `start` without a parent. So `ratchet review` always takes the
degraded path and prints the prompt — which is the useful thing a script can have —
while `ratchet_review` is the tool that spawns.

### 5.8 Degraded mode

When `ctx.get('subagents')` is `undefined`, or the call has no agent to parent
with, the review returns the prompt plus a note explaining that the ratchet could
not spawn its own judge, and a `nextStep` telling the caller to answer it and file
the verdict through `ratchet_review` with `verdict`. A self-review is validated
**exactly** like a spawned judge's, because the argument for checking a model's
output applies at least as strongly to output it wrote by hand.

### 5.9 Ratification — the human, asked properly

The ratchet compiled agent-authored decisions into laws without ever asking the
human, and its refusal was only a report: a record that declared itself
`status: active` in a `proposeOnly` zone was listed as a problem *and* enforced
anyway. The gate told the reader the decision had no authority and then checked the
code against it. The deeper problem is that a file cannot prove who wrote it — an
agent can write `authority: human` into an ADR, and no reader can tell that from a
decision a human typed.

A decision now enters force only through a consent **recorded against the exact text
that was approved**:

1. `ratchet_ratify` collects what waits (`ratchet pending` prints the same list from
   a shell, read-only).
2. It asks the human through the harness user-questions channel: one question per
   record, `detail` set to that record's own file text, two options.
3. The answer is derived from the selected label by exact comparison. Anything else
   is unreadable, mints nothing, and is re-asked once in a different shape.
4. An approval is written as an ADR of `type: approval` carrying a `ratification`
   block — channel, time, asker, and one content hash per approved record — and the
   transcript becomes the source it cites, so the evidence is hashed like any other
   reasoning.
5. The compiler honours that approval only while each record still hashes to the
   value recorded. Editing an approved decision voids the consent
   (`RATIFICATION_STALE`) instead of inheriting it.
6. The hashes are FROZEN when the question is built, so the consent covers the text
   the human was shown. A record rewritten while the question is open — by another
   session, a subagent, or the user — is refused rather than approved: without that,
   the substitution happens by timing instead of by an edit.
7. Nothing on the tool surface accepts an answer. There is no `answers` argument, and
   the operation refuses an answer it cannot pair with a quiz it built. The first
   version had one, and it was an agent mint with extra steps: an agent could call
   the tool, read the quiz it was handed, type the approve label and mint law.

Two consequences are deliberate. A record the zone does not authorise is no longer
in force: reporting a self-declared active decision while enforcing it was the worst
of both worlds, and the manifest's zone policy is now the thing that decides. And
consent does not transfer authorship, so a ratified agent record still cannot govern
a `humanOnly` zone — a ratification says "this text may be law", not "a human wrote
it".

**Why review keeps its `verdict` argument and consent does not.** `ratchet_review`
accepts a verdict the caller wrote, and that is consistent rather than inconsistent:
a review is ADVISORY, changes no law, and its result says `judge: self`. A consent
changes what the code is checked against, so a caller-composed one would be the
mechanism's own failure mode wearing its artifact. The asymmetry is the rule: an
argument may file an opinion, never a permission.

**What it cannot prove, stated plainly:** a deliberately forged ratification block
is indistinguishable from a real one, because the attacker writes the same fields
this mechanism writes. What the design buys is that the *tool* path cannot produce a
consent without an answer from the human channel, that the gate reports what it
cannot corroborate, and that a reader sees a transcript of the actual questions. The
residual gap is recorded in ADR 0007 and in §6.5 rather than papered over.

### 5.10 The compile trigger — a judgement asked for is made

`compileLaws` marks a question it cannot decide (`reviewRequired`: two records
declaring one law id and statement with different check sets) and does not choose
between them. Until this wiring existed, the mark was recorded and nothing acted on
it: a report saying "somebody should judge this" and no judgement. `ratchet_compile`
now runs the corpus review itself and returns its findings under `dynamicReview`,
with three refusals reported rather than passed over — the caller passed
`review: false`, the composition has no judge, or the call did not come from a live
root agent. The third is the recursion guard: a spawned judge is a full agent, so a
judge that ran `ratchet_compile` would otherwise start a review of its own and spawn
another judge, for as long as the models cooperated. The registry knows which agents
are roots; an in-process flag would have been a guess. The review stays advisory: it
never changes the compile verdict, and the CLI never triggers one.

---

## 6. Enforcement points

A rule is real only where something fails when it is broken. This section names,
for every rule the ratchet claims, the thing that fails — and says plainly where
nothing does.

### 6.1 The command

```bash
node plugins/ratchet/ratchet-cli.mjs <status|compile|verify|check|bootstrap|hash> [--root <dir>] [--json]
```

Exit codes, which are the whole point:

| Code | Meaning |
|---|---|
| `0` | the ratchet ran and reported no problems |
| `1` | the ratchet ran and reported problems — **this is the gate failing** |
| `2` | the project or its decisions are unusable, so nothing was checked |
| `3` | usage error |

`2` and `1` are deliberately different. A script that cannot tell "your decisions
do not compile" from "your code violates a decision" retries a misconfiguration
forever or files a real violation as a tooling fault.

The CLI calls the same `ratchet-ops.mjs` functions the model-facing tools call, so
the gate a human runs in CI and the gate an agent runs mid-task cannot disagree
about what "verified" means. An unknown command is exit `3`, never a silent `0`:
a typo in a CI script that exits zero is a disabled gate that reports success.

### 6.2 Check types

Nine filesystem checks, plus three added after the kit's own laws were audited and
found to be checking implementation tokens rather than invariants:

| Type | What it decides |
|---|---|
| `required_file` / `forbidden_file` | a path exists / does not |
| `required_glob` / `forbidden_glob` | a glob matches something / nothing |
| `required_text` / `forbidden_text` | text within an explicit path list |
| `required_text_glob` / `forbidden_text_glob` | text over a **glob set with `!` exclusions** |
| `required_file_in_list` | a value appears in a JSON array addressed by key path |
| `required_dependency` / `forbidden_dependency` | a declared dependency is present / absent |
| `path_boundary` | files a zone owns do not match a denied glob |
| `command` | **a command exits zero, and prints what the law says it prints** |

A `command` check may also assert on OUTPUT: `outputContains` and `outputNotContains`
(literal, case-sensitive) and `outputMatches` (a regular expression), read from
stdout+stderr together unless `stream` narrows it, tested as one string exactly as the
process wrote it. The gap this closes is that an exit code is a weak claim — a law
saying "the report names the law it judged" was satisfied by a command that printed
nothing at all. `outputMatches` and the text check patterns are compiled at COMPILE
time, so an unusable pattern is a problem with the decision on every machine rather
than an exception thrown in the middle of one verification. A text check with no
pattern is refused outright: `new RegExp(undefined)` is the empty expression, which
matches every file, so such a law reported itself satisfied whatever the code said.

The three additions came from a specific failure. Every law in the kit's first six ADRs
was a `required_text` check on an implementation token — `renameSync`, `spawnJudge`,
`evaluatedSpecHash` — so "a report is written through a temporary file and renamed into
place" was checked by *the string `renameSync` appearing in a file*. That is a
regression guard against deleting an API, not a test of atomicity, and the tests that
actually verify the invariants live in `test-ratchet.mjs`, which no law mentioned.

The strengthened laws now say what they mean:

| Law | Before | After |
|---|---|---|
| no harness import in logic modules | seven named paths | a glob with `!` exclusions, so a module written later is covered |
| tools use `defineTool` | the string `defineTool(` | the test that inspects every registered definition |
| problem codes are declared | the table exists | the test that scans every emit site |
| writes are atomic | the string `renameSync` | the test that a report reaches a reader whole |

**`command` is the escape hatch, and it is opt-in.** It is the only check that starts a
process: it runs only when the caller supplies a runner, and without one it reports the
check as **pending** rather than passing. The CLI and CI supply a runner; the tool
surface deliberately does not, so an agent editing files cannot cause processes to
start. The runner uses `execFile` with an argv — never a shell — so a law cannot smuggle
a pipe or a substitution past the reader who approved it, and every run has a timeout.

### 6.3 What fails, per rule

| Rule | What fails when it is broken |
|---|---|
| No decision without reasoning | `ADR_MISSING_REASONING` → compile exit `1` |
| Every decision traces to a raw source | `ADR_SOURCE_MISSING` → compile exit `1` |
| The source still says what the record claims | `ADR_SOURCE_HASH_MISMATCH` → compile exit `1` |
| A decision has one identity | `ADR_ID_MISMATCH`, `ADR_ID_DUPLICATE`, `ADR_FILE_INVALID` |
| Supersession links resolve | `ADR_SUPERSEDES_DANGLING`, `ADR_SUPERSEDES_CYCLE` |
| Agent decisions do not override human ones | `ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE`, `ADR_AGENT_REQUIRES_APPROVAL` — and the record is NOT in force, rather than reported and enforced anyway |
| A decision is law only as the text that was approved | `RATIFICATION_STALE` → compile exit `1`, and the law leaves force |
| An approval shows a human consented | `RATIFICATION_UNPROVEN` → compile exit `1`, and nothing is activated through it |
| A law has an enforcement point, or says why not | `LAW_UNCHECKED` → verify exit `1` |
| A command check asserts what the command printed | `CODE_COMMAND_OUTPUT_MISMATCH` → verify exit `1` |
| The corpus does not contradict itself | `LAW_CONFLICT` → compile exit `1`, contested law removed |
| Generated specs are not hand-edited | `SPEC_HASH_MISMATCH` → verify exit `1` |
| Specs describe the current laws | `SPEC_OUT_OF_DATE` → verify exit `1` |
| The code obeys the laws | the `CODE_*` codes → verify exit `1` |
| A task is not complete until verified | `VERIFY_NOT_RUN` → status exit `1` |
| A check that could not run is not a pass | `DYNAMIC_REVIEW_REQUIRED` with "NOT evaluated" |

### 6.4 Falsification tests

Confirming a check is cheap and unconvincing, because whoever wrote the check already
believed it. `scripts/test-ratchet.mjs` therefore contains tests whose names begin
with `FALSIFICATION:`, tests named `BREAKER:` for the inputs a breaker actually used,
and whose shape is "assert clean, break one thing, assert the gate now fails":

- delete a required file → `CODE_REQUIRED_FILE_MISSING`, and the written report
  names the law and the file;
- hand-edit a generated spec → `SPEC_HASH_MISMATCH`;
- rewrite the reasoning behind a decision → `ADR_SOURCE_HASH_MISMATCH`;
- delete a decision → the project stops looking verified;
- write an approval ADR by hand → `RATIFICATION_UNPROVEN` and no law at all, which
  is the old trust model falsified rather than merely described;
- edit an approved record → `RATIFICATION_STALE`, and the law leaves force;
- let a stale approval name a superseding decision → the live law survives it.

Each asserts the *specific* code, not merely a non-zero exit, because a gate that
fails for the wrong reason is a gate that will pass for the wrong reason.

`scripts/falsify-kit-gate.mjs` runs the same experiment against the kit itself: six
cases, each verified to have actually broken something before the gate runs — the
last two being a hand-written approval ADR, which must mint nothing, and a law
injected with no check and no stated reason, which must be reported `LAW_UNCHECKED`.
It takes about five minutes, because each case runs the whole gate, so it is a
release-gate command (`falsify-gate` in the manifest) rather than something every
verification pays for. Running it leaves the recorded verification pointing at the
last mutated law set — the laws on disk really did change while it ran — so `status`
reports `VERIFY_NOT_RUN` afterwards until the gate is run again.

`scripts/check-gate-invariants.mjs` is the cheap half, and it exists because of a
measured attack on the expensive one. A law enforced by `node --test …` plus
`outputContains: "fail 0"` was satisfied by a GREEN RUN of a suite whose covering test
had been emptied: `fail 0` is a constant of any passing run, including a run of a file
with no tests in it, so the assertion could not tell "the test asserted" from "the test
exists". That script drives the production modules over synthetic projects instead —
a law with no check and no reason must come back `LAW_UNCHECKED`, a check that cannot
fail must be refused at compile, a hand-written approval must mint nothing, the code
hash must move when a file moves — and it fails when any of those verdicts changes.
It is two seconds, it runs inside the gate, and it is named by ADR 0009's laws.

### 6.5 Where nothing enforces anything yet

Stated plainly, because a rule with no enforcement point is an unverified claim:

- **The kit ratchets itself, and its gate passes.** `node plugins/ratchet/ratchet-cli.mjs
  verify --root .` exits 0 over **19 laws in force** from eight decisions plus one approval,
  running 21 declared checks — of which **18 are `command` checks that run 4 distinct
  commands, 14 of them the same `node --test scripts/test-ratchet.mjs`**. That is worth
  stating rather than counting as eighteen independent guarantees: the suite is one wide
  assertion set, so a law whose command is that suite is only as strong as the assertions
  inside it. What closed that gap is `scripts/check-gate-invariants.mjs`, which asserts the
  verdicts behaviourally inside the gate (ADR 0009), plus `check-portability.mjs`,
  `check-consent-surface.mjs` and `check-instruction-routing.mjs`. The manifest's
  `falsify-gate` command runs the full break-the-invariant experiment at release time:
  six cases — a new module importing the harness, an undeclared problem code, a rule
  citing a command nobody declared, a module dropped from its package manifest, a
  hand-written approval ADR, and a law with no check and no reason — each required to turn
  the gate red, and taking about five minutes because every case runs the whole gate.
- **A `command` check is only as strong as the command, and the text assertion is the weak
  part.** The breaker's sharpest case: a law enforced by `node --test …` with
  `outputContains: "fail 0"` passed over a mutation that made a silent law verify clean,
  once the covering test's body was deleted and its name kept — `239 pass / 0 fail`, gate
  green, invariant broken. `fail 0` is a constant of any green run. The fix is ADR 0009's
  behavioural enforcement point, not a stronger string: **the residual limit is that an
  agent editing both the module and the script that checks it still passes.** A
  self-verifying system has no external reference point; all this design buys is that the
  edit is two files, one of them named by a law, instead of one deleted test body.
- **0001 and 0007 are law because a human ratified them, and 0002–0006 are not.** The two
  records governing `shipped-plugins` (where the manifest gives agents `proposeOnly`) were
  put into force by a human answering the quiz, and approval ADR 0008 records that consent
  as one content hash per record; the boundary rule about where the harness may be imported
  is therefore in force. **The other five decisions (0002–0006) are in force on an agent's
  own say-so**, because they bind `kit-tooling`, a zone where the manifest lets an agent
  activate its own record. That is the configured policy, not an accident, and it is the
  honest reading of "seven decisions in force": five of them a human has never seen.
- **A frontmatter word is the whole difference between a decision an agent may make and
  one it may not.** The compiler constrains records whose `authority` is `agent` and
  records whose `type` is `approval`; a record that declares `authority: human`
  self-activates in **any** zone, including `humanOnly`, because nothing verifies who
  wrote the file. Writing that one word is therefore enough to put an agent's own
  decision into force with a green gate, and no check here distinguishes it from a
  record a human actually made. The mitigation is review of the diff, not a mechanism —
  which is why the kit's approval records are read by a human and committed as a pair
  with the record they cover.
- **Two manifest rules are explicitly unenforced.** `flash-only-models` and
  `pin-the-harness` carry `enforcedBy: null` with a `pendingReason` naming the check that
  does not exist yet. `context_rules` reports them as pending rather than enforced, which
  is what the field is for.
- **`requiresDecisionRecord` is enforced by a guard, and no kit zone opts in.**
  `ratchet-guard.mjs` refuses a write into a regulated zone with no decision behind it,
  and 16 tests cover what it refuses, what is exempt and what satisfies it. Every kit
  zone declares `requiresDecisionRecord: false`, so the guard is inert here — the rule
  has an enforcement point and this repository does not use it.
- **Only obvious writes are guarded.** A shell command that edits a regulated file is
  allowed, because guessing would refuse work the guard cannot see. The violation is
  still visible in the diff and to `ratchet verify`; it is not prevented.
- **A `command` check is only as strong as the command.** It runs a script the
  repository owns, so the law proves that *some* command passes; the assertions inside
  that command are where the meaning lives, and nothing forces them to match the law's
  statement. Output assertions and `expects` narrow the gap; they do not close it,
  because a law can still name a command whose assertions do not test what the law says.
- **A forged ratification block is undetectable.** An agent that writes a well-formed
  `ratification` block — right channel, right time, matching hashes — produces a file no
  reader can distinguish from the artifact the quiz writes. The tool path cannot produce
  a consent without an answer from the human channel, and the gate reports what it cannot
  corroborate, but a deliberate forgery is outside what a file-based mechanism can see.
  Key-signing was considered and rejected (see §8).
- **The ratification probe needs credentials and the network.** `node scripts/probe-dsh-api.mjs
  --ratchet-ratify` proves the seam against a real profile, and the kit's `gate`
  verification command does not run it: an offline machine can run every other gate and
  would report this one as a configuration failure rather than a missing fact. It is
  documented as the enforcement point for `consent-travels-the-human-channel` and run by
  hand at each upgrade (COMPAT §1).
- **Law ids carry a zone prefix that no longer matches their binding.** The laws in
  ADRs 0002–0006 are named `shipped-plugins.*` while those records declare
  `zones: [kit-tooling]` — the plugin's own invariants are bound to the tooling zone,
  where an agent may self-activate, rather than to `plugins/**` where the manifest says
  `proposeOnly`. It is reported here rather than silently fixed: renaming a law id is
  removing one law and adding another, and re-binding the records would take eight laws
  out of force until a human ratified them. Both are decisions for the corpus owner.
- **The Part 17 obligation to write an ADR before an architectural decision** is the
  same guard seen from the other side, so it is enforced exactly where a zone opts in
  and nowhere else.
- **An `unenforced` note is checked for shape, not for truth.** The reason must be at
  least 12 characters, which stops `unenforced: "0"` from being an exemption; nothing
  decides whether the reason is HONEST. A law that could be checked and says it cannot
  suppresses `LAW_UNCHECKED` with a sentence a human has to judge.
- **A partially evaluated verification used to pass, and no longer does.** The lesson is
  kept here because the first fix was the wrong shape: `VERIFY_NOTHING_EVALUATED` caught
  only the total case, so a run that evaluated one of three checks and left two pending
  reported `ok: true` to the agent while the CLI on the same tree evaluated all three and
  could be red — two answers to one question, and the optimistic one went to the model.
  Now any pending check makes the verification `VERIFY_INCOMPLETE` and the exit code 1,
  with `detail.evaluated` / `detail.declared` / `detail.pending` naming the arithmetic,
  and `ratchet_status` refuses such a run as "verified". The cost is that the *tool*
  surface can never report a pass for a project whose laws use `command` checks, because
  it deliberately supplies no runner; that is the intended reading — a session can look,
  and only a shell can call it verified.
- **Several rules the breakers falsified are now enforced, and the falsifications are
  the tests.** An empty `pattern` (which compiles to a regex matching every file), a
  `forbidden_text` law over no file, a stateful `g`/`y` flag whose `lastIndex` made a
  verdict depend on file order, a command check with no runner reporting `ok`, a
  problem whose `code` was the process exit status, a check whose `anyOf` was silently
  dropped in the round trip, and a quote that carried an invented sentence behind a
  real one: each has a regression test named for the failure it prevents.
- **The second breaker round found nine more, and each is a `BREAKER:` test.** A
  `forbidden_text_glob` whose exclusions cancelled its includes reported a law satisfied
  over a file that violated it (the three sibling checks already refused this shape, so
  the fix was to make the family consistent); an all-`unenforced` corpus verified `ok`
  with zero checks evaluated while `status` refused to call the same record verified (the
  gate now agrees with the state layer, `VERIFY_NOTHING_EVALUATED`); `required_file_in_list`
  read the list and never the filesystem, so a law saying a module ships was satisfied by a
  manifest naming a file that did not exist; `deny: []` and `pattern: ""` were accepted as
  checks that cannot fail; a `path_boundary` deny beginning `**` was called inert while the
  same code proved it matched a file the zone owned (the overlap test now proves
  disjointness or stays silent); the default command stream joined stdout and stderr, which
  matched patterns across a boundary no stream contains and rejected an anchored pattern
  that exactly matched stdout (assertions now read each stream as written, and a negative
  assertion must hold in both); and a recorded verification bound only the law hash, so a
  green `status` survived arbitrary code edits — it now carries a `codeHash` of the tree it
  judged, and an edit makes it `VERIFY_NOT_RUN`.

---


### 6.6 Spec tracking is opt-in by default

Missing generated documents are only a problem once the project tracks them: any
`*.spec.md` exists under the manifest's specs directory, or the manifest sets
`ratchet.specsRequired: true`. Without that distinction every project adopting the
ratchet fails verification on day one for documents it never asked for, and a gate
that fails on day one is a gate people disable on day two. Deleting a tracked spec
is still `SPEC_OUT_OF_DATE`.

---

## 7. State and evidence

```
reports/ratchet/compile-report.json     written by compile, on success AND failure
reports/ratchet/verify-report.json      written by verify
.dsh/ratchet/specs.json                 the compiled bundle
.dsh/ratchet/state.json                 the spec hash AND code hash the last verification judged
.dsh/ratchet/ledger.jsonl               append-only structured events
docs/specs/<zone>.spec.md               generated documents, with a spec-hash header
```

**The report, not the absence of an exception, decides success.** A run that threw
nothing and wrote no report has not been verified. Every write goes through a
temporary file and a rename: a half-written report is worse than none, because a
reader cannot distinguish "the gate failed" from "the gate was interrupted".

**`state.json` is what makes `VERIFY_NOT_RUN` checkable.** It records the spec hash
the verification judged, so a later reader can tell whether the laws changed since,
**and the code hash of the tree it judged**, so the same reader can tell whether the
code changed. The spec hash alone answered half the question, and the missing half was
measurable: a clean verification followed by an edit to any source file left `status`
reporting a verified, clean project while `verify` on the same tree exited 1 — the CLI
documents `status` as "exit 0 only when verified and clean", and it was the status that
lied. Line endings are normalised before hashing, so a checkout that rewrites CRLF for
LF is the same code, and paths are hashed with the content, so a rename is a change.
The hash costs one walk of the project, which every verification already performs.
It also records `checksEvaluated`, and a verification that evaluated **zero** checks
does not count as verified — a project with no laws "passes" trivially, and
reporting that as verified is precisely the silence this subsystem exists to
remove. That case is a test, as is the gate's agreement with it: a corpus whose laws
all state why nothing can check them now reports `VERIFY_NOTHING_EVALUATED` rather
than `ok`.

**The ledger is append-only JSON Lines** and its writer detects non-lossless
fields. `JSON.stringify` silently *drops* a function, a symbol or an `undefined`
value rather than throwing, so a try/catch alone cannot notice — the writer
round-trips the record and compares keys, because a dropped field is a fact that
quietly never got audited.

**The ledger reader is part of the tested surface.** `tool/result` is not a flat
`{callId, content, isError}`: the durable shape is `data.message.content[]`, one
block per result *in the batch* (API facts §4). A reader that assumes the flat
shape returns zero results while every record is present — a silent-empty bug of
exactly the kind this subsystem exists to catch, and one the kit already hit once.


---

---

## 8. Rejected alternatives

**A `PROBLEM_CODES` entry per check type, one code for "check failed".** Rejected:
an agent acting on a report needs to know *which* check failed, and a generic code
forces it to parse prose.

**Letting the compiler pick a winner among conflicting laws.** Rejected: a
deterministic choice between two incompatible statements is a silent override of
one decision by another, which is the failure the whole authority model exists to
prevent.

**Making the verifier's dependency reader glob for `*.json`.** Rejected: it would
report a lockfile's transitive tree as the project's own declarations. The reader is
driven by the manifest's declared languages and a fixed, documented set of manifest
filenames.

**Moving `path_boundary` deny globs to be zone-relative.** Rejected as a silent
reinterpretation of a declared law — the verifier must not redefine what an author
wrote. Reporting an inert deny leaves the decision with the author.

**Building the dynamic layer before the static one.** Rejected: with no compiled
laws there is nothing for a judge to judge against, and the semantic layer would
have had to invent the law format under time pressure — which is how the
predecessor's prose-matching supersession happened.

**Keeping the Ratchet inside `@cc/dsh-context`.** Rejected by the user, on the
grounds that `context_*` answers questions while the Ratchet enforces answers; the
kit now owns `plugins/ratchet/` as source, mirroring `plugins/kit-rules/`.
`@cc/dsh-context` was later reconstructed into `plugins/dsh-context/` because its
owning project is unreachable and one of its defects (R8: a message citing a file
nothing installs) had no other route to a fix — see that directory's
`SOURCE-NOTICE.md`.

**Minting a consent through `ctx.approval`.** The harness ships a real one-shot,
fail-closed approval seam with an audit pair and a Web client that renders a prompt,
and it was the obvious home for this. It was rejected because the deployment's
permission preset is `danger-full-access`, whose bundled policy is `never`: an
approval request in those sessions is rejected deterministically before any answerer
is consulted, so the mechanism would have been inert exactly where ratification has
to happen. Making it work meant changing the permission preset on every machine, and
the seam carries no tool arguments — the human would see a tool name and a reason
string rather than the record being approved. The quiz was chosen instead because it
shows the text and works under any preset.

**Signing the consent with a key.** A machine-local key the human unlocks closes the
forgery gap completely. Rejected because the key lives on the same machine as the
agent, so the protection reduces to a passphrase prompt, at the cost of key creation,
storage, rotation and recovery on three machines. Recorded here so that the residual
gap in §6.5 is a decision rather than an oversight.

**Letting the shell mint.** `ratchet ratify` was rejected outright: an agent can run a
shell command, which makes a CLI mint an agent mint with extra steps. The CLI can
print what is waiting (`pending`) and nothing else, and there is a test asserting the
verb is a usage error.

**Approving a title instead of a text.** The first shape of the approval record named
the decisions it activated and nothing else, which approves whatever the file says
next — the substitution the whole mechanism exists to prevent. It carries a content
hash per record instead, and an edit voids the consent.

---

## 9. Open questions

Closed since the first draft, recorded so the change is visible rather than quietly
deleted:

- source verification is implemented (§6.2) and spec drift is detected in the gate;
- the enforcement point exists as a CLI with exit codes, with falsification tests
  proving it fails when it should;
- a zero-check verification no longer counts as verified;
- `requiresDecisionRecord` is enforced by a real `tools/pre-execute` guard, with 16
  tests covering what it refuses, what is exempt, and what satisfies it;
- the kit ratchets itself, with **19 laws in force and a passing gate**, and six of its
  invariants falsified by `scripts/falsify-kit-gate.mjs` plus ten verdicts asserted
  behaviourally by `scripts/check-gate-invariants.mjs`;
- `grill_preparation` returns a structured agenda with its own schema and validator;
- ingestion is built, end to end: raw source → validated, compilable proposed ADR,
  with provenance checked rather than asserted (§5.4);
- the dynamic layer's cost is measured (§5.5): ~8 s per `review_change`, ~8–14 s per
  ingestion;
- the kit's laws were audited and rewritten: each now tests its invariant through a
  `command` check rather than searching for an implementation token (§6.2);
- **a decision enters force only through a recorded human consent** (§5.9): the quiz
  runs through the harness user-questions channel, the answer is derived from a
  selected label, the approval carries a content hash per approved record, and the
  seam is proven against a live profile (`--ratchet-ratify`, 10/10);
- **ingested laws carry checks derived from the source** (§5.4), each with a quoted
  basis that is verified, and a law nothing can check says so in `unenforced` or is
  reported `LAW_UNCHECKED`;
- **ingestion has a submit path** for the degraded case, validated exactly like a
  spawned judge's result;
- **a compile that needs judgement runs the review itself** (§5.10), with the
  recursion guard that stops a judge from starting one of its own;
- **a `command` check can assert on output**, not only on an exit code (§6.2).

Still open:

1. **The consent a human gave covers 0001 and 0007, and nothing else.** Approval 0008
   put those two into force with one content hash each; 0002–0006 are in force because the
   `kit-tooling` zone lets an agent activate its own record, and no human has read them.
   Both states are the configured policy, and the difference is worth keeping visible
   rather than describing seven decisions as collectively "approved".
2. **`specsRequired` defaults to false, so spec drift is only checked once a project has
   generated documents.** Deliberate and accepted — a gate that fails on day one for
   files a project never asked for is a gate people disable on day two — but it means a
   project that never runs `compile --write` never learns its specs are absent.
3. **A `command` check's strength is still the command's.** Output assertions and
   `expects` narrow the gap between what a law says and what its command proves; they do
   not close it, because nothing forces a command's own assertions to match the law's
   statement.
4. **A forged ratification block cannot be detected** (§5.9, §6.5). Closing it needs a
   secret the agent cannot read, and every candidate (a key on the same machine, a
   passphrase the agent can prompt for) reduces to a prompt the agent can also raise.
5. **Law ids in ADRs 0002–0006 carry a `shipped-plugins.` prefix while the records are
   bound to the `kit-tooling` zone** (§6.5). Either the ids or the bindings are wrong;
   both fixes are the corpus owner's decision, because renaming an id is removing a law
   and rebinding a record can take laws out of force.
6. **The ratification probe needs credentials and a network**, so the kit's own gate
   cannot run it (§6.5). A future `command` check with a declared precondition would let
   CI run every gate and skip exactly the ones it cannot reach, instead of the reader
   having to know which commands are local.
7. **A one-word forgery of authorship is undetectable** (§6.5). `authority: human` in a
   record's frontmatter is enough to make an agent's decision self-activate in any zone,
   including `humanOnly`, because nothing checks who wrote the file. It is the same class
   of gap as the forged ratification block, and it needs the same kind of answer: a
   secret, or a human reading the diff.
8. **An `unenforced` note is not judged for truth** (§6.5). Nothing distinguishes "this
   cannot be machine-checked" from "I did not want to write a check".
9. **A `command` check's own assertions are not verified by the gate.** ADR 0009 makes the
   kit's invariants fail when the shipped verdicts change, and `check-gate-invariants.mjs`
   is named by a law — but an agent that edits a module and that script together still
   passes. A self-verifying system has no external reference point (§6.5).

---

## 10. Running the evidence

```powershell
# static + dynamic + ingestion + ratification: 248 tests, no harness, no model, ~4 s
node --test scripts/test-ratchet.mjs

# the guard's rule: what requiresDecisionRecord refuses, and what satisfies it
node --test scripts/test-ratchet-guard.mjs

# portability and packaging: 13/13
node scripts/check-portability.mjs

# the consent surface, instruction routing and the gate's own invariants
node scripts/check-consent-surface.mjs              # 7 claims, no harness needed
node scripts/check-instruction-routing.mjs          # 8 claims, no harness needed
node scripts/check-gate-invariants.mjs              # 12 verdicts, asserted behaviourally

# the breaker at release-gate scope: 6 invariants, ~5 minutes
node scripts/falsify-kit-gate.mjs

# the kit's own gate: 19 laws in force, 21 checks (18 of them command checks), ~50 s
node plugins/ratchet/ratchet-cli.mjs verify --root .

# and that the gate FAILS when an invariant is broken: 6/6 cases
node scripts/falsify-kit-gate.mjs

# harness facts, 18/18
node scripts/probe-dsh-api.mjs --out reports/ratchet/api-discovery.json

# dynamic capability, 6/6 — spawns a real judge child agent
node scripts/probe-dsh-api.mjs --probe-judge --out reports/ratchet/api-discovery-judge.json

# the dynamic layer end to end through its production code: review AND ingestion, 11/11
node scripts/probe-dsh-api.mjs --ratchet-review --out reports/ratchet/api-discovery-review.json

# the consent seam end to end through its production code: 10/10, no model turn
node scripts/probe-dsh-api.mjs --ratchet-ratify --out reports/ratchet/api-discovery-ratify.json

# the shipped plugin boots and registers its tools, 3/3
node scripts/probe-dsh-api.mjs --ratchet

# the gate itself, by hand
node plugins/ratchet/ratchet-cli.mjs status --root <project>
node plugins/ratchet/ratchet-cli.mjs verify --root <project>   # exit 0 clean, 1 problems, 2 unusable
node plugins/ratchet/ratchet-cli.mjs compile --root <project> --write
node plugins/ratchet/ratchet-cli.mjs pending --root <project>  # what waits for a human, read-only
node plugins/ratchet/ratchet-cli.mjs review --root <project> --job review_change --change <file>
node plugins/ratchet/ratchet-cli.mjs review --root <project> --job grill_preparation --change <file>
node plugins/ratchet/ratchet-cli.mjs ingest <source-file>        # prepare a record (add --write to place it)
node plugins/ratchet/ratchet-cli.mjs hash <source-file>
```

There is deliberately no `ratchet ratify`: a shell cannot ask a human anything, and an
agent can run a shell command, so a CLI mint would be an agent mint with extra steps.
Ratification happens in a session through `ratchet_ratify`, and `pending` is what a
shell gets.

The ratchet gates are also wired into `scripts/verify-upgrade.sh`, so an upgrade
cannot be declared safe while the gate is broken.
