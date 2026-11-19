---
id: TASK-158
kind: task
title: "Add context-gatherer preset + orchestrator reconnaissance policy"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.178Z
updatedAt: 2026-11-17T15:52:41.178Z
acceptance:
  - text: "profile/cordis.patch.yml parses and carries a `preset-gatherer` row whose plugins all exist in packages already used by other presets"
    done: false
  - text: "`gatherer` is in PRESET_IDS, CONTEXT maps to it, and a delegation with role CONTEXT resolves the preset without an explicit preset argument"
    done: false
  - text: "ROOT_POLICY states the architecture-first rule and the report-only delegation, and the role count/list matches the registry (no stale 'seven')"
    done: false
  - text: "node --check + existing orchestrator tests + `make verify` pass, and the orchestrator tarball matches its source"
    done: false
boardId: task-mwjd9jlc-m6h3z1
inline: true
nonScope: ["Do not restart the live :3080 server; activation is reported as a command", "Do not implement the test-cases improvements in this task", "Do not change other plugins' role policies beyond the new preset's own rows", "Do not touch docs/cases content"]
resultEvidence: ["make verify -> 17/17 portability + documentation ok (\"every role preset is named in the procedure — 8 preset(s), all documented\")", "node import of plugins/cc-dsh-orchestrator-0.1.44.tgz: PRESET_IDS=ux,backend,research,gatherer,reviewer,critic,docs; presetForRole('CONTEXT')='gatherer'", "dsh --profile web --patch <gatherer overlay> --dump-config: preset-gatherer composed with persona/instructions/time/fs(write:false,edit:false)/fs-search/bash/pwsh/skills/compaction/todo", "Second server on 127.0.0.1:3081 with the overlay: preset picker lists 'Context gatherer' between Research and Reviewer; screenshot reports/context-gatherer-preset-3081.png", "node scripts/tool-families-proof.mjs -> 47/47 (gatherer: no MCP family except hindsight, inside and outside a Godot workspace)", "analysis gate: gate({preset:'gatherer'}) -> ok:true readOnly:true; gate({preset:'backend',changeClass:'L1'}) -> analysis_required", "Packed: cc-dsh-orchestrator-0.1.44.tgz sha256 d75b92a…, cc-dsh-analysis-0.1.9.tgz 27eb54b…, cc-dsh-tool-families-0.1.5.tgz 19c0c74…"]
resultSummary: "Added the `gatherer` agent preset (Context gatherer, order 45): read/grep/glob/bash, `write:false` + `edit:false`, no web/present/jobs, tool-families row denying the browser and project-gating Godot. Registered CONTEXT/GATHERER/CONTEXT-GATHERER as role spellings in `PRESET_IDS`, exempted the preset from the Analysis Record gate, and extended ROOT_POLICY with the architecture-first rule (understand the mechanism, delegate one CONTEXT brief when it is missing, design from the cited report instead of replaying the reading). Repacked orchestrator 0.1.44, analysis 0.1.9, tool-families 0.1.5; updated README/USERGUIDE/DEPLOYMENT and the tool-families proof. The live :3080 was not touched: activation is a restart with `./start.sh` (kit-update converges the profile and tarballs)."
scope: ["profile/cordis.patch.yml (new preset row + tool-families row)", "plugins/orchestrator/orchestrator.mjs (PRESET_IDS, ROLE_PRESETS, ROOT_POLICY, delegate_task texts)", "plugins/orchestrator/package.json (version)", "plugins/cc-dsh-orchestrator-*.tgz (repacked)", "README.md / USERGUIDE.md / rules/DEPLOYMENT.md role lists if they enumerate presets"]
---

Make understanding the current architecture a first-class orchestrator step: add a read-only `gatherer` agent preset (Context gatherer) that inspects the current architecture/algorithm and returns one cited report, register it as a role (CONTEXT) in the orchestrator's delegation surface, and extend ROOT_POLICY so the orchestrator delegates reconnaissance to that child instead of spending its own context on read/grep calls.

Migrated from .dsh/taskboard.json (task task-mwjd9jlc-m6h3z1, revision 4).
