---
id: TASK-036
kind: task
title: "Policy: report once at the end; push notify rework and policy change"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.387Z
updatedAt: 2026-11-17T15:52:39.387Z
acceptance:
  - text: "the deployed system prompt carries the rule after the restart"
    done: false
  - text: "the tarball/installed copies match the source"
    done: false
  - text: "git status clean and local HEAD equal to origin/main"
    done: false
boardId: task-mw9ecikx-y3p9qo
nonScope: ["changing the delegation brief rules for children", "the notify plugin behaviour (already shipped in 1.1.3)"]
resultArtifacts: [/home/iustimov/dsh-kit/plugins/orchestrator/orchestrator.mjs, /home/iustimov/dsh-kit/plugins/cc-dsh-orchestrator-0.1.16.tgz, https://github.com/VanUST/dsh-vanust/commit/6e26d72d7fe5dd0af46dcb400a430480c485dd2b]
resultEvidence: ["grep -n 'Report once' plugins/orchestrator/orchestrator.mjs -> line 231; node --check -> SYNTAX_OK", "node -e import(installed orchestrator) -> 'installed policy has the rule: true'; installed file identical to the kit source", "pack 0.1.15 -> 0.1.16 (sha 401aebe0...), pnpm add into the profile, package.json points at the 0.1.16 tarball", "dsh --profile web --dump-config -> exit 0, no warnings; check-portability 17/17 PASS; check-documentation ok", "git push origin main -> '40b3365..6e26d72  main -> main' (succeeded on retry after gnutls resets); git ls-remote origin main -> 6e26d72d...; git status --porcelain -> 0 lines"]
resultSummary: "Added the rule to the root policy the agent reads every turn (orchestrator 0.1.16, installed): 'Report once, when the work is done' - no intermediate summaries, the report is written when the work is finished, and a self-continuing goal gets one at the end, not per round. Committed with the notify rework as 6e26d72 and pushed to origin/main; local HEAD equals the remote and the tree is clean. The push needed one retry: the gnutls handshake against github.com failed three times with different TLS errors even over HTTP/1.1 - an intermittent network reset, not a credential problem."
scope: ["plugins/orchestrator/orchestrator.mjs ROOT_POLICY section (the prompt text)", "rules/DEPLOYMENT.md section 5 (rules not to break while operating)", "the packed orchestrator tarball and the installed profile", "git commit and push to VanUST/dsh-vanust main"]
---

Add the rule the human asked for to the deployment policy the agent actually reads every turn: no intermediate reports while work is unfinished - the report is written once, when the work is done, and a goal that continues does not get one per round. Then commit and push the notify rework (1.1.3) and this policy change to origin/main.

Migrated from .dsh/taskboard.json (task task-mw9ecikx-y3p9qo, revision 2).
