---
id: TASK-029
kind: task
title: "Refactor the UX/UI testing skill set and routing"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.299Z
updatedAt: 2026-11-17T15:52:39.299Z
acceptance:
  - text: "ui-testing points to each specialized skill with a one-line routing rule"
    done: false
  - text: "Each specialized body states what it owns that ui-testing does not"
    done: false
  - text: "No snippet references an undefined variable"
    done: false
  - text: "make verify passes; installed tarball matches source"
    done: false
boardId: task-mw95rb5g-0oy0vh
nonScope: ["Adding/removing skills", "Other shipped skills", "Changing the test harness beyond snippet proof"]
resultArtifacts: [plugins/skills/skills/ui-testing.md, plugins/skills/skills/test-run-observability.md, plugins/skills/skills/a11y-keyboard-audit.md, plugins/cc-dsh-skills-0.1.15.tgz, .cache/skill-verification/REPORT.md, .cache/ux-skills-proof/REPORT.md]
resultEvidence: ["ui-testing.md now has the routing table; grep 'Six skills go deeper' = 1", "reviewer fixture .cache/skill-verification: 45 claim rows, 43 pass, 2 defects (D1, D2)", "D1 fix proof: old expression '' vs fixed 'Chord' for the labelled textbox", "D2 fix proof: default gate exit 0; REQUIRED_STEPS=bridge.read,missing.step → exit 1 with missing listed", "Maestro: --include-tags smoke .maestro/ selects flow; nightly excludes; explicit smoke.yaml ignores tags; no path → Missing required parameter", "PowerShell 7.4.6: win-install.ps1 PARSE_OK; Expand-Archive of a maestro/ zip leaves maestro/bin; win-trace.ps1 PARSE_OK", "vitest 5 passed; Playwright 3 passed; make verify 17/17", "installed @cc/dsh-skills 0.1.15; sha256 53212d2128e48533f565196a258701074120c538a7a79d6ef8e215c6f16583ff"]
resultSummary: "Refactored the set into a routed family: ui-testing now carries a six-row 'when this is not enough' table and each specialized body states what it owns. Closed the remaining snippet defects (ignoreMask declared, canvas before-state used, 'roughly a third' removed, Windows tar-glob fixed) and fixed the defects the independent reviewer found: D1 labelled-input accessible name (aria-label || labels[0] || textContent) and D2 required-step gate (REQUIRED_STEPS diff, exit 1). Maestro tag semantics were tested and corrected (directory-only filter, explicit path required). Shipped as @cc/dsh-skills 0.1.15."
scope: ["plugins/skills/skills/ui-testing.md (routing section)", "plugins/skills/skills/{canvas-test-bridge,property-based-domain-tests,visual-golden-tests,a11y-keyboard-audit,maestro-mobile-flows,test-run-observability}.md", "plugins/skills/index.js whenToUse only", "skills tarball + installed profile"]
---

Apply the audit verdict: make ui-testing the routing hub to the five specialized skills, add a one-line boundary to each specialized body, remove the last snippet defects (undefined ignoreMask, unused before in the canvas example, test-run-observability overlap), and ship the result as one tarball.

Migrated from .dsh/taskboard.json (task task-mw95rb5g-0oy0vh, revision 4).
