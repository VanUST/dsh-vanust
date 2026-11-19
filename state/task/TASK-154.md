---
id: TASK-154
kind: task
title: "Ship: docs, scene contract, owner case, packed 0.1.13 and commit"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.110Z
updatedAt: 2026-11-17T15:52:41.110Z
boardId: task-mwjbs6oq-q73l65
inline: true
nonScope: ["restarting dsh web / installing into the live profile (the chat would drop)", "changing designmap/model.yaml"]
resultEvidence: ["plugins/cc-dsh-designmap-0.1.14.tgz sha256 06efd1ae85509ad96ef49a5c8b8e868a6a7f774e42c82e911d75c2e459729d5f", "git commit 6e7b54d", "make verify: portability + documentation checks pass (after allowlisting two vendored generated files)", docs/cases/design-map-readable-no-label-over-a-node-audit-can-fail.json, "SCENE-CONTRACT.md and plugin README updated with labelBox/labelLines, refusal codes and known limitations"]
resultSummary: "Shipped as @cc/dsh-designmap 0.1.14 (tarball packed, 0.1.12/0.1.13 removed), plugin README and SCENE-CONTRACT.md document the plate contract, the layout-stage refusals, the theme/zoom/legend behaviour, the audit command, the fixtures and the known limitations; the owner requirement is recorded as a case; make verify and 111/111 tests pass; commit 6e7b54d."
scope: [plugins/designmap/README.md, plugins/designmap/package.json, docs/designmap/SCENE-CONTRACT.md, "docs/cases/**", plugins/inventory.json, "plugins/cc-dsh-designmap-*.tgz", "git commit"]
---

Ship the readability fix as @cc/dsh-designmap 0.1.13: update the plugin README (labelBox/labelLines, rectangle lint rules and refusals, theme/zoom/legend behaviour, the audit command and fixtures), update docs/designmap/SCENE-CONTRACT.md, record the owner requirement as a case, pack the tarball, refresh the inventory entry and commit.

Migrated from .dsh/taskboard.json (task task-mwjbs6oq-q73l65, revision 3).
