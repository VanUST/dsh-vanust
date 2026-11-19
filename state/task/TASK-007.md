---
id: TASK-007
kind: task
title: "Wire RTK, Headroom, SkillClaw and Babysitter into the kit"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.031Z
updatedAt: 2026-11-17T15:52:39.031Z
acceptance:
  - text: "make verify exits 0"
    done: false
  - text: "each integration has a recorded command and output, not a claim"
    done: false
  - text: "the live machine is either converged or the one manual step is stated"
    done: false
boardId: task-mvp54a99-h2e18i
nonScope: ["Committing to git", "Restarting the live GUI (the human's call)", "Rewriting the kit's existing plugins"]
resultArtifacts: [reports/integration-2026-10-26/handoff.html, reports/integration-2026-10-26/wiring.html]
resultEvidence: ["make verify → 17/17 portability and packaging checks passed; documentation ok (exit 0)", "node scripts/rtk-selftest.mjs → PASS, 5 shrank / 3 passed, 35,746 B saved, exit 0", "dsh headless --patch profile/headroom.patch.yml → PATCH_OK; /stats 0 → 2 requests", "compressed tool_result: usage.input_tokens 19955 → 8208; proxy avg_compression_pct 59.1", "node scripts/babysitter-selftest.mjs → SELFTEST PASSED, run id 01M5VXM4E5GN5DG9NTJZGNYMXD, task status review", "live skill_inventory call in the running GUI: library /home/iustimov/.npm/dsh/skills, archivedEntries 1", "start.sh shim test → \"web --patch /home/iustimov/.npm/dsh/headroom/patch.yml --port 3080\"; HEADROOM=0 → \"web --port 3080\""]
resultSummary: "All four projects are wired and proven on the running product. RTK: binary (Apache-2.0 oss, 1.1.0) + @cc/dsh-rtk post-execute seam; the model received \"[rtk: the `git-log` filter replaced 7383 B...\" in a real session. Headroom: proxy 0.41.0 in the request path behind a launcher health-gate; 19 955 → 8 208 input tokens on a 61 KB tool result, streaming intact. SkillClaw: native @cc/dsh-skill-evolve over the harness's own SKILL.md root; a written skill appeared in this live session's catalog and was archived live. Babysitter: CLI adapter; one run = one taskboard task ending in review, journal steps as timeline notes. make verify exits 0 (17/17 portability, 15 plugins named, 16 mounted rows documented)."
scope: ["plugins/rtk, plugins/skill-evolve, plugins/babysitter", "profile/cordis.patch.yml, profile/headroom.patch.yml", "scripts/headroom.mjs, scripts/rtk-selftest.mjs, scripts/babysitter-selftest.mjs", "start.sh, NOTICE, README.md, USERGUIDE.md, rules/DEPLOYMENT.md, plugins/inventory.json"]
---

Integrate the four upstream projects into dsh-kit under the agreed hybrid policy, prove each on the running product, and leave the kit's gate green.

Migrated from .dsh/taskboard.json (task task-mvp54a99-h2e18i, revision 3).
