# @cc/dsh-analysis — analysis before decomposition

One Analysis Record per initiative in `docs/analysis/<initiative>.json`, four root-only
tools over it, and a proportional delegation gate. The record is the only place a
requirement is traced to its process, component, task and evidence; the taskboard stays a
lifecycle ledger and the design map stays a scene.

## Why a repo-tracked record

A delegated child can implement a plausible thing that nobody asked for. The root needs a
durable, reviewable statement of *why* the work exists and *what* it touches **before** it
splits the work into tasks. `docs/` is tracked, so the analysis travels with the code and a
reviewer sees it; `.dsh/` is gitignored and would hide the design history.

The write discipline is the design-map precedent: a revision counter, compare-and-set on
`expectedRev`, and a temp-file + rename so a crash cannot leave half a document. The file is
written through the service only.

## The record

- `businessOutcome` — problem, outcome and success metrics, **separate** from
  `requestedSolution`.
- `process` — current and target steps/actors.
- `requirements[]` — BR/FR/NFR, text, acceptance, delivery status
  (`planned | proven | deferred | rejected`) and the reason for a deferral.
- `architecture` — components with a role owner, plus `contractImpact`
  (`none | additive | breaking`) and `contracts[]`, each with its own verdict. A contract
  verdict is exactly one of `none | additive | breaking`; `removed` is rejected with a
  recommendation to use `breaking` and describe the removal.
- `data[]` — the entity's role `owner` and its **canonical system owner**
  `ownerComponentId`. `architecture.components[].owns` is legacy input and a derived
  projection: a unique `owns` migrates losslessly; a canonical/legacy conflict or two
  legacy owners is refused on write. An older ambiguous record stays readable and
  byte-faithful (with an `ownership_ambiguous_compat` warning), but every gate fails
  closed until the owner is resolved: `analysis_check` reports the warning,
  `delegate_task`/`analysis_link_task` refuse `analysis_stale`, and `read` is the only
  operation that still answers. One `analysis_upsert` naming `data[].ownerComponentId`
  resolves it, and read/gate/link work again.
- `invariants[]`, `decisions[]` (decision and rationale are required), `openQuestions[]`
  (a blocking question needs an answer).
- `sizing` — `L0 | L1 | L2` and the reasons, so proportionality is a recorded judgement.
- `trace[]` — `{requirementId, processId, componentId, contractIds, dataIds, status, tasks[]}`
  where a task carries its id, role and evidence. `delegate_task` appends the task id before
  the child starts.
- `designRef` — `{mapRev, at, source}` captured when the record becomes `ready`; `at` is
  filled on capture and must be a parseable ISO timestamp when supplied. Drift compares
  only `mapRev`. A bare `designRef` bump reopens the record and records an impact; it does
  not clear drift by itself.
- `goalId` / `goalHistory` — a commitment, not a label. `update_goal action:"complete"` is
  refused while a record that names the goal now or in its history is not `completed`; a
  linked record cannot be detached while it is ready/completed.
- `fingerprint` — sha256 over the semantic fields (not the trace), so a hand edit that
  changes a requirement is detected. `rev`, `history`, `pendingImpacts` are operational.
  A fingerprint written by the earlier `0.1.4` normalization (which had no
  `data[].ownerComponentId`) is **recognised as legacy**, not as a hand edit:
  `analysis_read` returns `legacyFingerprint:{recognized:true,version:"0.1.4"}` and a
  `legacy_fingerprint` warning, gate/link/close/goal work, and the next semantic
  `analysis_upsert` seals the current fingerprint and records a `migrate` history entry.
  A real hand edit is still refused `fingerprint_mismatch`.

## Tools (root only)

