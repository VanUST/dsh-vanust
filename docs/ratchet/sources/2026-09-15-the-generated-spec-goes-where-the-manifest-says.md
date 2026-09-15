# The generated spec goes where the manifest says

Date: 2026-09-15. Scope: `plugins/ratchet/ratchet-compiler.mjs` (`renderSpecs`), `ratchet-ops.mjs`.

This file is the reasoning behind ADR 0026. It has its own home because the change it describes is
not the change ADR 0024 decided: appending it to 0024's source would have edited the reasoning of a
record a human had already ratified, which is exactly what the kit refuses to let happen.

## A foreign project found a defect this kit could not see (2026-09-15)

Every mechanism was re-run against a project that is not this kit — Go sources, `decisions/` rather
than `docs/adrs`, `sources/` rather than `docs/ratchet/sources`, `generated-specs/` rather than
`docs/specs`. Seventeen checks: the gate fails when a law breaks and passes when it is fixed, the
guard denies/licenses/stops a mechanical contradiction, the semantic gate declines and clears, and
`falsify` detects invariant breaks in a project it has never seen.

It found one real defect, in shipped code, that this kit structurally cannot see:

`renderSpecs` hardcoded `docs/specs/${zone}.spec.md` while every READER — `tracksSpecDocuments`,
`detectSpecDrift`, the guard — resolved `config.specsDir`. So a project declaring any other specs
directory had compile write the documents to `docs/specs`, verify report every one of them MISSING
from `<specsDir>`, and **no way to become green**: the failure was reported as the project's, and the
compile the message prescribed wrote to the same wrong place again. A project-agnosticism claim that
held for `decisionsDir` and `sourcesDir` did not hold for `specsDir`.

It survived every check this kit has because the kit's own manifest declares the default. That is the
same shape as every other finding this kit has collected: the check was built on the premise the code
was built on. The generated path now comes from the manifest, and a regression test compiles and
verifies a project whose `specsDir` is not `docs/specs`.
