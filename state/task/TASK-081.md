---
id: TASK-081
kind: task
title: "Document code-search pack activation"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.988Z
updatedAt: 2026-11-17T15:52:39.988Z
acceptance:
  - text: "Commands are copyable and match current scripts/overlays exactly."
    done: false
  - text: "Explains common-all-roles vs repository-scoped placement."
    done: false
  - text: "Includes indexing freshness and setup cost, read-only guard, hooks sandbox state, and activation/restart."
    done: false
  - text: "Links evidence report and states partial adoption/no efficiency claim."
    done: false
  - text: "make verify/check-documentation passes."
    done: false
boardId: task-mwbzyyu4-5evo17
nonScope: ["No product source/config changes beyond docs.", "Do not claim measured savings; record the honest adoption result.", "Do not turn the pack into a machine-wide home-layer row."]
owner:
  kind: agent
  label: DOCS
  sessionId: cfdf5f13-8898-45c0-b4e4-01973271202d
ownerRole: DOCS
preset: docs
resultEvidence: ["rules/DEPLOYMENT.md §1.2: activation runbook with copyable commands", "README.md: user-facing code-search capability paragraph", "node scripts/provision-tools.mjs --check --only serena,octocode,hooks-bridge: 3/3 exit 0", "node scripts/dsh-mcp-sync.mjs --spec profile/code-search.mcp.json --project $PWD --out .dsh/code-search.patch.yml --apply: exit 0, 2 server rows plus routing/hooks", "DSH_KIT_BOOT=0 dsh --profile web --patch .dsh/code-search.patch.yml --dump-config: exit 0 with four rows", "node scripts/check-documentation.mjs and lychee offline: exit 0"]
resultSummary: "Added a concise code-search activation runbook to rules/DEPLOYMENT.md and a discoverable capability note to README.md. It documents repository-scoped placement, all-role surface, provisioning, overlay generation, clean per-revision indexing/provenance, launch/restart, read-only guard, hook state, setup cost, and the measured partial-adoption/no-savings caveat."
role: DOCS
scope: [rules/DEPLOYMENT.md, README.md, "USERGUIDE.md only if a user-facing launch note is needed"]
sessions:
  - sessionId: cfdf5f13-8898-45c0-b4e4-01973271202d
    label: DOCS
    role: DOCS
    status: sleeping
---

Make the new common Serena+Octocode code-search capability discoverable and operational: add one concise activation/runbook section to the kit's agent-facing deployment procedure and one README capability mention, including prerequisites, clean per-revision indexing, pack generation, launch, all-role scope, read-only boundaries, hooks, state locations, update/restart behavior, and the measured no-savings caveat.

Migrated from .dsh/taskboard.json (task task-mwbzyyu4-5evo17, revision 7).
