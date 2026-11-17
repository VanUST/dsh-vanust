---
id: TASK-025
kind: task
title: "Ship the UX/UI testing skill set in @cc/dsh-skills"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.251Z
updatedAt: 2026-11-17T15:52:39.251Z
boardId: task-mw93tbb3-khe1ih
---

Add six model-invocable skills to dsh-kit's skills plugin: a window.__APP_TEST__ bridge for canvas/editor UIs, Vitest+fast-check property tests for domain logic, pixelmatch/Argos visual goldens, axe-core + keyboard-only a11y audits, Maestro mobile flows, and JSON-log/Playwright-trace observability. Bodies live in plugins/skills/skills/, are registered in plugins/skills/index.js, packed as a new @cc/dsh-skills tarball, installed into the web profile, and named in README/DEPLOYMENT/profile comments without duplicating the existing ui-testing, playwright-mcp-canvas-ui-sweep, proof-not-tests or tests-that-could-fail skills.

Migrated from .dsh/taskboard.json (task task-mw93tbb3-khe1ih, revision 3).
