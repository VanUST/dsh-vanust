---
id: TASK-159
kind: task
title: "Write the case-library improvement design (runner, typed checks, gates)"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.195Z
updatedAt: 2026-11-17T15:52:41.195Z
acceptance:
  - text: "The doc names the shipped contract with file:line anchors and separates what exists from what is proposed"
    done: false
  - text: "Each defect has an observable consequence, not an opinion"
    done: false
  - text: "The proposal covers UX/UI drivers and benchmark metrics concretely (summary contract, metrics, baseline, repeats)"
    done: false
  - text: "A phased plan states what each phase proves and what it does not change"
    done: false
boardId: task-mwjdj2do-h9z8dy
inline: true
nonScope: ["Do not implement any of the proposed changes", "Do not change docs/cases records or the test-cases plugin", "Do not invent measurement values; every number in the doc must come from a command run in this session"]
resultEvidence: ["docs/CASE-LIBRARY-DESIGN.md created; `make verify` still 17/17 + documentation ok", "Read-only count over docs/cases/*.json: 30 cases, status {verified:14, stale:8, unverified:5, deprecated:3}, automated {false:19, true:11}", "driftFor over the same 30 records (no writes): 14 drift-flagged, 5 of them recorded `verified`, 1 recorded `unverified`", "Tool surface: ALL_TOOLS lists 9 tools incl. case_remove; package.json/README/test-cases.mjs header/DEPLOYMENT say eight", "Intake cases recorded: docs/cases/context-gatherer-preset-for-reconnaissance.json and docs/cases/agent-tool-call-checks-become-runnable-autotests.json (source human, unverified)"]
resultSummary: "Wrote docs/CASE-LIBRARY-DESIGN.md: the shipped @cc/dsh-test-cases contract with file:line anchors, six defects that stop agent tool-call checks from becoming autotests (no executor, exit-code-only, no artifacts, asserted red-first, drift without re-run, no gate), and a phased RUN/CHECK/GATE design - `case_run` through `ctx.shell`, a CASE_SUMMARY contract with typed metric/count/hash checks, repeats with median/p95 and baseline ratchet, `case_suite` + a close gate - with acceptance per phase. Also recorded two owner-requirement intake cases."
scope: ["docs/CASE-LIBRARY-DESIGN.md (new file)", "read-only evidence from plugins/test-cases/* and docs/cases/*"]
---

Produce docs/CASE-LIBRARY-DESIGN.md: the current @cc/dsh-test-cases contract as shipped, the six defects that stop agent-performed checks from becoming autotests (no executor, exit-code-only, no artifacts, unprovable red-first, drift without re-run, no gate), and a phased design for an execution layer with typed checks for UX/UI and benchmark metrics, ending in a close/verify gate.

Migrated from .dsh/taskboard.json (task task-mwjdj2do-h9z8dy, revision 4).
