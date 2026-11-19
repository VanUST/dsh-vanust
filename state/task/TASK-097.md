---
id: TASK-097
kind: task
title: "design_map 0.2.0: docs, tarball, proof report"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.213Z
updatedAt: 2026-11-17T15:52:40.213Z
acceptance:
  - text: "make verify exits 0 (17/17 portability, documentation ok) with tarball:matches-source and tarball:version-bumped green"
    done: false
  - text: "node reports/design-map-v2/cases.mjs exits 0 with 53 assertions"
    done: false
  - text: "node reports/design-map-layout/validator-cases.mjs still exits 0"
    done: false
  - text: "the report names the exact commands and the screenshots it produced"
    done: false
boardId: task-mwc9cdt0-4rshi5
inline: true
nonScope: ["the running :3080 profile and any restart", "reports/design-map-v2/screens are evidence, not code"]
resultArtifacts: [plugins/cc-dsh-design-map-0.2.0.tgz, plugins/design-map/README.md, reports/design-map-v2/EVIDENCE.md, reports/design-map-v2/harness/index.html]
resultEvidence: ["make verify -> 17/17 portability and packaging checks passed; documentation ok", "node scripts/pack-plugin.mjs --dir plugins/design-map --version 0.2.0 -> sha256 5d40a47f7506e29519cf405676b5614ca2116d52e4f2df3a714d0df40d547a58", "node reports/design-map-v2/gen-fixtures.mjs -> fixtures + views regenerated, exit 0; the repaired-live-map fixture matches the screenshot scene byte-for-byte", "harness render of the committed view fixture reproduced screens/03-layered-map.png byte-identically (sha256 1eef7a1e…)"]
resultSummary: "Packed @cc/dsh-design-map 0.2.0 (preview.js added to package files, one tarball kept), rewrote the plugin README around the visual vocabulary/preview/health contract (including the caps, layer order and the band-removal refusal), updated root README, USERGUIDE and the profile patch comment, and added the proof report reports/design-map-v2 (76-case proof, fixture generator, frame harness, view fixtures, screenshots, EVIDENCE.md with the six review findings and their fixes). make verify is green."
scope: [plugins/design-map/README.md, plugins/design-map/package.json, plugins/cc-dsh-design-map-0.2.0.tgz, README.md, USERGUIDE.md, profile/cordis.patch.yml, reports/design-map-v2/]
---

Ship the design-map v2 change as 0.2.0: plugin README and root docs describe the visual vocabulary and the preview/health contract; package.json lists preview.js and version 0.2.0; one 0.2.0 tarball matches the source; the profile patch comment is current; make verify passes; the proof report under reports/design-map-v2 holds the cases, fixtures, harness and screenshots that show the result.

Migrated from .dsh/taskboard.json (task task-mwc9cdt0-4rshi5, revision 4).
