# A law-bound finding must quote the law it judges

## The failure this rule exists for

A judge returned an error-level finding that named a law id **in force** but quoted, as the
statement of that law, a text the law no longer carried — it had been amended by a restatement
under a new id. The guard then blocked every write in the zones that law governed, including
the fix. The id resolved; the statement it was judged against did not exist. Reconstructing
the truth by hand was the only way out of the block.

## The rule

A finding that names a law must quote the law as it is in force: the in-force statement
verbatim, or the hash of the law set the judge read. The ratchet compares the quote against
the compiled law before the finding is forwarded.

- A quote that does not match the compiled law **invalidates itself**: the finding is reported
  unusable and blocks nothing.
- A law-bound finding that carries **no quote** is unusable, exactly as a citation of a law
  that does not exist is.
- A finding that names **no law** is unaffected: a judge may report an incoherent corpus
  without binding it to one law.

## The existing enforcement

The rule is enforced in `plugins/ratchet/ratchet-dynamic.mjs`, in the verdict validator. For
a raw finding whose `lawId` names a known law it requires a `lawQuote`; a missing quote, or a
quote that is neither the collapsed in-force statement nor a string containing the law's spec
hash, is reported as `DYNAMIC_REVIEW_REQUIRED` and the finding is dropped rather than
forwarded. `plugins/ratchet/ratchet-ops.mjs` supplies the statements and per-law hashes to the
validator, so the comparison is against the compiled bundle and not against a second reading
of the corpus.

Nothing here is new. What is new is that the rule was enforced by code and tests but was **not
a law**: the corpus stated no law id for it, so `ratchet verify` could not fail because of it.
This record makes it a law bound to a hermetic command.

## The check, and the falsification

`node --test scripts/test-ratchet.mjs` runs, with no server, no port and no nested process,
two falsification tests that fail when the rule is broken:

- `FALSIFICATION: a finding that quotes the law it names is checked against it` — a correct
  quotation is accepted; a finding quoting a statement the id no longer carries is dropped
  with a `does not match law` problem; a law-bound finding with no quotation at all is
  dropped with a `quotes neither` problem; a finding that names no law is unaffected.
- `FALSIFICATION: a bundle hash is an acceptable quotation for a law-bound finding` — the
  spec hash offered in place of the statement is accepted.

The falsification was run, not assumed: with the quote-comparison branch of the validator
forced to its false path in a throwaway copy of the plugin, the first test fails with
`1 !== 0` at the assertion that a superseded-statement quote must be dropped, and
`node --test` exits 1. The check can fail, so binding the law to it is not a claim on credit.

## Reasoning

The rule was kept in the code and the tests while the corpus went without it for one reason:
encoding a law needs a record, a record needs a zone, and the only zone that governs the
ratchet is `shipped-plugins`, which is `proposeOnly`. An agent cannot put its own law into
force there, so this ships as a proposed record for a human to ratify. A proposed record adds
no law, so the gate stays green while it waits.
