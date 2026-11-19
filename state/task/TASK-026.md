---
id: TASK-026
kind: task
title: "Remove the handoff plugin from dsh-kit"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.263Z
updatedAt: 2026-11-17T15:52:39.263Z
acceptance:
  - text: "`make verify` passes after the removal"
    done: false
  - text: "`plugins/inventory.json` has no handoff row and no cc-dsh-handoff tarball remains under plugins/"
    done: false
  - text: "profile/cordis.patch.yml no longer mounts it and the installed web profile no longer resolves @cc/dsh-handoff"
    done: false
  - text: "The orchestrator policy no longer instructs a handoff, and visual-explanations no longer lists it as a surface"
    done: false
  - text: "No live (non-historical) reference to the handoff tool remains in the tracked tree"
    done: false
boardId: task-mw940v6z-1f01au
nonScope: ["The new UX/UI testing skills (separate task)", "Taskboard history records under .dsh/ (append-only ledger)", "Other plugins or the model policy"]
resultArtifacts: [plugins/inventory.json, profile/cordis.patch.yml, plugins/orchestrator/orchestrator.mjs, plugins/skills/skills/visual-explanations.md, rules/DEPLOYMENT.md]
resultEvidence: ["rm -rf plugins/handoff plugins/cc-dsh-handoff-0.1.6.tgz → no cc-dsh-handoff tarball remains; 15 tarballs on disk", "plugins/inventory.json row deleted; profile/cordis.patch.yml handoff block deleted", "profile pnpm install → Packages: +4 -1; node_modules/@cc/dsh-handoff absent; 15 @cc packages", "grep -rIn handoff (excluding .dsh ledger, .cache, reports) → no live references", "installed @cc/dsh-orchestrator 0.1.14 → grep -c handoff orchestrator.mjs = 0", "make verify → 17/17 portability checks, documentation ok; README/USERGUIDE each name 15 shipped plugins", "tarballs repacked and installed for the changed sources: orchestrator 0.1.14, taskboard 0.1.30, proof-guard 0.1.1, skills 0.1.8"]
resultSummary: "Removed the handoff capability from dsh-kit rather than only deleting docs: plugins/handoff and its tarball are gone, the inventory and profile rows are removed, the orchestrator policy no longer orders a handoff (milestone step, one-page rule and child 'final handoff' sentence rewritten), and visual-explanations now lists three rendering surfaces instead of four. README/USERGUIDE/DEPLOYMENT/NOTICE/provision-tools copy was updated, the proof-guard 'handoff evidence' wording became 'human review', and the installed web profile no longer resolves @cc/dsh-handoff. make verify passes with 15 shipped plugins and 20 mounted."
scope: ["plugins/handoff/ and plugins/cc-dsh-handoff-*.tgz", plugins/inventory.json, profile/cordis.patch.yml, plugins/orchestrator/orchestrator.mjs, "plugins/skills/skills/visual-explanations.md and index.js descriptions", "README.md, USERGUIDE.md, rules/DEPLOYMENT.md, NOTICE", "scripts/provision-tools.mjs (Chrome label only)", "the installed web-profile copy of @cc/dsh-handoff"]
---

Delete @cc/dsh-handoff and every promise built on it: the plugin source and tarball, its inventory and profile rows, the orchestrator prompt that orders a handoff at each milestone, the visual-explanations skill's handoff artifact row, README/USERGUIDE/NOTICE/DEPLOYMENT mentions, and the provision-tools label. After the change the kit must still pass `make verify`, mount without the plugin, and contain no live reference to a tool it no longer ships.

Migrated from .dsh/taskboard.json (task task-mw940v6z-1f01au, revision 3).
