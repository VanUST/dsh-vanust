---
id: TASK-145
kind: task
title: "F1: snap edge endpoints to node boundaries, keep edge labels out of node boxes"
status: done
revision: 1
createdAt: 2026-11-17T15:52:40.951Z
updatedAt: 2026-11-17T15:52:40.951Z
boardId: task-mwj64d96-0lymbb
ownerRole: BACKEND
---

Fix two geometry defects in designmap-core that the M1 renderer exposed when it drew the real scene faithfully. (1) Edge endpoints do not land on the node boundary: in fixtures/demo, e.api.db starts 8px outside its source box, e.api.worker ends 16px short of its target, e.payments.stripe and e.worker.payments each start 8px outside and end 8px short — CT-SCENE requires the first point on the source boundary and the last on the target boundary. (2) labelAt sometimes falls inside a node box: e.api.worker (135.9,49) is inside svc.checkout.api (24..164 × 44.33..88.33) and e.worker.payments (398.9,82) is inside the worker box (220..408). Both were verified by the orchestrator against the rendered scene, not inferred.

Migrated from .dsh/taskboard.json (task task-mwj64d96-0lymbb, revision 7).
