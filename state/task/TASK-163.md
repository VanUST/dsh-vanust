---
id: TASK-163
kind: task
title: "Mandatory shared terminology in the common prompt"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.268Z
updatedAt: 2026-11-17T15:52:41.268Z
boardId: task-mwjhmkci-hyjm40
inline: true
nonScope: [".dsh/rules.md (human-only; the owner edits it in the Rules panel)", "The installed profile while :3080 runs", "Rewriting existing reports or docs wholesale"]
resultEvidence: ["AGENTS.md (2,589 bytes) created and loaded by this session: the system reminder injected its 'Terminology is mandatory' section right after the write, which proves the shared instruction channel", "docs/TERMINOLOGY.md (10,514 bytes) created: 40+ terms with identifier, definition and user-facing wording, a banned-substitutes list and the language rule", "plugins/orchestrator/orchestrator.mjs: ROOT_POLICY paragraph, report bullet, CHILD_POLICY bullet and renderBrief rule now reference docs/TERMINOLOGY.md (3 references)", "node --check plugins/orchestrator/orchestrator.mjs -> ok", "make verify -> 17/17 portability and packaging checks passed + documentation ok", "packed cc-dsh-orchestrator-0.1.45.tgz (sha256 4675076d…), replacing 0.1.44"]
resultSummary: "Shared terminology is now a mandatory rule: AGENTS.md (loaded by every agent through the agent-instructions plugin) requires the project's vocabulary from docs/TERMINOLOGY.md and the owner's own words, forbids coined names/abbreviations/compounds, treats internal identifiers as cited evidence, and requires a new term to be defined once or added to the glossary in the same task. The same rule is in the orchestrator's root policy, specialist policy and child-brief rules (orchestrator 0.1.45)."
scope: ["AGENTS.md (new, shared workspace instructions)", "docs/TERMINOLOGY.md (new, canonical vocabulary)", "plugins/orchestrator/orchestrator.mjs (ROOT_POLICY, CHILD_POLICY, renderBrief rules)", "plugins/orchestrator/package.json + repacked tarball", "docs/CASE-LIBRARY-DESIGN.md is not touched"]
---

Make shared terminology a mandatory rule in the common prompt: every agent uses the project's established vocabulary (a new docs/TERMINOLOGY.md) and the user's own words, never a term, abbreviation, compound or metaphor it invented; internal identifiers are cited as evidence, not used as subjects. The rule lands in the shared workspace instructions (AGENTS.md), the orchestrator's root and specialist policies, and the child brief, so task reports stop reading like code commentary.

Migrated from .dsh/taskboard.json (task task-mwjhmkci-hyjm40, revision 3).
