---
id: TASK-066
kind: task
title: "Fix design-map: empty write wipes the scene, validation holes"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.764Z
updatedAt: 2026-11-17T15:52:39.764Z
acceptance:
  - text: "`design_map write` with no nodes is refused with a named code unless an explicit clear flag is passed; a `write` over an existing non-empty scene also requires the current revision (compare-and-set), so a stale writer cannot wipe a human's map"
    done: false
  - text: "Scene validation refuses duplicate node ids, a node that is not an object, an edge whose from/to is not a known node, and unknown ids in remove; each refusal leaves the file byte-identical"
    done: false
  - text: "The panel's save path is subject to the same node/edge caps as the tool (5000 elements cannot be saved while the tool caps at 1000)"
    done: false
  - text: "Proven with probes: empty write refused and 5-element scene intact; duplicate id refused; ghost edge refused; stale rev refused; panel cap enforced; a valid upsert still works"
    done: false
boardId: task-mwatqfo1-ro5zcj
nonScope: ["no change to the panel UX beyond surfacing the refusals", "no taskboard or rules changes"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
ownerRole: BACKEND
role: BACKEND
scope: ["plugins/design-map/index.js + client.js", "plugins/design-map/README.md and package.json + tarball"]
sessions:
  - sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Close the design-map data-loss and validation holes found by the adversarial test: an empty `write` currently deletes a 5-element scene despite the module claiming it is refused; duplicate ids, non-object nodes and edges to unknown nodes are accepted or silently dropped; a whole-scene write has no revision check; and the panel path bypasses the caps.

Migrated from .dsh/taskboard.json (task task-mwatqfo1-ro5zcj, revision 8).
