---
id: TASK-037
kind: task
title: "Policy: no ad hoc fixes - check the architecture before patching"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.398Z
updatedAt: 2026-11-17T15:52:39.398Z
acceptance:
  - text: "the rule is named 'No ad hoc policy' in the source and in the installed build"
    done: false
  - text: "--dump-config still composes without warnings"
    done: false
  - text: "tree clean, local HEAD equal to origin/main"
    done: false
boardId: task-mw9fyzby-pdwezt
nonScope: ["the child policy", "DEPLOYMENT.md (a procedure for the human, not prompt text)"]
resultArtifacts: [/home/iustimov/dsh-kit/plugins/orchestrator/orchestrator.mjs, /home/iustimov/dsh-kit/plugins/cc-dsh-orchestrator-0.1.17.tgz, https://github.com/VanUST/dsh-vanust/commit/6cbbb6f1759549cba020377e54e5cb7cff7fd583]
resultEvidence: ["grep -n 'No ad hoc policy' plugins/orchestrator/orchestrator.mjs -> line 233; node --check -> SYNTAX_OK", "node -e import(installed orchestrator) -> 'policy has both rules: true' (No ad hoc policy + Report once); installed file identical to the kit source", "pack 0.1.16 -> 0.1.17 (sha 9c6a1957...), pnpm add into the profile, package.json points at the new tarball", "dsh --profile web --dump-config -> exit 0, no warnings; check-portability 17/17 PASS; check-documentation ok", "git show HEAD -> 4 files, +3/-1, the policy line present; git push -> '6e26d72..6cbbb6f  main -> main' on the first attempt; git ls-remote origin main -> 6cbbb6f175...; git status --porcelain -> 0"]
resultSummary: "Added the named rule 'No ad hoc policy' to the root policy section every turn carries (orchestrator 0.1.17, installed): a bug or feature request is a question about the design first - name what the current shape assumes and where the symptom comes from (wrong owner, duplicated derivation, missing state-machine case, an unagreed contract). If the approach is wrong, revise it in one line; a genuinely local patch states the assumption that makes it correct. Committed as 6cbbb6f and pushed to origin/main; tree clean, local HEAD equals the remote."
scope: ["plugins/orchestrator/orchestrator.mjs ROOT_POLICY", "the packed orchestrator tarball and the installed profile", "git commit and push to VanUST/dsh-vanust main"]
---

Add a named policy section to the root system prompt: before fixing a bug or building a feature, examine the design the change lands in - a symptom often comes from a wrong owner, duplicated state or a missing state-machine case. If the approach is wrong, revise the approach and say so; a patch that only hides the symptom must be named as one. Then repack, install, commit and push.

Migrated from .dsh/taskboard.json (task task-mw9fyzby-pdwezt, revision 2).
