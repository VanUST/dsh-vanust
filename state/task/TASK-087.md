---
id: TASK-087
kind: task
title: "Review test-cases library"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:40.079Z
updatedAt: 2026-11-17T15:52:40.079Z
acceptance:
  - text: "Severity-ranked findings with file:line and repro, or explicit no-findings scope."
    done: false
  - text: "Re-run every prior HIGH/MEDIUM reproduction against test-cases 0.1.7 and taskboard 0.1.43, including traversal, red-first bypass, command mismatch, drift idempotence, malformed-file isolation, documented exit codes and absent-panel tab."
    done: false
  - text: "Verify packed tarballs contain runtime files, match source, and make verify 0."
    done: false
  - text: "Verify panel no-top-level-button, accessible rows, host-only writes, and proof assertions."
    done: false
boardId: task-mwc2bm2c-u28kdx
nonScope: ["No edits and no live :3080 changes.", "Do not rewrite recorded cases/report evidence."]
owner:
  kind: agent
  label: REVIEWER
  sessionId: b1c546e7-4837-4d6c-b7b3-a552fa8f4d4f
ownerRole: REVIEWER
preset: reviewer
resultEvidence: ["Reviewer re-run /tmp repros: INVALID_CASE_ID, CASE_OUTSIDE_LIBRARY, CASE_ID_MISMATCH, CASE_WRITE_FAILED", "Red-first chain: degraded verify TEST_REQUIRED; re-arm clears evidence; restore+red/green verifies", "COMMAND_MISMATCH, EVIDENCE_NOT_GREEN; drift rev 3 once then wrote:false; full sweep ok:true checked:6", "Unknown preset gets zero tools; orchestrator four; tester presets eight", "Packed 0.1.7 and taskboard 0.1.44 at review; final 0.1.45 status fix also gated", "make verify exit 0; case test 4 pass"]
resultSummary: "Independent review ran twice. The first pass found two HIGH defects (case-id path traversal/write escape and a red-first verification bypass) and five MEDIUM defects. After hardening, every HIGH/MEDIUM was reproduced and closed: traversal/symlink/write errors return stable refusals, automated verification always requires matching red/green evidence, documented passes require exit 0, drift changes bump revision once and are idempotent, malformed files become per-id findings, and the Tasks test-cases tab is optional/guarded. Packaging and gates pass; only documented LOW residuals remain."
role: REVIEWER
scope: ["plugins/test-cases/ and direct taskboard client integration", "docs/cases/ and reports/test-cases*, profile/inventory/docs integration", "Read-only reproduction of host tool cases and panel proof"]
sessions:
  - sessionId: b1c546e7-4837-4d6c-b7b3-a552fa8f4d4f
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Independently review the test-cases host service and panel: schema invariants, role availability, evidence requirements, drift degradation, CAS semantics, security/path safety, panel-host contract, packaging and browser evidence.

Migrated from .dsh/taskboard.json (task task-mwc2bm2c-u28kdx, revision 9).
