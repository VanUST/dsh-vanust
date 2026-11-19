---
id: TASK-027
kind: task
title: "Verify the UX/UI testing skills after restart and harden them for Windows"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.275Z
updatedAt: 2026-11-17T15:52:39.275Z
acceptance:
  - text: "All six skills load from the live catalog with their bodies"
    done: false
  - text: "vitest, Playwright (bridge/axe/keyboard), pixelmatch goldens, JSONL gate and trace generation all pass again"
    done: false
  - text: "make verify still passes"
    done: false
  - text: "Each skill's commands either run on Windows as written or name the Windows equivalent; no `export`/`$HOME`/`curl|bash`/`grep` left unqualified"
    done: false
  - text: "The repacked tarball is installed and the installed copy matches the source"
    done: false
boardId: task-mw9568tc-ve4u1p
nonScope: ["The handoff removal (already shipped and live; only verify it stays removed)", "A real Windows run (no Windows host available) — static audit plus cross-platform commands only", "Taskboard history or unrelated plugins"]
resultArtifacts: [plugins/cc-dsh-skills-0.1.10.tgz, plugins/skills/skills/maestro-mobile-flows.md, plugins/skills/skills/test-run-observability.md, plugins/skills/skills/visual-golden-tests.md, .cache/ux-skills-proof/REPORT.md]
resultEvidence: ["tools.skill for six names → provider runtime, 4790/3561/5119/4861/4624/4348 chars; typeof tools.handoff === undefined", "npx vitest run → 4 passed", "npx playwright test → 3 passed (3.7s)", "goldens: identical 0, 2px shift 171/232404 (exit 1), dynamic clock masked 0", "node tools/log-summary.mjs → 10 events, all ok; TRACE=1 → 3 trace.zip (1.2 MB, 67 KB, 96 KB)", "maestro --version → 2.12.1", "make verify → 17/17 portability, documentation ok; 15 tarballs, one cc-dsh-skills tarball", "installed @cc/dsh-skills 0.1.10; Windows block present (PowerShell, bsdtar, On Windows), 20 skill files", "control-character scan of the six bodies → 0 in each"]
resultSummary: "After the dsh web restart all six skills load from the live catalog with provider=runtime, and the handoff tool is gone from the registry. Every proof was re-run on this host: vitest 4/4, Playwright 3/3 (bridge, axe clean-vs-broken, keyboard), pixelmatch 0/171/0, JSONL gate 10 ok, three trace zips, Maestro 2.12.1; make verify 17/17 plus documentation. The bodies were then audited for POSIX assumptions and hardened for Windows in @cc/dsh-skills 0.1.10: Maestro has a native Windows install path (zip, maestro.bat, user PATH, no bash), env-var and trace-inspection commands name PowerShell/cmd equivalents, visual goldens require a bundled font and one baseline per OS, path.join and the run-id character replacement keep artifact names legal. A control-character scan of all six bodies is clean."
scope: ["plugins/skills/skills/{canvas-test-bridge,property-based-domain-tests,visual-golden-tests,a11y-keyboard-audit,maestro-mobile-flows,test-run-observability}.md", "the live skill catalog and .cache/ux-skills-proof proof harness", "plugins/skills tarball + installed web profile (version bump if bodies change)", "platform notes only; no new skills and no change to unrelated skills"]
---

Confirm the six new skills are live after the dsh web restart, re-run every proof procedure on this host, audit each skill body for POSIX-only assumptions, and make the commands/notes correct for a Windows host (npm/npx, PowerShell env, Maestro install/PATH, fonts, paths) without weakening the Linux proof.

Migrated from .dsh/taskboard.json (task task-mw9568tc-ve4u1p, revision 2).
