# A declared verification that nothing runs is a claim

`.dsh/project.json` declares twenty-four verification commands. The gate ran ten of
them. The other fourteen were declared, documented, and never executed by anything: a
check nobody runs is a claim nobody tests, which is the state §3 of the deployment
rules exists to name.

Measured before deciding anything, because the two halves of the gap want different
answers:

- Eight of the fourteen are hermetic and cheap — `instruction-routing`, `model-gate`,
  `zone-coverage`, `hermetic-laws`, `test-quality-tests`, `drill-tests`,
  `work-modes-tests`, `machine-facts-tests`. Each was timed at 0.15-0.45 seconds,
  needs no credentials, no model and no server. Nothing prevented them being law
  checks; they simply were not bound.
- Six cannot be law checks without breaking the deployment's own rule that a law's
  check is hermetic: `gate` (`verify-upgrade.sh` composes a throwaway instance), the
  three `probe-dsh-api.mjs` modes (`--ratchet-ratify`, `--adr-panel-consent`,
  `--kit-rules`, which drive a real harness, a real webserver or a model turn), and
  the two breakers (`falsify`, `falsify-gate`, which run the whole gate once per
  case).

A seventh was tried and refused, which is the most useful thing this record contains.
`scripts/probe-work-modes.mjs` is fast (1.85 s) and needs no credentials, so it looked
like the others; binding it turned the gate red under `kit-tooling.every-law-check-is-hermetic`,
whose own verdict is "a law bound to a probe is a law whose colour depends on an
environment the gate does not control". The check is right and the binding was wrong:
a probe measures the harness this machine happens to have, so its result is not the
corpus's to guarantee. It belongs in the release gate, where the environment is chosen
deliberately.

So eight are bound here, one law each, because one command verifies one claim: a law
that named eight commands would report "something failed" without saying what. The
statements are the claims those commands already make; each check's `run` is exactly
the command the manifest declared, so the declaration and the enforcement cannot drift
apart.

What this does NOT close, stated rather than implied: the seven release-gate commands
are still only *declared*, and nothing fails when one of them is removed from the
manifest, because there is no record of which verifications are deliberately unbound.
The fix for that is a field on the manifest entry plus a check that every declared
verification is either bound by a law or explicitly exempt with a reason — not more
laws, because the exempt ones cannot be law checks.
