---
id: TASK-326
kind: task
title: "A command to retire a case, and the two rows here that assert removed behaviour"
status: done
revision: 6
createdAt: 2026-11-26T12:26:01.335Z
updatedAt: 2026-11-26T12:36:31.071Z
acceptance:
  - text: "a first-class retire path exists: a tool verb and a CLI command that take a case id and a required reason, move the case to deprecated, keep steps and history, and refuse an unknown id, a missing reason or an already-retired case by name"
    done: false
  - text: "the CLI audit reports every case whose declared surface no longer exists — surfaceFiles entries or a testPath that is gone — with the missing paths and a count, and writes nothing"
    done: false
  - text: "the two cases in this workspace whose surface files disappeared with design-map v1 are retired through the new verb with a reason naming that retirement, and no other case is touched"
    done: false
  - text: "the read-only reference library at /home/iustimov/tasks/autolabel_pipeline is never written to: the audit may be pointed at it to report counts, and the report quotes what it would find there without changing a byte"
    done: false
  - text: "the state side is checked, not assumed: state whether the projections count cases at all, and if they do, that a retired case stops being counted"
    done: false
  - text: "suites and make verify are green and the plugin is repacked"
    done: false
boardId: task-mwxj0du0-msgqnc
chore: true
choreReason: "The owner has no command to mark a case obsolete: the library keeps asserting removed behaviour, which is why the state board keeps counting rows nobody can retire."
nonScope: ["No change of any kind under /home/iustimov/tasks/autolabel_pipeline", "No rewrite of case steps or of the owner's acceptance text", "No change to the gate rules or to what closes a task", "No commit, no push"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["CLI deprecate on both cases: status deprecated, revision bumped, reason and history written; steps, requirement and expected compared equal to HEAD", "refusals with exit 2: CASE_NOT_FOUND for an unknown id, INVALID_CASE for a missing reason, CASE_CLOSED for an already-retired case", "cases audit missing-surface: 2 here (7 and 1 missing paths) and 141 on the read-only reference library, exit 0", "the reference library was only read: its file listing hash is identical before and after the audit", "cases list --status deprecated shows 5 and case_get keeps steps and history", "make test 70/70, make verify 20/20, plugin repacked 0.1.40 matching its sources"]
resultSummary: "The case library now has a shell path to retire a case: `cases deprecate --id <case> --reason <text>` runs the same store function as the already-registered case_deprecate verb, sets deprecated, keeps steps and history, and refuses an unknown id, a missing reason or an already-retired case by name. `cases audit` gained a missing-surface group that lists every case whose declared surface no longer exists, with the missing paths — 2 here, 141 on the read-only reference library at ~/tasks/autolabel_pipeline, which was only read and byte-identical before and after. Both design-map v1 rows here are retired through the CLI. One gap found and handed to a follow-up: the state projections still count a retired case as a live TEST row."
role: BACKEND
scope: ["plugins/test-cases — the new verb, the CLI command and the audit extension, with tests", "docs/cases — the two retired records in this workspace, written through the store", "package.json version, tarball"]
---

Give the case library a first-class way to retire a case, because the owner runs into 837 records in another project where removed behaviour still reads as live and there is no command to mark a case obsolete. Add a tool verb and a CLI command that take a case id and a required reason, set the case to deprecated with the reason in its history, keep its steps, and refuse an unknown id, a missing reason or an already-retired case by name. Extend the CLI audit so it lists every case whose declared surface no longer exists — any surfaceFiles entry or testPath that is gone — with the missing paths and a count, writing nothing; run it against the read-only reference library at /home/iustimov/tasks/autolabel_pipeline to show what it finds there, without changing a byte. Then retire the two cases in this workspace whose surface files disappeared with design-map v1, and report whether the state projections count cases at all.
