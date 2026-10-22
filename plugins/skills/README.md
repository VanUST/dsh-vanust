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
