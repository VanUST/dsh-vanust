---
id: TEST-021
kind: test
title: "Harness pin bump refused while dsh web runs"
status: stale
revision: 1
createdAt: 2026-11-17T15:52:44.013Z
updatedAt: 2026-11-17T15:52:44.013Z
authorRole: backend
caseId: harness-pin-bump-refused-while-dsh-web-runs
evidenceRefs: []
frozenHash: 6a38810421eb0c35dc631b18f4a532307bda0f78c4b5f9de4eaa838e1040611e
---

The kit must never replace the globally installed harness while a `dsh web` server is running: the live process keeps the composition it composed at boot while serving the new files, so the browser fails with "Failed to load plugins". A pin bump in that state is refused and reported, not applied.
