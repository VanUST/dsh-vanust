---
id: TASK-015
kind: task
title: "Activate skill-evolve, babysitter and rtk"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.134Z
updatedAt: 2026-11-17T15:52:39.134Z
boardId: task-mw3ladnf-dwyb78
nonScope: ["Do not change the model policy, the subagent capacity or the Kimi route", "Do not add a new plugin package", "Do not make skill_evolve mandatory for tasks that found nothing reusable"]
resultEvidence: ["rtk classifier: 14/14 cases PASS (git log/status/diff, rg, grep, find, fd, tsc, vitest, pytest, go build, ctest, pest, phpstan, pint, cd-prefix variants; pipes/`git show`/`ls`/`cat`/`npm run build` correctly unclassified)", "rtk end-to-end after installing 0.1.5 into the headless profile: `git log -10 --stat` → tool_result 479 B with banner, debug stage=applied before=19563 after=499", "rtk end-to-end cd-prefix: `cd /home/iustimov/dsh-kit && git log -10 --stat` → 479 B with banner; `git log --stat | head -5` → 236 B, no banner (pipe opts out, as documented)", "node --check on rtk.mjs / orchestrator.mjs / handoff.mjs → all ok", "installed web profile versions: orchestrator 0.1.13, handoff 0.1.6, rtk 0.1.5; installed text spot-checks: skill_evolve x2 + babysitter_run x1 in orchestrator, skill_evolve in handoff, go-build + 'does not stop filtering' in rtk", "node scripts/check-documentation.mjs → documentation ok; check-portability → 17/17", "babysitter release-gate (unchanged this turn): exit 0, run completed, output ok:true, task in review with journal notes"]
resultSummary: "All three activations are in and tested. skill-evolve now has both triggers: the child policy requires skill_inventory → skill_evolve before a specialist reports done, and the handoff tool description tells the caller to record the reusable procedure before rendering the page. babysitter has a when-to-use rule in the root policy (fixed multi-step procedures, not one-off edits) on top of the verified release-gate process. rtk gained the five missing filter rules (go build, ctest, pest, phpstan, pint) and a prompt section that states what does and does not get filtered. Testing found a real defect: the headless profile still had rtk 0.1.1, which does not filter at all; after installing 0.1.5 there, `git log -10 --stat` went 19563 B → 479 B with the banner, and a `cd`-prefixed command filtered while a piped one correctly did not."
scope: ["plugins/orchestrator — root and child policy triggers", "plugins/handoff — skill-library reminder in the rendered page", "plugins/rtk — missing FILTER_RULES, prompt section wording", "plugins/babysitter — example process plus a real run", "rules/DEPLOYMENT.md, README.md — the new behaviour", "tarballs and kit-update projection"]
---

Make three installed plugins actually fire instead of sitting idle: skill-evolve gets both triggers (a hard closing step in the child policy and a reminder at handoff), babysitter gets a when-to-use rule plus a working example process and one real run that writes a journal, and rtk gets the coverage gaps closed (unmapped filter rules) plus a sharper prompt section, with measurements of what each did before and after.

Migrated from .dsh/taskboard.json (task task-mw3ladnf-dwyb78, revision 4).
