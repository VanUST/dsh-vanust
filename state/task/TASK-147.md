---
id: TASK-147
kind: task
title: "Contract: pin edge-label placement rule"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.986Z
updatedAt: 2026-11-17T15:52:40.986Z
acceptance:
  - text: "SCENE-CONTRACT.md states the label placement rule and the fallback + lint warning"
    done: false
  - text: "The text matches what core now does (verified by test/geometry.test.mjs)"
    done: false
boardId: task-mwj6ds1k-bhwywz
inline: true
nonScope: ["core code, renderer code, other contract sections"]
resultEvidence: ["docs/designmap/SCENE-CONTRACT.md edges[].labelAt row now states the longest-free-span rule, post-merge recomputation, midpoint fallback and the label_over_node warning", "Matches test/geometry.test.mjs: labels outside boxes on demo/perf25/overlay-moved node; fallback case reports label_over_node"]
resultSummary: "Pinned the edge-label placement rule in the scene contract: anchor on the longest free span outside every node box, recomputed after the overlay merge, midpoint fallback with a label_over_node warning."
scope: ["docs/designmap/SCENE-CONTRACT.md (edges[].labelAt rule)"]
---

Pin the edge-label placement rule that F1 implemented: labelAt sits on the longest free span of the polyline outside every node box, recomputed after the overlay merge; when no free span exists the polyline midpoint is used and lint reports label_over_node (warning).

Migrated from .dsh/taskboard.json (task task-mwj6ds1k-bhwywz, revision 3).
