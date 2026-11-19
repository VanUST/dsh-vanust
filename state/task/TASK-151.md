---
id: TASK-151
kind: task
title: "Core: one owner for label geometry, ELK label reservation, collision refusal"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.057Z
updatedAt: 2026-11-17T15:52:41.057Z
acceptance:
  - text: "scene edges carry labelBox; renderer never re-measures"
    done: false
  - text: "ELK reserves label space: the layer corridor widens with label width"
    done: false
  - text: "label_over_node / label_label_overlap / edge_through_node are errors and refuse render"
    done: false
  - text: "hidden negative control: a seeded colliding scene is refused, a clean scene renders"
    done: false
  - text: "deterministic: two renders byte-identical; 25-node layout <= 1500 ms"
    done: false
boardId: task-mwjaypic-em827j
inline: true
nonScope: ["plugins/designmap/client/** (client task owns it)", "designmap/model.yaml content (the map itself is re-rendered, not edited)", "profile install / live :3080 restart"]
resultEvidence: ["node --test test/*.test.mjs -> 111/111 pass", "node bin/audit-scene.mjs /home/iustimov/dsh-kit/designmap -> v.context 1306x367 0/0/0 collisions; v.plugins 0/0/0; exit 0", "node bin/audit-scene.mjs --scene harness/scenes/m0/v.context.scene.json -> 4 label_over_node, exit 1 (pre-fix red)", "two renders byte-identical; perf 25 nodes worst 548 ms vs 1500 budget", "ELK corridor probe: 40 px label -> 96 px corridor vs 28 px without the label"]
resultSummary: "Core now owns edge-label geometry end to end: edgeLabelSize is the single metric, the size is handed to ELK so the layer corridor widens, the plate is placed on its edge against the final boxes, the scene carries labelBox+labelLines, and placementIssues validates plates and edge bodies as rectangles/segments. render retries 1.45x/2x spacing and refuses label_collision / edge_through_node; the scene lint reports the same geometry as warnings after a human overlay. 111/111 tests; the real map and the dense/cyclic/multiline fixtures audit clean; the pre-fix harness scenes fail the audit (red control)."
scope: [plugins/designmap/src/text.mjs, plugins/designmap/src/layout.mjs, plugins/designmap/src/lint.mjs, plugins/designmap/src/render.mjs, plugins/designmap/src/schema.mjs, plugins/designmap/src/svg.mjs, "plugins/designmap/test/*.test.mjs", "plugins/designmap/bin/*.mjs", "plugins/designmap/fixtures/*"]
---

Make designmap-core the single owner of edge-label geometry: compute edge label size once, hand it to ELK as an edge label so the layout reserves room, emit labelBox in the scene, validate label boxes (node/label) and edge segments (through node) with error severity, retry layout with larger spacing and refuse label_collision instead of emitting a colliding scene.

Migrated from .dsh/taskboard.json (task task-mwjaypic-em827j, revision 4).
