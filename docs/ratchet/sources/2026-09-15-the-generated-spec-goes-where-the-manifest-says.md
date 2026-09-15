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

## The siblings, found by asking the same question of every path field (2026-09-15)

A reviewer attacked the claim "what compile and verify report matches what is on disk, for any layout
the manifest permits", and the sibling defects were exactly the ones this record predicted.

**`stateDir` and `reportsDir` were accepted, validated, stored — and never used.** The state and
report paths are frozen constants, so a project declaring either got its artifacts at the default
while the write guard and the breaker resolved the DECLARED directory: two components disagreeing
about where the ratchet's own state lives. The repair is a REFUSAL, not honouring: the manifest now
rejects a non-default `stateDir`/`reportsDir` with a message saying the writers do not honour it.
That is the smaller honest change and the law's own words — a path field is honoured or refused, never
accepted and ignored — and it removes the disagreement, because the guard's and the breaker's reads
now agree with the writers by construction. Honouring them means rebasing every persisted path on the
config, which is a larger change this record leaves as the follow-up rather than pretending it is done.

**A directory field could escape the project.** `specsDir: "../escaped-out/specs"` compiled green and
wrote generated documents OUTSIDE the root; `decisionsDir` and `sourcesDir` were read the same way.
The parser now refuses any directory field that is absolute, drive-qualified or climbs with `..`, for
every field, so no writer has to remember.

**`specsRequired: false` had regressed a ratified decision.** ADR 0012 decided that the flag means
"do not REQUIRE generated documents", not "do not NOTICE the ones this project committed", and states
that a project removing the flag must not lose drift detection. A later commit reintroduced the
short-circuit and added a test asserting it, so the regression was encoded in a test — the check and
the code agreeing on the wrong behaviour, which is how a ratified decision gets undone quietly. Only
`true` short-circuits now, and a project that deleted its LAST generated document can no longer switch
tracking off, because the persisted bundle is the evidence that it tracks specs at all.
