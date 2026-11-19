---
id: TASK-080
kind: task
title: "Review readable design-map layout"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.970Z
updatedAt: 2026-11-17T15:52:39.970Z
acceptance:
  - text: "Severity-ranked findings with file:line and reproduction."
    done: false
  - text: "Verify measured label sizing across DejaVu fallback, collision with plain rectangles, cycle/back-edge and human-position preservation."
    done: false
  - text: "Verify all prior HIGH/MEDIUM/LOW findings are closed: plain-rectangle validation, remove bindings, human arrows to plain shapes, styling preservation, SAFETY fallback, empty labels and asserting evidence."
    done: false
  - text: "Verify validator can fail and packed tarball matches final source."
    done: false
boardId: task-mwbzp025-8sckxk
nonScope: ["No edits and no live :3080 profile changes.", "Do not re-run full browser proof unless a specific visual defect needs reproduction."]
owner:
  kind: agent
  label: REVIEWER
  sessionId: e69c228f-ee58-4a75-b566-2cdd82504074
ownerRole: REVIEWER
preset: reviewer
resultEvidence: ["reports/design-map-layout/validator.log: A-L + G2 all assert PASS, exit 0", "reports/design-map-layout/font-metrics.log: DejaVu max 1.169 < SAFETY 1.20, exit 0", "make verify exit 0: 17/17 packaging and documentation", "0.1.21 packaged index/layout/package/README sha256 equal source", "reviewer reproductions: plain-rect overlap/crossing now refused; remove bindings cleaned; human arrows preserved"]
resultSummary: "Independent review ran twice. First pass found one HIGH (validation ignored plain human rectangles), three MEDIUM (dangling remove bindings, detached human arrows to plain shapes, insufficient DejaVu safety margin) and LOW evidence/empty-label/comment issues. All HIGH/MEDIUM and the actionable LOWs were closed and re-reviewed; final remaining notes are documented risks (rebuilt arrows re-route, rotated label offset, untracked delivery files), not defects. Packaging/source equality and make verify were checked."
role: REVIEWER
scope: ["Read/run plugins/design-map and reports/design-map-layout artifacts", "Temporary copies/fixtures outside product scenes"]
sessions:
  - sessionId: e69c228f-ee58-4a75-b566-2cdd82504074
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Independently review the design-map layout pipeline and rendered evidence. Look for geometry, graph-layout, CAS/preservation, validation and packaging defects rather than restating the implementation.

Migrated from .dsh/taskboard.json (task task-mwbzp025-8sckxk, revision 8).
