---
id: TASK-308
kind: task
title: "P3: retire design-map v1 completely"
status: done
revision: 9
createdAt: 2026-11-24T11:48:35.431Z
updatedAt: 2026-11-24T12:40:11.968Z
acceptance:
  - text: "the designmap plugin registers exactly the four page tools and no v1 tool remains"
    done: false
  - text: "no v1 file is left in the tree: model/views/overlays/annotations/manifest, out/*.scene.json, the scene contract and the v1 client modules"
    done: false
  - text: "grep finds no reader of designmap/manifest.json and no import of a deleted module anywhere in the repo"
    done: false
  - text: "the profile allow-lists name only the four page tools for designmap, and every doc that listed the seven v1 tools is corrected"
    done: false
  - text: "the package suite is green after the v1 tests are removed, and make verify exits 0"
    done: false
  - text: "the plugin is repacked at the new major and the tarball matches dist"
    done: false
boardId: task-mwumsjzk-6thxg8
nonScope: ["No analysis-plugin change (design_drift/analysis_stale and designRef are the next row)", "No state-panel copy or behaviour change", "No page content change: designmap/pages/system.excalidraw stays as it is", "No install into :3080 and no kit-update"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-246]
resultEvidence: ["fake-context apply(): registered tools map_edit, map_list, map_read, map_render; commands designmap", "designmap test index.test.mjs 'the orchestrator receives exactly the four page tools' passes; package 18/18", "grep designmap/manifest.json|designMapFile|manifest.mjs over plugins scripts profile rules: no hits; scan of 218 live modules: 0 broken imports or deleted-path references", "analysis proof 130/130 checks passed; make test 67/67 passed (49 test files, 18 proof scripts); make verify 20/20", "tarball cc-dsh-designmap-1.0.0.tgz sha256 29930baf… matches dist; cc-dsh-analysis-0.1.21.tgz sha256 4e768449…", "profile allow-lists name only map_edit/map_list/map_read/map_render; the architect persona now names map_edit; designMapFile key removed"]
resultSummary: "design-map v1 is gone and the map no longer touches project state. The plugin went to 1.0.0 and registers exactly four page tools (map_list/map_read/map_edit/map_render) plus the /designmap command; deleted are the model files, out/*.scene.json, 19 v1 source modules, 4 v1 client modules, harness, fixtures, 5 v1 bin scripts, 26 v1 tests and the scene contract. The analysis plugin lost designMapFile/designOf, the designRef capture and the design_drift/analysis_stale gate, and was repacked at 0.1.21. Profile: the designMapFile key is gone, both allow-lists name only the four page tools, and the architect persona now says map_edit. make test 67/67 and make verify 20/20 green, both tarballs match their sources."
role: BACKEND
scope: ["plugins/designmap/ — src, index.js, client, tests, package.json, tarball", "profile/cordis.patch.yml — the two designmap allow-lists", "docs/ and README sections that list the v1 tools, the scene contract or the manifest", "designmap/ — the v1 model files and out/*.scene.json"]
---

Retire design-map v1 completely, now that the page-based map is accepted: delete the v1 model files (model.yaml, views.yaml, overlays.json, annotations.json, manifest.json), the rendered out/*.scene.json, the scene contract and its 14 lint rules, the label plates and ELK layout, the seven v1 tools (designmap_apply/lint/status/export/scan/open/render) and the v1 client modules that nothing imports since the editor moved into Project state → Map. Keep exactly the four page tools (map_list/map_read/map_edit/map_render), the page store, tidy, the headless Excalidraw renderer and the exported PageEditor. Correct every doc and the two profile allow-lists that still name the v1 tools, remove the v1 tests with their code, prove no reader of manifest.json and no import of a deleted module remains, keep make verify green, and repack at the new major. Old maps are allowed to become unreadable: no shim, no alias, no dual reader.
