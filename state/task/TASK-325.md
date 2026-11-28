---
id: TASK-325
kind: task
title: "A command to retire a case, and the two cases that assert removed behaviour"
status: cancelled
revision: 5
createdAt: 2026-11-26T12:24:05.627Z
updatedAt: 2026-11-26T12:26:04.794Z
acceptance:
  - text: "a first-class way to retire a case exists outside the internals: a tool verb that takes an id and a reason and moves the case to deprecated with the reason in its history, and a CLI command that does the same from a shell"
    done: false
  - text: "the verb refuses an unknown id, a missing reason and a case that is already retired, naming the refusal instead of silently succeeding"
    done: false
  - text: "the audit part of the CLI reports every case whose declared surface no longer exists — surfaceFiles entries or a testPath that is gone — with the missing paths and a count, and writes nothing"
    done: false
  - text: "the two cases whose surface files disappeared with design-map v1 are retired through the new verb with a reason naming that retirement, and no other case is touched"
    done: false
  - text: "the library list shows them as deprecated, case_get keeps their steps and history, and a retired case is not counted as open work by the state projections if they count cases at all"
    done: false
  - text: "suites and make verify are green and the plugin is repacked"
    done: false
boardId: task-mwxixo1g-te45an
chore: true
choreReason: "The owner has no command to mark a case obsolete, so the library keeps asserting removed behaviour and the state projections keep counting it."
nonScope: ["No rewrite of the cases' steps or of the ~100 acceptance lines: retirement only, the rewrite is the owner's decision", "No change to the gate rules or to what closes a task", "No commit, no push"]
owner:
  kind: agent
  label: BACKEND
preset: backend
role: BACKEND
scope: ["plugins/test-cases — the new verb, the CLI command and the audit extension, with tests", "docs/cases — the two retired records, written through the store", "package.json version, tarball"]
---

Give the library a first-class way to retire a case, and use it where the evidence is unambiguous. Today 79 records can hold the statuses superseded and deprecated, but nothing sets them: the only path is a store call from a session that happens to know the API. Add a tool verb and a CLI command that take a case id and a required reason, move the case to deprecated, keep its steps and history, and refuse an unknown id, a missing reason or an already-retired case by name. Extend the CLI's audit to report every case whose declared surface no longer exists — a surfaceFiles entry or a testPath that is gone — with the missing paths listed, so the stale rows are found by machine rather than by hand. Then retire the two cases whose surface files disappeared with design-map v1, with a reason naming that retirement, and show the library list and case_get afterwards. Leave the rewrite of their steps to the owner.
