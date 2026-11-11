# @cc/dsh-test-cases — host contract (panel and role integration)

The library lives in the repository at `docs/cases/`, one JSON file per case. This plugin is the
only writer of that directory; a human and the future client panel go through the same host
tools/commands the model uses, so the schema and the evidence trail cannot drift.

## Role availability

| Preset | Tools |
|---|---|
| `orchestrator` | `case_record` (source `human`, status `unverified`), `case_list`, `case_get`, `case_drift` — intake, never a claimed verification |
| `backend`, `ux`, `reviewer`, `critic`, `docs`, `research` | all eight |
| no preset (standard/headless) | all eight (deliberate: the library stays usable outside the orchestrated presets) |

The policy is `DEFAULT_ROLE_TOOLS` in `test-cases.mjs` and can be overridden through the row's
`roles` config. Tools are registered per agent on `agent.ctx`, so a preset that is not listed
never sees them.

## Tool contract

All tools return a JSON value; a refusal is `{ ok:false, code, message }` with a stable code
(`CASE_NOT_FOUND`, `CASE_EXISTS`, `REVISION_REQUIRED`, `REVISION_CONFLICT`, `CASE_CLOSED`,
`AUTOMATED_REQUIRES_TEST`, `DOCUMENTED_REQUIRES_REASON`, `RED_FIRST_REQUIRED`,
`EVIDENCE_REQUIRED`, `SELF_SUPERSEDE`, `CASE_UNREADABLE`, `INVALID_CASE`).

- `case_record(title, requirement, kind, steps, expected, automated, testPath?, runCommand?, reason?, tags?, surfaceFiles?, source?, linkedTaskId?)`
- `case_update(id, expectedRevision, …fields, editedBy?)` — compare-and-set; previous text in `history`
- `case_verify(id, expectedRevision, passed, evidence, redFirst?, commit?, notes?)` — automated cases
  need a red run (non-zero exit) and a green run (exit 0)
- `case_list(status?, kind?, source?, tag?, automated?)`, `case_get(id)`
- `case_supersede(id, expectedRevision, by, reason?)`, `case_deprecate(id, expectedRevision, reason)`
- `case_drift(id?)` — rehash surface files, check automated test paths; marks `stale`, degrades a
  missing test to `automated:false` with a reason

## Stored record (`docs/cases/<id>.json`)

```json
{
  "schemaVersion": 1,
  "id": "kebab-title",
  "title": "…", "requirement": "…", "kind": "regression|scenario",
  "status": "unverified|verified|failing|stale|superseded|deprecated",
  "source": "human|agent",
  "automated": true,
  "testPath": "docs/cases/tests/x.test.mjs", "runCommand": "node --test …",
  "steps": ["…"], "expected": "…", "fixture": "optional",
  "tags": ["…"],
  "surfaceFiles": [{ "path": "src/x.mjs", "sha256": "…" }],
  "linkedTaskId": "optional",
  "revision": 3, "createdAt": "…", "updatedAt": "…", "createdBy": "…",
  "lastVerified": { "at": "…", "command": "…", "exitCode": 0 },
  "evidence": { "redFirst": {…}, "green": {…}, "commit": "…" },
  "needsReverification": { "at": "…", "changedFiles": ["…"], "reason": "…" },
  "supersededBy": "optional", "deprecateReason": "optional",
  "history": [{ "revision": 2, "at": "…", "editedBy": "agent", "action": "verified" }]
}
```

A documented-only case has `automated:false`, `reason`, steps and expected instead of
`testPath`/`runCommand`.

## Panel contract (implemented)

The **Test cases** panel opens from the **Test cases tab inside the existing Tasks panel** - no new top-level chat-header button is added. It is a lens, not a writer. Every read
and write goes through one host command, `/test-cases <json>`, which executes the same
tool objects (and the same compare-and-set writer) the model uses:

| op | tool | notes |
| --- | --- | --- |
| `list` | `case_list` | passes `status`/`kind`/`source`/`tag`/`automated` filters |
| `detail` | `case_get` | full record, evidence, history, surface files |
| `update` | `case_update` | payload carries `expectedRevision`; refusal is `REVISION_CONFLICT` with the current revision |
| `verify` | `case_verify` | same evidence/red-first contract as the tool |
| `deprecate` | `case_deprecate` | requires a reason; edits/verification then refuse `CASE_CLOSED` |
| `remove` | `case_remove` | terminal status only (`deprecated`/`superseded`), compare-and-set, audit line in `docs/cases/.removed.jsonl` before unlink |
| `drift` | `case_drift` | optional id; rehashes surface files and test paths |

`editedBy`/`removedBy` is `human` for panel edits and removals. Removal is the only destructive verb: active/open cases are refused `CASE_NOT_REMOVABLE`; the UI requires an explicit confirmation checkbox. A refusal is returned as
`test-cases: CODE: message (current rev N)`; the panel shows the code and reloads rather
than overwriting. `stale` is shown as a prominent badge plus a sentence: a surface file or
the automated test changed, not that the requirement is gone.

The panel lives in `client.js` (package-local, no build). It registers **only the `main`
slot** and **no `conversation.session.header.actions` action**; the Tasks panel feature-detects
the `test-cases` main panel and shows a `Test cases` tab only when it is registered. It has
list/filter, labelled status (word + meaning), detail, bounded-but-expandable text, hide/show detail pane, independent detail scrolling, edit/verify/deprecate/remove forms, drift refresh
and empty/loading/error/read-only states.
