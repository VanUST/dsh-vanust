---
id: TASK-328
kind: task
title: "Retired cases must stop counting as live acceptance rows"
status: done
revision: 6
createdAt: 2026-11-26T12:36:13.985Z
updatedAt: 2026-11-26T12:42:13.415Z
acceptance:
  - text: "a retired case stops being counted as a live TEST row: after retiring one, the snapshot's TEST figure drops by one, quoted before and after on a copy of the live state"
    done: false
  - text: "the retired case's TEST row is visibly terminal in its own file, not merely absent from the count, and its link to the case id survives"
    done: false
  - text: "a live case still counts: a run over a ledger whose cases are all live gives the same figure as before the change"
    done: false
  - text: "a case that was retired and later re-recorded is counted again without a hand edit, or the refusal is named if re-recording is deliberately blocked"
    done: false
  - text: "suites, make test and make verify are green and the touched plugins are repacked"
    done: false
boardId: task-mwxjdgw4-6km4c6
chore: true
choreReason: "Retired cases keep being counted as live TEST rows by the state projections, so the board still shows acceptance work that nobody can act on — the exact lie the owner reported."
nonScope: ["No change to the retire verb or the audit", "No change to /home/iustimov/tasks/autolabel_pipeline — read only", "No commit, no push"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["on a copy of the live state: baseline 88, after one retirement 87 (1 retired), after two 86 (2 retired), after re-recording one 87 (1 retired) with the same TEST id", "TEST-015.md frontmatter reads status: deprecated with caseId intact, so the row stays as the requirement's trace", "snapshot, digest and index.json all take the figure from testFigure()/testCounts(); index.json gained counts.testRetired", "re-record through the tools refuses by name: case_update gives CASE_CLOSED, case_record with the same title gives CASE_EXISTS", "project-state 40 tests and test-cases 77 tests pass; make test 70/70 and make verify 20/20 exit 0; both tarballs match their sources"]
resultSummary: "A retired case stops counting as a live acceptance row. The TEST figure now means live rows and names the rest beside it: `- TEST: 86 (2 retired)`, identical to the old line when nothing is retired. A retired case mirrors to the register's terminal status `deprecated`, keeps its TEST row and its case link, and superseded maps to the same terminal value. Proven on a copy of the live state: 88 live, then 87 (1 retired), 86 (2 retired), and 87 again after a re-record through the store, with the same TEST id and the retired row still in the register. Re-record through the tools refuses by name (CASE_CLOSED, CASE_EXISTS). Known gap stated by the child: a retirement from the shell CLI does not mirror, because the CLI has no state service, so the figure drops only on the tool path — a separate fix."
role: BACKEND
scope: ["plugins/test-cases/mirror.mjs — the status map", "plugins/project-state/lib/views.mjs — the TEST figure and any per-status breakdown", "scripts/state-migrate.mjs only if the status vocabulary needs the terminal value there", "tests for both sides, package.json versions, tarballs"]
---

Make the board stop counting acceptance work nobody can act on. Retiring a case now sets the record to deprecated, but the state projection still counts it: the test-cases mirror maps only the four working statuses, so a retired case stays 'unverified' as a TEST row and the snapshot's '- TEST:' figure includes it. Map a retired case to a terminal status in the register's own vocabulary, keep its TEST row and its case link visible as terminal rather than deleting them, and make the TEST figure consistent with that meaning across the projection. Prove it on a copy of the live state: retiring one case drops the counted figure by one, the row reads terminal in its file, and a ledger with only live cases gives the figure it gave before.
