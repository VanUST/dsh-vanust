---
id: TASK-409
kind: task
title: "Design map v2 P1: page document, four agent tools, tidy and SVG"
status: done
revision: 9
createdAt: 2026-11-24T09:40:48.977Z
updatedAt: 2026-11-24T09:51:06.235Z
acceptance:
  - text: "a page is one file designmap/pages/<slug>.excalidraw holding a valid Excalidraw scene (type/version/source/elements/appState/files); an empty page reads as an empty outline without error"
    done: false
  - text: "map_edit builds every element itself from ops (node.add/move/resize/label, edge.add/label, element.delete, page.create/rename/delete, tidy) — the caller passes no seed, version, binding or point"
    done: false
  - text: "map_read returns the compact outline by default, exact JSON on request, and hints (node_overlap, off_canvas, edge_without_label) with no refusal"
    done: false
  - text: "map_render writes out/<page>.svg that a browser or an SVG reader accepts"
    done: false
  - text: "tidy places nodes in layers by edge direction and measurably reduces overlaps on a tangled page"
    done: false
  - text: "the four tools are reachable for orchestrator and architect through the profile allow-lists, and nothing else registered is unreachable"
    done: false
  - text: "the one-shot importer writes designmap/pages/system.excalidraw from designmap/model.yaml (11 nodes, 12 edges) and is then deleted; v1 files and v1 tools still work for the panel"
    done: false
  - text: "package tests and make verify are green; the plugin tarball is repacked"
    done: false
boardId: task-mwui88ms-8qi4bz
nonScope: ["No panel change (P2): client/*.jsx, client.js bundle and the frame stay as they are", "No analysis or state-panel change (P3), no designmap v1 deletion, no docs rewrite beyond a short README section for the new tools", "No case recording; verification level is proof (runs + quoted output)", "No touch of :3080, no kit-update, no install"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-242, REQ-243, REQ-244, REQ-248, REQ-249]
resultEvidence: ["importer (deleted after use): 11 nodes, 12 edges, 46 elements -> designmap/pages/system.excalidraw; overlaps 55 -> 0", "pages-demo exit 0: 4 nodes/3 edges read back as the same outline; edge_without_label hint; tangled page node_overlap then tidy 1 -> 0; empty page '0 node(s), 0 edge(s)'; SVG 544x280 2073 B valid per xmllint", "map_render on the imported page: designmap/out/system.svg, 6599 B, valid XML", "node --test test/*.test.mjs: 139 tests, 139 pass, 0 fail; make test ONLY=designmap: 29/29 files", "bin/tool-contract.mjs exit 0: pageSpecNames map_list/map_read/map_edit/map_render; map_edit requires page+op; 11 ops offered", "make verify exit 0, 0 FAIL lines, 20/20 packaging, tarball:matches-source PASS; tarball 0.1.27 == dist", "profile allow-lists: exactly seven designmap names per row (designmap_apply/lint/status + the four map_*), confirmed by grep"]
resultSummary: "P1 accepted: pages are single Excalidraw scene files; the four tools (map_list/map_read/map_edit/map_render) build their own elements, read back a compact outline with hints and never refuse on a crowded or empty page; tidy reduced 55 overlaps to 0 on the imported page and 1 to 0 on the demo page; map_render produced XML-valid SVG; the plugin registers 11 tools of which the seven named in both allow-lists are reachable (the four v1 tools P3 deletes stay registered but hidden, knowingly); the package suite is 139/139 and 29/29 plugin files, make verify exits 0 with 0 FAIL lines, and the tarball 0.1.27 matches dist. The one-shot importer ran and was deleted; v1 modules, the panel and the model files are untouched."
role: BACKEND
scope: ["plugins/designmap/src/ — new modules for the page store, element builders, outline + hints, tidy, SVG render", "plugins/designmap/index.js — register map_list/map_read/map_edit/map_render through the existing preset gate", "plugins/designmap/bin/ — a demo script and the one-shot importer (the importer is deleted in the same change)", "plugins/designmap/test/ — tests for builders, outline, hints, tidy, SVG", "plugins/designmap/package.json + tarball — version bump and repack", "profile/cordis.patch.yml — the orchestrator and architect allow-lists gain the four tools"]
---

Implement P1 of the design-map v2: the page document and the agent surface, alongside the shipped v1 so the panel keeps working. Deliver: (a) a page store over designmap/pages/*.excalidraw — list, read, write, create, rename, delete, one file per page, Excalidraw scene JSON as the only content; (b) element builders that turn seven ops (node.add, node.move, node.resize, node.label, edge.add, edge.label, element.delete) into valid Excalidraw elements — a rectangle/ellipse/diamond with a bound text and boundElements, an arrow with startBinding/endBinding and optional bound label — so no caller ever supplies seeds, versions or bindings; (c) map_read returning a compact textual outline by default, exact JSON on request, and hints (node_overlap, off_canvas, edge_without_label) that never refuse; (d) tidy: deterministic layered placement by edge direction with text-sized boxes; (e) map_render writing designmap/out/<page>.svg from the elements; (f) the four tools registered through the same preset gate and reachable for orchestrator and architect via the profile allow-lists; (g) a one-shot bin/import-legacy.mjs that writes designmap/pages/system.excalidraw from designmap/model.yaml and is deleted after it runs. Panel, analysis, state panel and every v1 file stay untouched.
