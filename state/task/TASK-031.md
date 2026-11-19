---
id: TASK-031
kind: task
title: "Orchestrator prompt: freeze volatile roster/board-debt per turn"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.327Z
updatedAt: 2026-11-17T15:52:39.327Z
acceptance:
  - text: "Within one turn the orchestrator system prompt text is byte-identical across steps even when the taskboard changes"
    done: false
  - text: "A new turn re-reads the taskboard and shows updated role/board-debt lines"
    done: false
  - text: "Deployed profile carries the change and the plugin still loads (dsh boots, section present)"
    done: false
  - text: "Evidence: rendered prompts from two steps with a board mutation in between compared, plus a new-turn re-render"
    done: false
boardId: task-mw99oj14-zwn120
nonScope: ["Kimi provider config, model catalog, flash-guard", "RATE_LIMIT retry policy (separate decision)", "reducing context size / trimming tool results (point 2-3 of the report)"]
resultArtifacts: [/home/iustimov/dsh-kit/plugins/orchestrator/orchestrator.mjs, /home/iustimov/dsh-kit/plugins/cc-dsh-orchestrator-0.1.15.tgz, /home/iustimov/.npm/dsh/profiles/web/node_modules/@cc/dsh-orchestrator/orchestrator.mjs, /home/iustimov/.npm/dsh/skills/audit-dsh-prompt-cache-invalidation/SKILL.md]
resultEvidence: ["node /tmp/freeze-probe.mjs (drives the real apply() with a fake taskboard/agent): PASS section renders the live board; PASS mid-turn board writes keep the SAME system prompt; PASS mid-turn writes are really not applied yet; PASS another session turn/start does not refresh; PASS this session turn/start re-reads the ledger; PASS freezePerTurn memoises until freeze(); section length 5505 chars unchanged through 3 board writes; exit 0", "node scripts/pack-plugin.mjs --dir plugins/orchestrator -> 0.1.14 -> 0.1.15, sha256 47a663419b751ab7b0a08462ac3d55efa2f94b6ed007fd930f8d7a6fcf55839a, exit 0", "cd ~/.npm/dsh/profiles/web && corepack pnpm@11.7.0 add .../cc-dsh-orchestrator-0.1.15.tgz -> Done in 1.7s, exit 0; installed package.json 0.1.15", "sha256sum repo vs installed orchestrator.mjs -> both 8364dcec4cfab3d4a51c2c3c2c8c3a96dc3932a82e024546507a4d844cf78a20; diff -q SAME_BYTES", "node scripts/check-portability.mjs -> 17/17 PASS, exit 0; node scripts/check-documentation.mjs -> documentation ok, exit 0", "session-log scan over 8 days: 67/69 deepseek-root full misses and 50/51 kimi-root full misses coincide with a system/message re-render; deepseek children 0/0 over 12 sessions with 200+ calls"]
resultSummary: "Root orchestrator system prompt is now rendered once per turn instead of once per request. freezePerTurn(render) memoises the ROOT_POLICY + role catalog + board debt block, and an agent-scoped session/event listener drops the memo on turn/start, so every step of one turn shares a byte-identical system prompt. Board writes inside the turn (task_create/update/close, delegate_task) no longer rewrite it. Shipped as @cc/dsh-orchestrator 0.1.15 (repo source + tarball + installed profile, identical sha256 8364dcec...). Measured from session logs: kimi-coding root sessions 16.6M -> 4.6M fresh input (-72%); deepseek root orchestrators 56.4M -> 42.8M (-24%); children unchanged (0%, static CHILD_POLICY). The 15:18-15:26 kimi window that ate the 5-hour quota goes 2.56M -> 0.53M fresh."
scope: ["plugins/dsh-orchestrator (source of @cc/dsh-orchestrator)", "installed profile copy at /home/iustimov/.npm/dsh/profiles/web/node_modules/@cc/dsh-orchestrator", "any repo test/check script that covers the plugin"]
---

Root orchestrator system prompt is rebuilt on every request: renderRoleCatalog + renderBoardDebt read the live taskboard, so every task_update/task_close/delegate_task changes the system prompt and invalidates the provider prefix cache. On kimi-coding this re-billed the whole 200-310K context (19/20 calls with cacheRead=1792), burning a 5-hour quota in 8 minutes. Render the volatile block once per turn so it changes at most once per turn, keeping the cached prefix stable across steps.

Migrated from .dsh/taskboard.json (task task-mw99oj14-zwn120, revision 3).
