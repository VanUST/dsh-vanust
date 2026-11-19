---
id: TASK-078
kind: task
title: "Make code-search tools actually used"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.933Z
updatedAt: 2026-11-17T15:52:39.933Z
acceptance:
  - text: "The pack mounts the actual @deepseek-ai/dsh-hooks-claude-code bridge with Serena activate/remind/cleanup for DSH."
    done: false
  - text: "A real agent session proves hook activation and reminder behavior without destabilizing the prompt cache or adding dynamic system-prompt churn."
    done: false
  - text: "All roles retain the same tools; read-only guards remain effective."
    done: false
  - text: "The benchmark child receives an updated overlay and proof path for a separate adoption run on the same pinned worktree."
    done: false
  - text: "Provisioning installs the pinned hooks bridge and its required protocol dependency on a fresh machine without manual symlinks or live-profile writes."
    done: false
  - text: "make verify passes and exact evidence is recorded."
    done: false
boardId: task-mwby8fe1-zddnpw
nonScope: ["Do not alter the completed official baseline/enhanced evidence or benchmark prompts.", "No live :3080 profile changes/restart during proof.", "No autotest files and no change to read-only tool boundaries.", "Do not force tool calls when exact built-in grep/glob is genuinely the cheapest route; reminders should address repeated exploratory reads/searches."]
owner:
  kind: agent
  label: BACKEND
  sessionId: 913d5bfc-967b-4ad7-b79e-16f378fa25a8
ownerRole: BACKEND
preset: backend
resultEvidence: ["reports/code-search/adoption/hooks-integration.md: hook activation, deny-then-allow and cleanup", "reports/code-search/adoption/hook-evidence.json and hook-payloads.jsonl: 1 deny / 4 calls / 10 events", "node scripts/provision-tools.mjs --check --only hooks-bridge from clean state: MISSING exit 1; --apply installed 33 packages exit 0; then ok and import exit 0", "reports/code-search/adoption/comparison.json: 3 hook denies, Serena find_symbol x5, Octocode x0, correctness 1.0 both arms", "make verify: 17/17 portability and documentation ok once the concurrent design-map tarball was not mid-edit; sibling-only failure recorded in make-verify-hooks.txt"]
resultSummary: "Serena's official DSH hooks bridge is mounted in the common workspace pack and proven: SessionStart activation injected context, three consecutive greps produced pass/pass/deny/pass, and Stop cleaned project-local hook state. The sandboxed-HOME persistence defect was fixed with SERENA_HOME under the project. The pinned bridge and protocol dependency are now installed reproducibly by provision-tools, proven from a clean state. The clean adoption benchmark then recorded 3 hook denies and Serena use in two tasks, but Octocode remained unused and the overall sample showed higher prompt/call cost, so adoption is partial and no efficiency gain is claimed."
role: BACKEND
scope: ["profile/code-search* and directly related pack/hook configuration", "plugins/ and scripts/ only if required by the hook integration", "reports/code-search/adoption/ for proof"]
sessions:
  - sessionId: 913d5bfc-967b-4ad7-b79e-16f378fa25a8
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Close the measured adoption gap: official enhanced agents received Serena+Octocode and static routing but made zero calls. Integrate Serena's DSH activation/reminder/cleanup hooks (or a better existing Harness seam) into the common workspace pack, prove reminders fire on real grep/read/bash behavior, and enable a fair rerun.

Migrated from .dsh/taskboard.json (task task-mwby8fe1-zddnpw, revision 10).
