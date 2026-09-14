# Reasoning: re-bind the consent laws to behavioural enforcement

**Written:** 2026-09-14 · **Subject:** ADR 0007's four laws, and the conflict with
ADR 0009 · **Evidence:** `reports/ratchet/dynamic-review.json`,
`.dsh/ratchet/specs.json`, `node plugins/ratchet/ratchet-cli.mjs verify --root .`

## What was found, and by what

The kit's own dynamic review (`ratchet_review`, job `review_corpus`) reported two
findings of kind `incompatible_checks` against laws from ADR 0007, with the explanation
that ADR 0009's decision declares invalid the exact enforcement style those laws use.
The finding is reproducible by reading the compiled bundle rather than trusting the
judge: `shipped-plugins.consent-is-hash-bound` and
`shipped-plugins.unenforced-laws-are-reported` both assert
`outputContains: "fail 0"` on `node --test scripts/test-ratchet.mjs`, and
`shipped-plugins.consent-travels-the-human-channel` asserts two strings that are test
*names* (`"the quiz shows the record text itself"`, `"derived from the selected label"`).

ADR 0009's law states the opposite, in the universal: "an enforcement point never rests
on a test name or on output a green run prints anyway."

## Why this is a defect and not a style preference

`fail 0` is a constant of every green run. The breaker demonstrated the consequence
before ADR 0009 was written: deleting the BODY of a covering test while keeping its name
produced `239 pass / 0 fail`, the gate stayed green, and the invariant the law claimed to
enforce was broken. A test name is weaker still — `node --test` prints the name whether
or not any assertion ran. So the three laws would pass over exactly the mutation that
disproves them, and the consent they are supposed to protect is the one thing in this kit
that must not be protected by a constant.

The conflict is a conflict between decisions, not merely between checks: 0009 is an
agent-authored record that self-activated in `kit-tooling`, and its claim reaches into
`shipped-plugins`, which it does not govern. ADR 0007 is human-ratified (through 0008)
and sits in `shipped-plugins`.

## Options considered

1. **Narrow ADR 0009 to kit-tooling.** Rejected: it resolves the contradiction by
   weakening the stronger decision. The consent laws would keep passing over an emptied
   suite, which is the defect 0009 exists to remove.
2. **Record the conflict as an open question and change nothing.** Rejected: two
   in-force decisions would still disagree, and the disagreement is actionable now.
3. **Supersede ADR 0007 with an amendment that restates its four laws, re-binding the
   three weak ones to behavioural enforcement.** Chosen. It strengthens the
   human-ratified decision rather than weakening the agent one, and it goes through
   human ratification, which is what hard rule 12 requires for a change to a ratified
   record: 0007's file is not edited, so its recorded consent is not voided.

## The enforcement point the amendment names

`scripts/check-gate-invariants.mjs` drives the production modules over constructed
fixtures and refuses the wrong verdict; it prints `gate invariants ok` only after every
invariant held. The amendment binds the three weak laws to that marker, after extending
the script so it actually covers the two claims those laws make:

- editing an approved record voids its consent (`RATIFICATION_STALE`), and the law
  leaves force;
- the ratification question's detail is the record's own file text, and the answer is
  derived from the selected label with no interpretation — every other answer mints
  nothing.

`shipped-plugins.no-shell-mint` stays bound to `scripts/check-consent-surface.mjs`,
whose `consent surface ok` marker already asserts the no-mint surface behaviourally.

The live probe (`node scripts/probe-dsh-api.mjs --ratchet-ratify`) remains the strongest
evidence for the human-channel claim, because it drives the production path against a
live profile and a real question channel. It is deliberately not the gate check, for the
reason ADR 0007 already recorded: it needs credentials, a network and a model turn, so
making it the law's enforcement point would make the gate depend on the environment it
happens to run in.

## Residual limits, stated plainly

- The amendment restates laws; it does not remove the human-ratified record. ADR 0007
  and its consent record remain in the repository, retired by supersession only once
  this amendment is ratified.
- A self-verifying system has no external reference point: an agent that edits both the
  module and `check-gate-invariants.mjs` still passes. The design buys a two-file edit,
  one of them named by a law, instead of a deleted test body.
- `RATIFICATION_STALE` is checked against the text the consent recorded. That is a hash
  binding, not an identity check on the author; the residual forgery gap is ADR 0007's
  own, and it is unchanged here.
