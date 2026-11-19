---
id: TASK-025
kind: task
title: "Ship the UX/UI testing skill set in @cc/dsh-skills"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.251Z
updatedAt: 2026-11-17T15:52:39.251Z
acceptance:
  - text: "The plugin module loads and registers all new skills with unique names and non-empty bodies"
    done: false
  - text: "Every new skill names real commands/APIs verified against the installed package versions"
    done: false
  - text: "Proof harness runs on a real Chromium: bridge asserts model state, axe scan returns results, pixelmatch diff catches a seeded change, vitest+fast-check property fails on a mutation"
    done: false
  - text: "Maestro flow runs on the attached Android device (or the skill documents the exact blocker honestly)"
    done: false
  - text: "`make verify` passes (portability + documentation gates)"
    done: false
  - text: "The installed web profile carries the new skills tarball version"
    done: false
boardId: task-mw93tbb3-khe1ih
nonScope: ["The handoff plugin removal (separate task)", "Changing the orchestrator, taskboard or model policy", "Committing to git (leave the working tree for human review)"]
resultArtifacts: [.cache/ux-skills-proof/REPORT.md, .cache/ux-skills-proof/tests/ui.spec.mjs, .cache/ux-skills-proof/tests/domain.property.test.mjs, .cache/ux-skills-proof/artifacts/baseline.png, .cache/ux-skills-proof/artifacts/diff-shift.png, plugins/cc-dsh-skills-0.1.8.tgz]
resultEvidence: ["node import of plugins/skills/index.js with a fake registry → registered: 20, empty [], duplicate []", "installed profile @cc/dsh-skills 0.1.8 → 20 skill files; six new bodies 3.5–5.1k chars", "npx vitest run → 4 passed; mutate + shift → + shift + 1 → 1 failed, Counterexample [\"C7\",0], seed 471686226; revert → 4 passed", "npx playwright test → 3 passed (5.3s): bridge transpose, axe clean-vs-broken, keyboard Tab/Enter", "node tools/golden.mjs baseline shifted → 171/232404 diff pixels, exit 1; --mask 40,300,400,40 on the clock → 0, exit 0", "TRACE=1 npx playwright test → 3 trace.zip files containing test.trace, 1-trace.trace, 1-trace.network, screencast/*.jpeg", "node tools/log-summary.mjs → 5 events, all ok, exit 0; first attempt had 2 error events and exited 1", "maestro --version → 2.12.1 under Java 17; maestro test .maestro/smoke.yaml starts on 360c607cfd51fb43 then fails at `pm list packages ... closed` (target is not Android)", "make verify → 17/17 portability checks passed, documentation ok"]
resultSummary: "Added six UX/UI testing skills to @cc/dsh-skills (0.1.8): canvas-test-bridge, property-based-domain-tests, visual-golden-tests, a11y-keyboard-audit, maestro-mobile-flows, test-run-observability. Each body was exercised against the real stack in .cache/ux-skills-proof: Playwright 1.65/Chromium 158 with a gated window.__APP_TEST__, Vitest 5.1 + fast-check 4.10 (including a mutation that went red), pixelmatch 8 goldens (2px shift caught, ignoreMask verified), axe-core 4.14 (clean vs button-name), JSONL gate + traces, and the Maestro 2.12.1 CLI. The tarball is packed and installed into the web profile; make verify passes 17/17 plus documentation."
scope: ["plugins/skills/skills/*.md (new bodies)", "plugins/skills/index.js, package.json, README.md", "profile/cordis.patch.yml skills comment", "rules/DEPLOYMENT.md skills rows/claims", "README.md / USERGUIDE.md skills prose and counts", "plugins/cc-dsh-skills-<new>.tgz and the installed web-profile copy", ".cache/ux-skills-proof/ for runtime evidence (gitignored)"]
---

Add six model-invocable skills to dsh-kit's skills plugin: a window.__APP_TEST__ bridge for canvas/editor UIs, Vitest+fast-check property tests for domain logic, pixelmatch/Argos visual goldens, axe-core + keyboard-only a11y audits, Maestro mobile flows, and JSON-log/Playwright-trace observability. Bodies live in plugins/skills/skills/, are registered in plugins/skills/index.js, packed as a new @cc/dsh-skills tarball, installed into the web profile, and named in README/DEPLOYMENT/profile comments without duplicating the existing ui-testing, playwright-mcp-canvas-ui-sweep, proof-not-tests or tests-that-could-fail skills.

Migrated from .dsh/taskboard.json (task task-mw93tbb3-khe1ih, revision 3).
