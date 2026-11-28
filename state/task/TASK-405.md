---
id: TASK-405
kind: task
title: "Gate the prompt playbooks in make verify, red-first"
status: done
revision: 6
createdAt: 2026-11-24T09:03:55.011Z
updatedAt: 2026-11-24T09:40:51.008Z
acceptance:
  - text: "scripts/check-prompt-playbooks.mjs exits 0 on the current tree and prints one PASS line per preset plus the child-policy line"
    done: false
  - text: "red-first: deleting one clause from a persona block (or the acceptance bullet from CHILD_POLICY) makes it exit 1 naming the preset and the missing anchor; the restore is proven by sha256 and git diff"
    done: false
  - text: "make verify runs it and exits 0 with 0 FAIL lines; the help text names it"
    done: false
  - text: "the check does not restate the block text: it asserts stable anchors, so docs/PRESET-PLAYBOOKS.md stays the only copy of the wording"
    done: false
  - text: "no persona, plugin, budget or case file is edited"
    done: false
boardId: task-mwugws8u-an4dfw
chore: true
choreReason: "A tree gate that keeps the shipped prompt playbooks and the specialist acceptance bullet from disappearing silently; verification infrastructure, no requirement implements it."
nonScope: ["No edit to any persona, CHILD_POLICY, budget row or docs — the check must pass on the tree as it stands", "No repack: scripts/ is not a packed plugin file", "No case recording (this is a tree check, not behaviour), no docs/cases touch"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-237]
resultEvidence: ["node scripts/check-prompt-playbooks.mjs -> exit 0, 11 preset PASS lines + preset coverage + case-tool roles + CHILD_POLICY, 'prompt playbooks ok', 123 ms", "red-first persona: deleting the ux 'False negative:' clause -> exit 1 '[FAIL] preset ux — missing \"False negative:\"'; restore sha256 029c12f3…, diff parity 103 lines, exit 0", "red-first policy: deleting the '**How your result is accepted.**' bullet -> exit 1 '[FAIL] CHILD_POLICY — missing \"**How your result is accepted.**\"'; restore sha256 ca354f4b…, exit 0", "fail-closed: renaming preset-presenter -> exit 1 twice, 'no preset row with a persona prefix' and 'row presenterx is not a preset this check knows'; restored", "make verify -> exit 0, 0 FAIL lines, check at log line 54, 'prompt playbooks ok' at 69, 20/20 packaging checks", "tree: Makefile +2 lines, scripts/check-prompt-playbooks.mjs new; docs/cases 0 changes; profile and orchestrator.mjs carry their task-start sha256"]
resultSummary: "The durable half of the gap is closed: `scripts/check-prompt-playbooks.mjs` (123 ms) joins `make verify` and asserts that all eleven presets keep a two-direction playbook, that the preset and role sets stay aligned, and that CHILD_POLICY keeps '**How your result is accepted.**' and 'case_gate' while the documented-only escape stays gone. Proven red-first twice — a deleted 'False negative:' clause (ux) and a deleted acceptance bullet each exit 1 naming the anchor — plus fail-closed on a renamed preset. make verify exits 0 with 0 FAIL lines; only the new script and two Makefile lines changed."
role: BACKEND
---

Add the durable gate for the prompt playbooks, so a later edit or repack cannot drop them silently. One new reader `scripts/check-prompt-playbooks.mjs`, wired into `make verify`: over `profile/cordis.patch.yml` it asserts that all eleven presets still carry a two-direction playbook (ten with a literal 'False positive:' and 'False negative:', the orchestrator with its own 'Two ways it becomes false' and 'The opposite failure'), that no preset in DEFAULT_ROLE_TOOLS is missing a persona and no persona names a preset the policy does not know; over `plugins/orchestrator/orchestrator.mjs` it asserts CHILD_POLICY still contains '**How your result is accepted.**' and 'case_gate' and no longer contains 'documented-only with a reason'. Fail red-first: delete one clause and show it exit 1 naming the preset, restore and show exit 0.
