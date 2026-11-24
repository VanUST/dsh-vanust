---
id: TASK-292
kind: task
title: "Verify the updated install: case CLI audit, tree gates, composed profile, versions"
status: done
revision: 6
createdAt: 2026-11-24T08:57:11.731Z
updatedAt: 2026-11-24T09:01:42.089Z
acceptance:
  - text: "the INSTALLED case CLI runs the audit against this workspace's docs/cases and exits 0 with the four counts quoted"
    done: false
  - text: "the installed profile the server boots composes with the new text: counts for the persona blocks and the two-seat rule quoted from --dump-config"
    done: false
  - text: "the tree gates still pass after the update: check-role-table exit 0 and make verify exit 0 with its FAIL count"
    done: false
  - text: "installed versions quoted: harness, @cc/dsh-orchestrator, @cc/dsh-test-cases"
    done: false
  - text: "every command quoted with its exit code; nothing edited, nothing restarted"
    done: false
boardId: task-mwugo51h-ki2gww
chore: true
choreReason: "Verification that the installed update (0.1.69 orchestrator, 0.1.37 test-cases, new personas) executes as intended; it implements no requirement and changes no file."
nonScope: ["No file edits, no repack, no install, no kit-update, no restart or repointing of :3080", "No case recording or migration (docs/cases must stay byte-identical)", "No opinion about the design; only the runs and their output"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["installed audit: node /home/iustimov/.npm/dsh/profiles/web/node_modules/@cc/dsh-test-cases/bin/cases.mjs audit -> exit 0; documented 42, unmeasured 49, exit-code-only 16, legacy-v1 79", "node scripts/check-role-table.mjs -> exit 0, 9 PASS rows, 'role table ok'", "make verify -> exit 0, 0 FAIL lines, 20/20 portability and packaging checks", "versions: harness 0.2.2-rc.3; installed @cc/dsh-orchestrator 0.1.69; installed @cc/dsh-test-cases 0.1.37; installed cases.mjs has audit = 1; installed orchestrator.mjs:475 carries 'A spike runs in two seats'", "composed profile from identical bytes (sha256 029c12f3… on both sides): 11 persona openings, 10 whitespace-normalised 'False positive:' (8 raw because the dump wraps two lines), 1 'Your result is the board'", "literal dsh --profile web --dump-config -> exit 1 EROFS on profiles/web/cordis.yml, named and not substituted silently", "this session's own system prompt carries the new step 3, the two-seat rule and step 5 — the module-level policy is live in the running server, which no dump could show", "nothing edited, nothing restarted; git status shows no change from the task"]
resultSummary: "The updated install executes: the installed case CLI audit exits 0 with documented 42 / unmeasured 49 / exit-code-only 16 / legacy-v1 79, check-role-table exits 0 with 9 PASS rows, make verify exits 0 with 0 FAIL lines and 20/20 packaging checks, and the installed versions are harness 0.2.2-rc.3, orchestrator 0.1.69, test-cases 0.1.37. The composed profile from the installed bytes carries all eleven persona blocks; the two-seat rule is module text and was verified in the installed orchestrator.mjs:475. The literal --dump-config cannot run on a read-only ~/.npm/dsh (EROFS) and that is named rather than papered over."
role: BACKEND
---

Prove the updated installation works, not merely that the files arrived. Four quoted runs from the workspace: (1) the INSTALLED case CLI — `node /home/iustimov/.npm/dsh/profiles/web/node_modules/@cc/dsh-test-cases/bin/cases.mjs audit` — must exit 0 and print the four group counts against this repo's docs/cases; (2) `node scripts/check-role-table.mjs` must exit 0; (3) `make verify` must exit 0, with its FAIL count quoted; (4) the composed profile the server would boot — `dsh --profile web --dump-config` — must contain the eleven persona blocks (count `False positive:` and, separately, `Your result is the board`) and exactly one `A spike runs in two seats`. Also quote the installed versions: `dsh --version`, and the version fields of @cc/dsh-orchestrator and @cc/dsh-test-cases under the installed profile.
