# @cc/dsh-skills

The deployment's reusable skills, registered from one tarball through
`ctx.skills.register` — no `$DSH_HOME/skills` copy and no per-machine drift.

## The set

| Skill | Invocation | Source |
|---|---|---|
| `ponytail` | model + user | Adapted from [DietrichGebert/ponytail](https://github.com/dietrichgebert/ponytail) (MIT). The test paragraph is replaced by the proof rule. |
| `grill-me` | user only | Adapted from [mattpocock/skills](https://github.com/mattpocock/skills). |
| `grilling` | model + user | Adapted from the same repository. |
| `clear-writing` | model + user | Adapted from [ashryaagr/karpathy-output-style](https://github.com/ashryaagr/karpathy-output-style). |
| `explain-webpage` | model + user | Adapted from the same repository. |
| `explain-diagram` | model + user | Adapted from the same repository; Excalidraw is replaced by the local `diagram` tool. |
| `ui-builder` | model + user | Written for this kit. |
| `proof-not-tests` | model + user | Written for this kit; matches `rules/DEPLOYMENT.md` §4. |
| `literature-review` | model + user | Written for this kit; pairs with the planned `papers` tool. |
| `tests-that-could-fail` | model + user | Written for this kit. |
| `visual-explanations` | model + user | Written for this kit. |
| `ui-testing` | model + user | Written for this kit. |
| `ui-design-system` | model + user | Written for this kit. |
| `research-first` | model + user | Written for this kit; pairs with `@cc/dsh-research-first`. |
| `canvas-test-bridge` | model + user | Written for this kit; verified on Chromium 158 with Playwright 1.65. |
| `property-based-domain-tests` | model + user | Written for this kit; verified with Vitest 5.1 and fast-check 4.10. |
| `visual-golden-tests` | model + user | Written for this kit; verified with pixelmatch 8 and pngjs 7. |
| `a11y-keyboard-audit` | model + user | Written for this kit; verified with axe-core and @axe-core/playwright 4.14. |
| `maestro-mobile-flows` | model + user | Written for this kit; the CLI starts, the attached adb target is not Android, so the flow run is blocked and recorded. |
| `test-run-observability` | model + user | Written for this kit; verified with Playwright traces and a JSONL gate. |

## Why a plugin

The skill registry already supports embedded runtime skills. Registering them
here means the kit's tarball is the single source of truth, the catalog is
hot-reloaded with the plugin, and a machine cannot end up with an old copy in
`$DSH_HOME/skills`. The bodies stay ordinary Markdown under `skills/`, so a
reviewer reads exactly what the model reads.

## Attribution

The adapted skills carry their upstream licenses (MIT). The original bodies are
not redistributed verbatim where this deployment changes them; the changes are
named in the table above. The kit's `NOTICE` records the upstream projects.
