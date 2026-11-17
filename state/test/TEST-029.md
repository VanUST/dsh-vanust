---
id: TEST-029
kind: test
title: "Orchestrator header carries no shell tools"
status: stale
revision: 1
createdAt: 2026-11-17T15:52:44.172Z
updatedAt: 2026-11-17T15:52:44.172Z
authorRole: backend
caseId: orchestrator-header-carries-no-shell-tools
evidenceRefs: []
frozenHash: 6a38810421eb0c35dc631b18f4a532307bda0f78c4b5f9de4eaa838e1040611e
---

The orchestrator preset must not receive a shell: its request header carries read/write/edit but no bash and no pwsh, so the host policy that says "you have NO shell" matches the tool surface. Other presets keep their deny lists unchanged.
