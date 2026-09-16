---
id: "0044"
title: A law-bound finding must quote the law it judges
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-16T07:05:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-16-a-law-bound-finding-quotes-the-law-it-judges.md
  hash: sha256:6f8cd8695152092b3b80d06a0d3a421a2df406ad65323f2797db4994824dd535
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: review.a-law-bound-finding-quotes-the-law-it-judges
    statement: A judge's finding that names a law must quote that law as it is in force — its statement verbatim, or the hash of the law set the judge read — and the ratchet compares the quote against the compiled law before the finding is forwarded, so a quote that does not match the in-force law is reported unusable and blocks nothing, a law-bound finding that carries no quote at all is unusable, and a finding that names no law is unaffected.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a correct quotation is accepted, a quote of a statement the law no longer carries is dropped as unusable, a law-bound finding with no quote is dropped, and a finding binding no law is unaffected
        timeoutMs: 300000
        outputContains: "a finding that quotes the law it names is checked against it"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the hash of the law set is accepted in place of the statement as a law-bound finding's quotation
        timeoutMs: 300000
        outputContains: "a bundle hash is an acceptable quotation for a law-bound finding"
---

## Context

A judge returned an error-level finding that named a law **in force** while quoting, as that
law's statement, a text the law no longer carried: the statement had been restated under a new
id and the old one was left behind. The guard then blocked every write in the zones that law
governed — including the fix — because the finding was accepted. The id resolved; the text it
was judged against did not exist.

The enforcement was built in response. `plugins/ratchet/ratchet-dynamic.mjs` requires a
`lawQuote` on any finding that names a known law, and drops the finding as
`DYNAMIC_REVIEW_REQUIRED` when the quote is missing or matches neither the collapsed in-force
statement nor a string containing the law's spec hash. `plugins/ratchet/ratchet-ops.mjs`
hands the validator the statements and hashes it compares against. Falsification tests in
`scripts/test-ratchet.mjs` pin the refusal.

What was missing is that the rule was **not a law**. It was enforced by code and tested, but
no ADR declared it, so `ratchet verify` could not fail because of it and a regression in the
validator would have had no law to break.

## Decision

The rule becomes a law, `review.a-law-bound-finding-quotes-the-law-it-judges`, bound to the
hermetic command `node --test scripts/test-ratchet.mjs` through the two falsification tests
that exercise it:

- `FALSIFICATION: a finding that quotes the law it names is checked against it` — acceptance of
  a correct quote, refusal of a superseded-statement quote, refusal of a law-bound finding with
  no quote, and the exemption of a finding that names no law.
- `FALSIFICATION: a bundle hash is an acceptable quotation for a law-bound finding` — the spec
  hash accepted in place of the statement.

The law is declared by a `status: proposed` record, because the ratchet lives in the
`shipped-plugins` zone and that zone is `proposeOnly`: an agent cannot put its own law into
force there. A proposed record adds no law, so the gate stays green while this waits for a
human.

## Reasoning

The reasoning source is
`docs/ratchet/sources/2026-09-16-a-law-bound-finding-quotes-the-law-it-judges.md`, whose hash
this record pins. It records the failure, the rule, where the enforcement lives, and the two
hermetic tests.

The rule was confirmed **falsifiable before it was bound**. In a throwaway copy of the plugin,
forcing the quote-comparison branch of `verifyJudgeVerdict` to its false path made
`FALSIFICATION: a finding that quotes the law it names is checked against it` fail with
`1 !== 0` at the assertion that a superseded-statement quote must be dropped, and `node --test`
exited 1. The positive run passes. A test that passes on both sides of the branch would have
made the law a claim on credit, which is what the corpus must not record.

## Consequences

- The rule stops being an unstated code property and becomes a law with a command that fails
  when it is broken. Until ratification it adds no force and changes nothing at runtime.
- **The check is hermetic.** `node --test scripts/test-ratchet.mjs` runs with no server, no
  port and no nested process.
- The statement is scoped to the validator's behaviour: it does not claim that the judge
  always quotes correctly, only that the ratchet refuses a finding whose quote does not match
  the compiled law. The judge's compliance is not enforced by this law.
