---
id: TEST-018
kind: test
title: "designmap v1 redesign accepted per spec milestones"
status: unverified
revision: 1
createdAt: 2026-11-17T15:52:43.950Z
updatedAt: 2026-11-17T15:52:43.950Z
authorRole: orchestrator
caseId: designmap-v1-redesign-accepted-per-spec-milestones
evidenceRefs: []
frozenHash: 4c93c80719f5de56e031d83b51bfab9e94250321b12f08a2e72a12048d758b49
---

Owner spec "Design Map — дизайн фичи v1": replace the geometry-drawing Excalidraw design map with a living document — semantic YAML model (immutable ids, zod) as source of truth, ELK deterministic layout, overlays for human visual edits that survive regeneration, a custom renderer panel in the DSH client (read-only by default, drill-down/search/legend/breadcrumb/stale badges), agent tools scan/apply/render/status/open/export with manifest-based stale detection, structured JSONL logs, SVG export — delivered as milestones M0 core, M1 read-only renderer, M2 edit mode, M3 living doc, M4 export+polish, with API tests before code (§12) and acceptance by log evidence.
