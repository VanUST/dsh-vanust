---
id: TEST-036
kind: test
title: "Preset-aware MCP tool families leave the header"
status: verified
revision: 1
createdAt: 2026-11-17T15:52:44.332Z
updatedAt: 2026-11-17T15:52:44.332Z
authorRole: backend
caseId: preset-aware-mcp-tool-families-leave-the-header
evidenceRefs: []
frozenHash: 4c93c80719f5de56e031d83b51bfab9e94250321b12f08a2e72a12048d758b49
---

Each preset must receive only the MCP tool families its job needs, and the restriction must remove schemas from the derived request header rather than merely refusing calls: Playwright only for standard/orchestrator/ux, Godot only for standard and backend/ux/reviewer/critic inside a Godot workspace, research/docs no MCP family, and Hindsight never hidden.
