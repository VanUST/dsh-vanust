---
id: TASK-153
kind: task
title: "Acceptance: readability audit, dense/cyclic/multiline fixtures, negative control"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.092Z
updatedAt: 2026-11-17T15:52:41.092Z
boardId: task-mwjbs32u-pakwvu
inline: true
nonScope: ["the live designmap/model.yaml (the repo map is re-rendered, not edited)"]
resultEvidence: ["node bin/audit-scene.mjs fixtures/readability -> v.dense 1969x585 0/0/0, v.cyclic 0/0/0, v.multiline 0/0/0, exit 0", "node bin/audit-scene.mjs --scene harness/scenes/m0/v.context.scene.json -> 4 label_over_node, exit 1", "node bin/audit-scene.mjs --scene harness/scenes/fixture/v.context.scene.json -> 3 label_over_node, exit 1", "node --test test/readability.test.mjs -> 3/3 (incl. the negative control)", "node bin/acceptance.mjs -> ok:true with the readability section"]
resultSummary: "bin/audit-scene.mjs renders a workspace (or one scene file) and reports plate-node, plate-plate and edge-node collisions, plates outside the canvas, minimum clearance, aspect and density, exiting 1 on any collision. fixtures/readability adds dense (20 nodes), cyclic and multiline scenes, also emitted as harness/scenes/readability; the pre-fix harness scenes are kept as the red control (4 and 3 labels over nodes). The audit and the acceptance both prove the check can fail."
scope: [plugins/designmap/bin/audit-scene.mjs, "plugins/designmap/fixtures/readability/**", "plugins/designmap/harness/scenes/readability/**", plugins/designmap/test/readability.test.mjs, plugins/designmap/bin/acceptance.mjs]
---

Give readability a command that can fail: bin/audit-scene.mjs renders a workspace and reports plate-node, plate-plate, edge-through-node collisions, plates outside the canvas, clearance and density, exiting 1 on any collision; add dense/cyclic/multiline fixtures, a harness scene set and a negative control that proves the audit sees a broken scene.

Migrated from .dsh/taskboard.json (task task-mwjbs32u-pakwvu, revision 3).
