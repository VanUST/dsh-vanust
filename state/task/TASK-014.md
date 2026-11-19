---
id: TASK-014
kind: task
title: "Remove the two-subagent cap"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.119Z
updatedAt: 2026-11-17T15:52:39.119Z
boardId: task-mw3fzymd-e0b6ax
nonScope: ["Do not delete the work-modes package or its tarball", "Do not change subagent maxDepth (nesting), the model policy or the Kimi routes"]
resultEvidence: ["dsh --profile web --dump-config | grep -cE 'id: work-modes' → 0 (row gone from the composed tree)", "dump of the composed tree shows: - id: subagent / name: '@deepseek-ai/dsh-subagent' / config: / maxActiveSubagents: 64", "installed profile patch: 0 rows with id: work-modes; the only mention is the explanatory comment; diff against the kit patch → identical", "plugins/inventory.json → work-modes mounted: false; 16 rows, 15 mounted", "node scripts/check-documentation.mjs → documentation ok", "node scripts/check-portability.mjs → 17/17 passed", "node scripts/pack-plugin.mjs --dir plugins/orchestrator → 0.1.12 (guidance no longer says 'at most two children at once')"]
resultSummary: "The two-subagent cap is gone. `@cc/dsh-work-modes` (default limit 2 — the cap that bit) is no longer mounted: the composed web profile has zero work-modes rows, the inventory records mounted: false, and the package/tarball stay so it can be re-enabled with one row. The harness pool now sets the only ceiling at maxActiveSubagents: 64 (default 8), so a removal does not become a new cap of 8. The orchestrator's prompt no longer says 'at most two children at once'. Docs updated and both kit checks pass. Operator step: restart dsh web for the running host to drop the old row."
scope: ["profile/cordis.patch.yml — remove the work-modes insert, add maxActiveSubagents to the subagent row", "plugins/inventory.json — work-modes mounted flag", "plugins/orchestrator/orchestrator.mjs — delegation-width guidance, repacked", "rules/DEPLOYMENT.md — the work-modes sentence and the subagent capacity"]
---

Remove the cap that stops a session at two concurrent subagents. Deliver: the work-modes row unmounted (its limit defaults to 2 and is the cap the operator hit), the inventory and DEPLOYMENT.md agreeing that it is no longer mounted, the harness's own capacity raised from its default 8 to 64 so a new ceiling is not hit next, the orchestrator prompt no longer telling the agent "at most two children at once", and proof that the composed profile carries no cap at 2.

Migrated from .dsh/taskboard.json (task task-mw3fzymd-e0b6ax, revision 2).
