---
id: TASK-050
kind: task
title: "Fix audit P0/P1: notify display, proof-guard edits, skill-evolve registry, cleanup"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.561Z
updatedAt: 2026-11-17T15:52:39.561Z
acceptance:
  - text: "notify passes the resolved DISPLAY to the one env object it spawns with, and a non-zero overlay exit no longer clears the finished list; proven with a probe that fakes the notifier and shows DISPLAY=:1 and that a failed exit keeps the card state"
    done: false
  - text: "proof-guard allows editing an existing test file that has no PROOF header while still refusing to CREATE a test without one; both directions proven with a probe"
    done: false
  - text: "skill-evolve's inventory includes the in-process registered skill names (or refuses to evolve a name the runtime registry owns), proven by counting 39 + 20 = 59 and by an evolve attempt on a packaged name"
    done: false
  - text: "DEPLOYMENT's 'twelve plugins' count matches the table; work-modes is removed from install.sh/inventory/tarballs (or documented why it stays installed)"
    done: false
  - text: "godot-mcp either stops claiming mcp__godot__* tools when none are registered or is demoted to the presets; decision recorded"
    done: false
  - text: "make verify green, versions bumped+repacked where code changed"
    done: false
boardId: task-mwap3cpq-yjgdhv
nonScope: ["MCP rows moving into presets - that is a separate design decision (do not change mcp-servers.json or the home-layer rows here)", "the other chat's uncommitted session-store guard and image-window plugin - report, never edit", "any change to role presets, taskboard or design-map"]
scope: ["plugins/notify, plugins/proof-guard, plugins/skill-evolve, plugins/godot-mcp, install.sh/inventory.json (work-modes removal), rules/DEPLOYMENT.md count", "the three supporting probes under /tmp"]
---

Fix the two P0 and the small P1/P2 defects the 2026-11-10 audit found, except the MCP placement decision and the other chat's uncommitted work: the notify DISPLAY loss, proof-guard denying edits to legacy tests, skill-evolve's blind spot for packaged skills, the stale plugin count, work-modes dead weight, and godot-mcp's overclaim. Prove each with a probe, bump/repack the changed plugins, keep make verify green.

Migrated from .dsh/taskboard.json (task task-mwap3cpq-yjgdhv, revision 1).
