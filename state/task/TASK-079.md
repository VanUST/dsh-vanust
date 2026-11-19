---
id: TASK-079
kind: task
title: "Implement readable design-map layout"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.952Z
updatedAt: 2026-11-17T15:52:39.952Z
acceptance:
  - text: "Multiline and long labels fit their containers across Arial/Helvetica-compatible and DejaVu fallback metrics."
    done: false
  - text: "Automatic placement follows graph structure, accounts for actual node sizes and every live rectangle, and prevents node overlaps with a defined gap; explicit coordinates are validated too."
    done: false
  - text: "Edges attach at boundaries and avoid all unrelated rectangles; cycles and backward edges remain readable."
    done: false
  - text: "Ordinary upsert preserves human-positioned design nodes and human arrows to non-design shapes; explicit layout has a clear contract and CAS protection."
    done: false
  - text: "remove repairs surviving bindings; validation detects dangling bindings and bounding-box violations."
    done: false
  - text: "Validation rejects clipping, overlap, non-finite geometry, unrelated-rectangle edge crossings and empty-label mismatch before writing."
    done: false
  - text: "Rendered evidence covers multiline/dense/cyclic/mixed scenes, plus a DejaVu-metric case; validator cases assert and exit non-zero on failure."
    done: false
  - text: "Packed tarball matches final source and make verify exits 0."
    done: false
boardId: task-mwbyq9ii-45c3dz
nonScope: ["Do not modify code-search integration/benchmark files or current taskboard data.", "Do not rewrite existing human node positions during ordinary upsert; an explicit layout operation may reposition them.", "No speculative autotest suite; prove in the real rendered panel/browser and keep only targeted regression coverage if genuinely needed under the repo rules.", "Do not change the running :3080 installation until the rendered proof is reviewed."]
owner:
  kind: agent
  label: UX/UI
  sessionId: b7de70dd-8768-4678-80fb-d14484c0d319
ownerRole: UX/UI
preset: ux
resultArtifacts: [plugins/design-map/layout.js, plugins/design-map/index.js, plugins/design-map/README.md, plugins/design-map/package.json, plugins/cc-dsh-design-map-0.1.21.tgz, reports/design-map-layout/EVIDENCE.md, reports/design-map-layout/validator-cases.mjs, reports/design-map-layout/validator.log, reports/design-map-layout/measure-font.mjs, reports/design-map-layout/font-metrics.log, reports/design-map-layout/gen-fixtures.mjs, reports/design-map-layout/fixtures.log]
resultEvidence: ["node reports/design-map-layout/validator-cases.mjs -> exit 0; PASS A-L + G2, incl. label_id refusal with byte-identical file, text label style, rebuilt-arrow style, dangling detection, repair", "node reports/design-map-layout/measure-font.mjs -> exit 0; DejaVu Sans max ratio 1.169 vs SAFETY 1.20", "node scripts/pack-plugin.mjs --dir plugins/design-map -> 0.1.21 tarball sha256 ac872fe0…7c1cf; packaged index/layout/package/README hashes equal source", "make verify -> 17/17 portability and packaging checks, documentation ok, exit 0", "sha256 design.excalidraw = 7c739ebd…217d5a1 (unchanged); rendering proof from the previous pass still valid"]
resultSummary: "Final LOW items closed and packaged as @cc/dsh-design-map 0.1.21. Rebuilt nodes now preserve rectangle style plus text-label colour/opacity/group/angle/link/lock and rebuilt-arrow stroke/group/opacity/arrowheads; label-id removal is refused with code label_id naming the owning node (no unlabeled node); stale human-overlap comment corrected; EVIDENCE safety 1.20, shipped generator path, A-L/G2; validator assertions A-L all PASS; tarball 0.1.21 matches source; make verify exit 0. No browser rerun because rendering of the fixtures is unchanged (only style preservation on human-styled elements, not exercised by fixture visuals)."
role: UX/UI
scope: [plugins/design-map/, reports/design-map-layout/, "Directly related documentation/checks only"]
sessions:
  - sessionId: b7de70dd-8768-4678-80fb-d14484c0d319
    label: UX/UI
    role: UX/UI
    status: sleeping
---

Implement the approved design-map layout pipeline so generated and updated Excalidraw maps are readable by humans: content-sized multiline nodes, graph-aware collision-free placement, preservation of human positions during upsert, obstacle-aware arrows, and validation before save.

Migrated from .dsh/taskboard.json (task task-mwbyq9ii-45c3dz, revision 13).
