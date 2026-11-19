---
id: TASK-009
kind: task
title: "Audit the four integrations against the running server"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.056Z
updatedAt: 2026-11-17T15:52:39.056Z
acceptance:
  - text: "each feature has its own live evidence"
    done: false
  - text: "the found defect is fixed and proven in the running server"
    done: false
boardId: task-mvp86bb6-v6pw8p
resultEvidence: ["RTK live: bash `git log --oneline -40` returned \"[rtk: the `git-log` filter replaced 3026 B ... [+36 lines omitted]\"", "RTK root cause from the plugin's own trace: {\"stage\":\"skip\",\"why\":\"unclassified\",\"command\":\"cd /home/iustimov/dsh-kit && git log --oneline -40\"}", "Headroom live: /stats api_requests 49, requests_compressed 8, and dump-config shows llm-deepseek baseURL http://127.0.0.1:8787", "Headroom gate: start.sh with a foreign listener on 8787 printed 'reason: port 8787 is already held...' and booted without the overlay", "skill-evolve live: zeta-live-audit created, appeared in this session's catalog, parsed by the provider yaml parser, archived, catalog reverted", "babysitter live: babysitter_status on a 501-entry journal returned state completed (seq 501), journalScanned 501, failedTasks [first-task exit 1]", "make verify 17/17 + documentation ok"]
resultSummary: "All four features named, proven wired in the running server, and stress-tested. RTK was mounted but ineffective: the harness prefixes every shell call with `cd <cwd> &&` and the classifier refused compound commands, so 100% of real commands were skipped while the pristine-command selftest passed. Fixed by unwrapping a leading `cd <path>`, with that exact shape added as a selftest case; proven live (3026 B → compact projection). Headroom was down because the proxy had died before the previous boot, so the launcher correctly refused the overlay; restarted the proxy and applied the overlay, now 49 requests / 8 compressed. No restart was required: a config-triggered plugin re-apply reloads new plugin code."
---

For each of the four integrated features, name it, prove it is wired in the RUNNING server, and break it on purpose. Found and fixed one defect the review missed: the rtk classifier refused every real harness command because the harness prefixes each shell call with `cd <cwd> &&`.

Migrated from .dsh/taskboard.json (task task-mvp86bb6-v6pw8p, revision 4).
