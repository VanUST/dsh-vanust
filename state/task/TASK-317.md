---
id: TASK-317
kind: task
title: "Proof guard: the runtime's ledger is not a role's product edit"
status: done
revision: 5
createdAt: 2026-11-26T09:24:28.424Z
updatedAt: 2026-11-26T09:32:20.197Z
acceptance:
  - text: "a change to state/events.jsonl during a shell command no longer counts as a product edit: the manifest excludes the ledger and the session scratch directory, and a test proves a manifest whose only change is state/events.jsonl yields no violation"
    done: false
  - text: "a real product path still blocks: a change to a tracked source file under the same conditions is still recorded and still refuses the close"
    done: false
  - text: "an already-recorded hit on state/events.jsonl stops blocking an existing row, so the tester task that was refused can be closed after the fix"
    done: false
  - text: "make test and make verify are green and the touched plugins are repacked"
    done: false
boardId: task-mwxcix5b-6atj0a
chore: true
choreReason: "The proof guard blames a tester for the runtime's own ledger write: state/events.jsonl is tracked, so any turn that appends an event looks like a product edit by the role and the row cannot be closed."
nonScope: ["No change to what the guard does for bash edits of real product files", "No change to the tester's test file or its findings", "No commit, no install"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["manifest quote: RUNTIME_ROOTS = ['state/', '.dsh/'] with isRuntimePath applied in productManifest beside the owned roots; productManifest on the real workspace hashes 481 tracked files, 0 under state/, 0 under .dsh/, 334 product", "product run on the real record and the real board: close with the ledger-only record gives ok true / status done; the same record plus src/app.mjs gives product_shell_violation naming only src/app.mjs", "proof-guard suite 13/13 and taskboard contract 11/11, red first 2/3 and 9/2", "the violation record was left on disk unchanged: it is judged, not deleted", "make test 68/68, make verify 20/20, both plugins repacked (0.1.10 and 0.1.86)"]
resultSummary: "The proof guard no longer blames a role for the runtime's own writes: state/ and .dsh/ are out of the product manifest, and a recorded hit is judged by its product files only, so the tester's existing record no longer refuses its row while a real product edit beside a ledger change still records and still refuses with only the product file named. Proved against the real record and the real board in a copy, with both directions and red-first tests."
role: BACKEND
scope: ["plugins/proof-guard/proof-guard.mjs — the manifest roots and the violation judgement", "plugins/proof-guard/test/ — the new tests", "plugins/taskboard/taskboard.mjs only if the judgement lives there", "package.json versions, dist, tarballs"]
---

Fix the proof guard so it stops blaming a role for the runtime's own writes. Its product manifest hashes every tracked file except docs/cases, test and tests, and state/events.jsonl is tracked — so any ledger append that happens while a shell runs is recorded as a product edit by that session, and the taskboard then refuses to close the role's row (exactly what happened to the tester's task). Exclude the project ledger (state/) and the session scratch directory (.dsh/) from the product surface, both when a manifest is compared and when an already-recorded violation is judged, so the existing refusal clears without deleting the record by hand. Keep the guard honest: a real edit to a tracked source file under bash must still be recorded and must still refuse the close. Prove both directions with tests and keep the suites and the gate green.
