---
id: TASK-319
kind: task
title: "Put the independent acceptance test inside make test"
status: done
revision: 6
createdAt: 2026-11-26T09:32:14.472Z
updatedAt: 2026-11-26T09:37:17.269Z
acceptance:
  - text: "make test runs the top-level tests directory: the new file appears in the run list and the total count rises by exactly one, quoted before and after"
    done: false
  - text: "the wiring fails loudly when the directory is missing or empty instead of silently skipping it"
    done: false
  - text: "a deliberately broken assertion in a top-level test makes make test fail, and the tree is restored afterwards, both quoted"
    done: false
  - text: "make verify stays green and the committed test is unchanged"
    done: false
boardId: task-mwxcswm2-n93e28
chore: true
choreReason: "The independent acceptance test for the state notification is committed under tests/ but the gate does not enumerate that directory, so the test is green only when run by hand and will rot silently."
nonScope: ["No change to the test file or to any plugin", "No change to what make verify reads", "No commit, no push"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["--list before: 68 of 68 steps; after: 69 of 69, naming 'acceptance tests/state-feed/state-notification.test.mjs'", "make test: [51/69] acceptance … ok, summary '69/69 passed (50 plugin test file(s), 1 acceptance test file(s), 18 proof script(s))' exit 0", "missing and empty tests/ in a fake kit: 'refused: no tests/**/*.test.mjs under … a failure, not a skip', exit 1", "deliberate red: assertion changed, make test stops at [51/69] exit 2, restored with git checkout and tests/ shows 0 diff", "make verify exit 0; the runner change is scripts/test-all.mjs, and Makefile plus README now describe the group"]
resultSummary: "The independent acceptance test is now part of the gate: make test runs tests/**/*.test.mjs as its own group, reports 69/69 with the group named separately, refuses loudly when the directory is missing or empty, and turns red on a deliberately broken assertion in that file. The runner change is scripts/test-all.mjs; Makefile and README now describe the group too."
role: BACKEND
scope: ["scripts/test-all.mjs — the enumeration and the report line", "Makefile only if the target needs the new argument", "a temporary broken assertion used as the red proof, restored afterwards"]
---

Put the independent acceptance test inside the gate. The committed test tests/state-feed/state-notification.test.mjs is run only by hand today: make test enumerates plugins/*/test/*.test.mjs and scripts/*-proof.mjs, and a top-level tests directory is not in that list, so the test will silently stop protecting anything. Make the runner enumerate tests/**/*.test.mjs as its own group, report them separately from plugin tests and proof scripts so the reader can tell them apart, fail loudly if the directory disappears, and prove it: the total rises by exactly one, a deliberately broken assertion in a top-level test turns make test red, and make verify stays green.
