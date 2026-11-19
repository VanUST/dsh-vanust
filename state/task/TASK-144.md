---
id: TASK-144
kind: task
title: "Align index.json rows to the contract (inline)"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.934Z
updatedAt: 2026-11-17T15:52:40.934Z
acceptance:
  - text: "index.json rows carry viewId and parent; no sceneFile; scenePath/sceneHash still resolve"
    done: false
  - text: "npm test passes and bin/acceptance.mjs ok:true with the demo scene hash unchanged"
    done: false
  - text: "Two index runs are byte-identical"
    done: false
boardId: task-mwj5hsrl-5z1ngq
inline: true
nonScope: ["scene bytes, lint severities, panel code, contract doc"]
resultEvidence: ["src/index-file.mjs rows: {viewId, title, level, direction, parent, scenePath, sceneHash, bytes}, sorted by viewId (sortById keys on .id, so the sort moved to viewId explicitly); sceneFile dropped; test/index.test.mjs asserts viewId + parent", "npm test: 53/53 pass, 0 fail; node bin/acceptance.mjs: ok true", "two --index runs byte-identical sha256:12163a054556ef88a807cacada558d53571bf8dc81333332be469043f03b9000; demo scene unchanged sha256:2c5fa9e8… (3314 B)", "index.json quoted: v.checkout parent grp.checkout, v.context parent null, scenePath out/<viewId>.scene.json, hashes match files"]
resultSummary: "Aligned index.json rows to SCENE-CONTRACT (viewId + parent, sorted by viewId, no sceneFile) after the BACKEND child twice reported no new inputs. Re-proved with the package's own harness: 53/53 tests, acceptance ok, two index runs byte-identical, demo scene hash unchanged."
scope: [plugins/designmap/src/index-file.mjs, plugins/designmap/test/index.test.mjs, "docs/designmap/M0-EVIDENCE.md (one line on the index shape)"]
---

Align index.json rows to the pinned contract (viewId, parent; drop sceneFile) and re-prove. The BACKEND child reported 'no new inputs' twice, so the orchestrator makes the three-field edit here and verifies it with the package's own test and acceptance harness.

Migrated from .dsh/taskboard.json (task task-mwj5hsrl-5z1ngq, revision 3).