| Tool | What it does |
|---|---|
| `analysis_read` | Read one record, or list the store. Returns rev, status, fingerprint match, `legacyFingerprint` when the stored hash is a recognised earlier algorithm, `ambiguousOwnership`, design drift, `readiness` (the same object as `check`) and `completion` with `state:"complete"|"in_progress"`, counts and findings. |
| `analysis_upsert` | Create or edit with `expectedRev`. **Strict, aggregate and lossless:** unknown keys, wrong types, invalid enums, empty required nested fields and over-limit content are refused as `invalid_record` with a `findings[]` carrying the exact JSON path and, for limits, `max`/`actual`. Every independent structural error AND the independent readiness findings come back in one call; a semantic finding that merely cascades from a structurally broken subtree is suppressed. Ids are compared after the same trim the normalizer applies, and `process.current`/`process.target` share one id namespace. A refused call leaves the file byte-identical and the revision unchanged. **Nothing is truncated:** title 200, requestedSolution 8000, business/outcome text 4000, successMetrics 20, requirement text 4000, acceptance 30, sizingReasons/actors 20, steps 50, decision/rationale/question/answer 2000, name 200, responsibility/description 1000, owner 120, evidence 20, alternatives 10, goalHistory 50. Content is measured in UTF-16 code units and compared whole, so a surrogate pair is never split. `data.ownerComponentId` is canonical; `owns` is derived/legacy. `status:"ready"` is refused with `analysis_incomplete` unless the check has no errors; `status:"completed"` is refused with `completion_blocked` until every requirement is proven with evidence or explicitly deferred/rejected. Adding/removing a requirement, changing a requirement to/from deferred/rejected, changing a trace mapping, editing the process/business outcome/architecture/data/contracts/invariants/decisions/open questions/sizing, moving `designRef` or changing `goalId` on a ready record records a pending impact or is refused; a requirement with traced tasks cannot be removed (`requirement_has_tasks`) and a task link cannot be erased from any status (`trace_task_removal`). A hand-edited file is refused (`fingerprint_mismatch`) until the caller passes `acceptHandEdit: true`; a recognised `0.1.4` fingerprint is migrated instead (history action `migrate`). |
| `analysis_check` | Completeness, not shape: acceptance, component/data role ownership, contract impact, unresolved trace, proven-without-task/evidence, deferred-without-reason, blocking questions, design drift, fingerprint. The response separates `readiness` from `completion`; a fresh ready record is `readiness.ok:true` and `completion.state:"in_progress"` with the planned count, not a second readiness error. `forCompletion:true` enforces completion. |
| `analysis_impact` | Mark a requirement/component/contract/data/design change, return the affected ids and tasks, reopen the record as `draft`, and add a pending impact. The next L1/L2 delegation is refused `analysis_stale` until `analysis_upsert` resolves it. |

A delegated child gets none of these tools: keeping the system design is the root's job.

## The gate

`delegate_task` reads the analysis service through `ctx.get('analysis')` — it is deliberately
**not** in the orchestrator's `inject`, so a composition without this plugin keeps the legacy
delegation behaviour.

| `changeClass` | Requirement |
|---|---|
| `L0` | A question or a local fix. No Analysis Record; the gate answers before reading a file. |
| `L1` | A contained feature. Needs `analysisId`, `requirementIds` and a `ready` record. |
| `L2` | Cross-component, contract or data change. Same, plus `architectureImpact: true` checks the design-map revision. |

**Exempt:** a read-only **preset** (`research`, `reviewer`, `critic`) and a `taskId` attach
with an explicit `legacyAttach: true`, with no `changeClass`/`analysisId`. The role label
never exempts a write-capable preset, and an explicit class/record opts back in. There is no
timestamp inference: a fresh attach without the flag is refused.

A refused gate writes no task row and starts no child:

- `analysis_required` — no record, not ready, a missing/unknown requirement, or an
  architecture impact with no component.
- `analysis_stale` — an unresolved impact, a hand-edited fingerprint, a design map that moved
  for architecture work, or a record that was `ready` but no longer checks.

The record is the trace store: there is no `analysisId`/`requirementIds` column in the
taskboard and no second design store. `designMapRev` is a reference.

## Completion guards

A monotonic `tools.guard` on every agent (root and child) refuses:

- `task_close` for the **last outstanding** task traced to a record whose requirement is
  still `planned` (a non-last task may close); for a `proven` requirement whose traced task
  carries no evidence (`analysis_evidence_required`); for a record that is stale, hand-edited,
  malformed or not ready. A `completed` record or a deferred/rejected requirement allows the
  close. An untraced task (L0, read-only, legacy) passes. A batch is atomic: it runs only when
  every task in it is closable, otherwise the whole call is refused with both tasks left in
  review.
- `update_goal action:"complete"` while a record that names that `goalId` (now or in
  `goalHistory`) is not completed, or while the record is unreadable (merge conflict).

## Config

| key | default | meaning |
|---|---|---|
| `dir` | `docs/analysis` | store directory relative to the session workspace |
| `designMapFile` | `design.excalidraw` | scene whose `designMap.rev` is referenced |
| `historyLimit` | `50` | retained revision entries |
| `promptSection` | `true` | register the short root policy section |

## Proof

`node scripts/analysis-before-decomposition-proof.mjs` drives the real store, the real
`delegate_task` body and a real taskboard service over a disposable directory. It is the
red-first/green proof for the owner cases in `docs/cases/` and covers the feature path,
strict nested schema and aggregate findings, canonical ownership, a mid-work
change/conflict, a new-chat reload, L0, readiness vs completion, design drift and a hand
edit.
