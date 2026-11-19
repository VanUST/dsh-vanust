---
id: TASK-028
kind: task
title: "Audit and improve the six UX/UI testing skills"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.287Z
updatedAt: 2026-11-17T15:52:39.287Z
acceptance:
  - text: "Every defect found is either fixed or explicitly recorded with its impact"
    done: false
  - text: "The fixed bodies remain internally consistent (listed invariants are implemented; snippets compile/run where testable)"
    done: false
  - text: "`make verify` passes and the installed package carries the new version"
    done: false
  - text: "The usefulness verdict names which skills to keep, merge or drop, with evidence"
    done: false
boardId: task-mw95cr0k-l7pieb
nonScope: ["Adding or removing skills from the set", "Unrelated skills shipped by @cc/dsh-skills", "A real Windows/Android run (no hosts)"]
resultArtifacts: [plugins/skills/skills/canvas-test-bridge.md, plugins/skills/skills/property-based-domain-tests.md, plugins/skills/skills/visual-golden-tests.md, plugins/skills/skills/a11y-keyboard-audit.md, plugins/skills/skills/test-run-observability.md, plugins/cc-dsh-skills-0.1.13.tgz, .cache/ux-skills-proof/REPORT.md]
resultEvidence: ["read all six bodies (106/105/130/134/145/119 lines) + index.js; defect table in .cache/ux-skills-proof/REPORT.md", "npx vitest run → 5 passed (additivity property added and executed)", "npx playwright test → 3 passed with expect.poll on the bridge model", "node tools/log-summary.mjs → run-0.jsonl, 10 events, all ok", "pixelmatch 10x10 vs 642x362 → exit 2, {ok:false,reason:'size-mismatch'} (guard works)", "focus check → default true, outline+shadow stripped false, box-shadow-only true; old outlineStyle-only check said false for the shadow ring", "make verify → 17/17 portability, documentation ok", "installed @cc/dsh-skills 0.1.13; tarball sha256 fdcfff0e…4cb"]
resultSummary: "Audited all six bodies plus registration and found 14 defects. The substantive ones: the canvas bridge was gated by a non-production mode (a staging leak) and read state before an async repaint; the property table promised an additivity test that did not exist; the pixelmatch snippet called the library without a size check and referenced undefined `allowed`/`ignoreMask`; the a11y focus check used outlineStyle only (box-shadow rings read invisible); the observability skill recommended `trace: 'on-first-retry'` which produces no trace with retries=0, asserted fixed trace filenames, and put an unsanitized RUN_ID in paths while all workers appended one JSONL; Maestro used --include-tags without a tags field. All fixed, plus Windows tar-glob and mask-coordinate corrections. Verified: vitest 5/5, Playwright 3/3, per-worker JSONL 10 ok, pixelmatch size mismatch exits 2, focus check proven true/false/shadow-only. Shipped as @cc/dsh-skills 0.1.13."
scope: ["plugins/skills/skills/{canvas-test-bridge,property-based-domain-tests,visual-golden-tests,a11y-keyboard-audit,maestro-mobile-flows,test-run-observability}.md", "plugins/skills/index.js descriptions/whenToUse", "proof harness checks that can validate a fix (.cache/ux-skills-proof)", "skills tarball + installed profile, REPORT.md"]
---

Review the current @cc/dsh-skills bodies and registration for correctness, internal contradictions and usefulness; fix the defects found (missing listed invariant, unsafe pixelmatch call, focus-ring false negative, trace filename drift, RUN_ID path safety, canvas gating/race, Maestro tags), re-pack and install, and report which skills earn their context cost.

Migrated from .dsh/taskboard.json (task task-mw95cr0k-l7pieb, revision 2).
