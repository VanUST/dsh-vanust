---
id: TASK-400
kind: task
title: "P0: case-library audit command and the role-table check in make verify"
status: done
revision: 7
createdAt: 2026-11-24T08:25:10.847Z
updatedAt: 2026-11-24T08:35:51.486Z
acceptance:
  - text: "audit prints the four groups with ids and counts and exits 0"
    done: false
  - text: "audit --json prints one machine-readable object with the same groups and counts"
    done: false
  - text: "the case `case-surface-per-role-matches-the-readme-table` is listed under exit-code-only, with the reason the run carried no summary"
    done: false
  - text: "audit writes nothing: git status --porcelain is identical before and after the run"
    done: false
  - text: "check-role-table exits 0 on the untouched tree and is part of make verify"
    done: false
  - text: "red-first: a single-verb edit of a README role row makes the check exit non-zero and name the row and the verb; restoring the row makes it exit 0 again, and git diff proves the restore"
    done: false
  - text: "make verify is green and every other file in the tree is untouched (git status shows only the intended paths)"
    done: false
boardId: task-mwufiz15-ssm9v7
nonScope: ["No schema change: do NOT add surface, interactions, failureMode, probeId or steps — those are P1/P2 in docs/CASE-LIBRARY-BEHAVIOUR-DESIGN.md", "Do NOT edit anything under docs/cases/ (case records belong to their authors; a non-author edit is refused AUTHOR_ONLY, and the two offending records are the owner's/a human's to change)", "Do NOT remove the README text assertions from plugins/test-cases/test/policy-docs.test.mjs — that driver closes a task today and its replacement only exists in P1", "Do NOT touch or restart the live web server on :3080, do not run `make up`, do not rebuild images", "No new dependency; no network access in either reader"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-231, REQ-232]
resultEvidence: ["node plugins/test-cases/bin/cases.mjs audit -> exit 0: documented 42, unmeasured 49, exit-code-only 16, legacy-v1 79; case-surface-per-role-matches-the-readme-table listed with 'all 2 run(s) carried no summary'", "audit --json -> one object, ok true, total 79, the same four counts", "audit writes nothing: git status --porcelain identical (44 lines) and a 412-file sha256 list of docs/cases/ identical before and after both runs", "node scripts/check-role-table.mjs -> exit 0 'role table ok'; red-first: removed case_verify from the reviewer row -> exit 1 'row reviewer — README is missing case_verify'; deleted critic row -> exit 1 'the README table has no row for this preset'; restores proven by sha256 03803e7c… and git diff 0 lines", "make verify -> exit 0; line 42 runs node scripts/check-role-table.mjs, line 52 'role table ok', 0 FAIL lines", "tarball:matches-source forced the repack: tar -xOzf plugins/cc-dsh-test-cases-0.1.37.tgz package/README.md | diff - plugins/test-cases/README.md -> identical (same for bin/cases.mjs); check-portability 20/20", "Orchestrator read the delivered code: scripts/check-role-table.mjs parses README rows as data, names missing/extra verbs, fails a preset without a row; Makefile:143 wires it into verify"]
resultSummary: "P0 shipped: `cases.mjs audit [--json]` lists four groups over the 79 records (42 documented / 49 unmeasured / 16 exit-code-only / 79 legacy-v1) and writes nothing; `scripts/check-role-table.mjs` compares the README Role-availability table with DEFAULT_ROLE_TOOLS and runs in `make verify`; the known offender case-surface-per-role-matches-the-readme-table is named in exit-code-only with its reason. make verify green; the plugin tarball was repacked 0.1.36 -> 0.1.37 because the packaging gate pins packed files to source. Analysis record: FR6 and FR7 deferred with the command evidence and the reason (verification level proof; by design M1 the role-table rule is never a case)."
role: BACKEND
scope: ["plugins/test-cases/bin/cases.mjs (new audit subcommand, no writes, --json)", "scripts/check-role-table.mjs (new reader: README table vs DEFAULT_ROLE_TOOLS)", "Makefile: add the reader to `verify` and name it in the help text", "plugins/test-cases/README.md: document the audit subcommand in the CLI section", "plugins/test-cases/test/ if a unit test for the audit parse/comparison is the cheapest proof — optional, not required by this brief"]
---

Phase P0 of the "behaviour-only cases" initiative: give the case library a read-only audit that names the cases which cannot prove behaviour, and move the README role-table agreement out of the library into the static tree gate. Concretely: (1) `node plugins/test-cases/bin/cases.mjs audit [--json]` prints four groups over docs/cases/*.json without writing anything — `documented` (automated:false), `unmeasured` (no runner evidence: lastVerified missing or source !== "runner"), `exit-code-only` (automated, and every runner run in `runs[]` has a non-null `summaryError`, i.e. the case's only judgement is an exit code), `legacy-v1` (schemaVersion 1) — each with case ids and a count, exit code 0; (2) a new `scripts/check-role-table.mjs`, wired into `make verify`, refuses a README "Role availability" row that disagrees with `DEFAULT_ROLE_TOOLS` in plugins/test-cases/test-cases.mjs — a missing verb, an extra verb, or a preset absent from the table.
