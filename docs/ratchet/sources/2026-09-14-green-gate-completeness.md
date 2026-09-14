# Reasoning: a green gate must mean the corpus is current, complete, and inside its declared authority

**Written:** 2026-09-14 · **Subject:** the verifier's blind spots found by an adversarial
pass · **Evidence:** `docs/RATCHET-ASSESSMENT.md` §3, and the reproductions quoted below,
each re-run against commit `c5ea25d`.

## What was found, and by what

An adversarial pass over the ratchet — three independent breakers, each given one named
claim and a declared scope, plus the author's own — falsified five claims. Three of them
are the subject of this decision, because all three share one shape: **`verify` reports
success over a corpus it has not actually checked.**

### 1. A generated spec can drift from its decision, and `verify` still exits 0

`plugins/ratchet/ratchet-state.mjs` returns `false` from `tracksSpecDocuments` as soon as
`ratchet.specsRequired === false`, so the on-disk clause in `docs/RATCHET-V2-DESIGN.md`
§6.6 — tracking begins when any `*.spec.md` exists — is unreachable. `ratchet-ops.mjs`
then passes `specDriftProblems` a substitute object that drops both `missing` and `stale`,
and `verify` never compares the persisted bundle at all; only `status` does.

Reproduced: edit a law statement in `docs/adrs/0002-problem-codes-are-stable.adr.md`
without recompiling. The generated document still carries the old sentence and
`verify --root .` prints `OK … no problems`, exit 0. Deleting `docs/specs/*.spec.md`
entirely is equally silent, which contradicts §6.6 verbatim: *"Deleting a tracked spec is
still `SPEC_OUT_OF_DATE`."* The strongest form needs no deletion: running
`ratchet compile --root .` without `--write` persists the new bundle while leaving the
document stale, after which **both `verify` and `status` exit 0**. Setting
`"specsRequired": true`, or removing the key, makes the same edit report two
`SPEC_OUT_OF_DATE` problems and exit 1 — so the mechanism works and this project's
configuration disables it.

### 2. A law can leave force in silence, and the whole release gate stays green

Deleting one law block from `docs/adrs/0006-rules-name-their-enforcement.adr.md` (an
agent-activated record), recompiling, and verifying yields `OK … 18 law(s) … no problems`,
and `scripts/verify-upgrade.sh` reports `GATE PASS` with all fifteen probes green. A
constraint the code was required to satisfy simply stopped existing. The ledger records
`checksEvaluated` and a `specHash`, both of which change, but nothing fails and nothing
records what changed: the previous law set is not retained, so a retirement recorded with
`op: remove` and a deletion produce identical artifacts.

The protection that does exist tracks *ratification*, not lawhood: removing a law from
ADR 0010, which a human ratified, is caught by `RATIFICATION_STALE` and exits 1. Six of
this project's eight in-force decisions are agent-activated, so precisely the decisions no
human ever saw are the ones whose constraints can be removed without trace.

### 3. A zone reserved to humans is escapable by declaring a different zone

Authority is decided only by the `zones:` list a record declares in its own frontmatter
(`ratchet-compiler.mjs`, `zonesForRecord`). Nothing cross-checks the paths a law actually
governs against the zone its record declares. An agent-authored record declaring
`zones: [kit-tooling]`, carrying a `forbidden_text` check over `rules/AGENTS.md` — a
`humanOnly` path — verifies clean, is in force with `approvedBy: null`, and genuinely
governs that file: appending the forbidden token then turns the gate red with
`CODE_TEXT_FORBIDDEN_PRESENT`. The same record declaring `zones: [deployment-rules]` is
correctly refused with `ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE`, so the reservation is real
only when the record chooses to declare it honestly.

The manifest is the root of that authority and is itself in no zone: editing
`.dsh/project.json` to change `deployment-rules` from `humanOnly` to `activeIfNoConflict`
and then declaring that zone also verifies clean.

## Why this matters more than the individual defects

The ratchet reliably answers *"is this claim false right now?"*. It cannot answer *"is
this still the claim we agreed to?"* or *"was a claim removed?"*, because a green verdict
carries no evidence that the corpus it judged is current or complete. Every later
guarantee built on top of `verify` inherits that gap, which is why these three are one
decision and land before any other work on the ratchet.

The measurement that makes the third part cheap: an audit of every path-based check in
the corpus found three positive path patterns, and **all three already fall inside their
record's declared zone**. Enforcing the cross-check therefore leaves today's corpus green
and closes the escape without a migration.

## The decision

Three rules, each enforced by a command that fails when it is broken, and each falsified
before it is claimed:

1. **Specs cannot drift silently.** A generated document that disagrees with its decision,
   or is missing while the project tracks specs, is reported by `verify`; so is a compile
   that persists a bundle without regenerating the document.
2. **Laws cannot leave force silently.** A law that was in force and is no longer compiled
   is reported unless an active record removes it by id.
3. **Laws stay inside their declared authority.** A record's law whose positive check
   paths fall outside the union of the zones that record declares is refused, and the
   authority table that decides those zones cannot be relaxed without the gate saying so.

Each rule is asserted behaviourally in `scripts/check-gate-invariants.mjs` — driving the
production modules and requiring the wrong verdict to be refused — because ADR 0009 makes
a test name or output a green run prints anyway invalid as an enforcement point. The
authority table is asserted in `scripts/check-consent-surface.mjs`, which is already the
script that fails when the consent surface stops holding.

## Alternatives rejected

- **Set `"specsRequired": true` and stop.** Rejected as the whole fix: it is worth doing as
  well, but it leaves §6.6's on-disk clause unimplemented and the
  `compile`-without-`--write` hole open, so a project that removes the flag re-opens the
  drift. The code must implement the documented rule.
- **Rely on diff review to notice a removed law.** Rejected: that is precisely the trust
  the ratchet exists to remove, and finding 2 shows the removal leaves no artifact a
  reviewer can see without keeping their own copy of the law set.
- **Refuse any record whose law targets another zone's paths at all.** Rejected as too
  strong: a law may legitimately read a file it does not govern, and refusing that would
  break honest records. Only a *positive check path* outside the declared zones is
  refused, because that is the pattern that grants enforcement without authority.
- **Ban text checks (the assessment's phase 3).** Rejected by the operator. The semantic
  check for "violates the intent where no check catches it" is the dynamic agent layer's
  `review_change` job, and it is real: `scripts/probe-dsh-api.mjs --ratchet-review` reports
  `11/11`, with `judgeAvailable=true`, `degraded=false`, findings of kind
  `intent_violation`, and references checked against the corpus. It is also advisory by
  construction — §5.7, and the probe reports `advisory=true gate=false` — so it informs a
  reviewer and cannot gate a build. Text-check weakness is therefore mitigated by review,
  not by a rule, and that is a deliberate acceptance rather than an oversight.
- **Turn the `requiresDecisionRecord` guard on.** Deferred by the operator, not decided
  here. Every zone sets it `false` and the guard is inert in this repository.

## What this deliberately does not claim

It does not claim the ratchet can prove who wrote a record: a hand-written approval that
reproduces the ratification block, and a frontmatter word `authority: human`, remain
indistinguishable from the real thing. It does not make the dynamic judge an enforcement
point. And it does not make a `command` check stronger than the command behind it — three
new laws bound to two scripts are three claims about two scripts, which is the
concentration ADR 0009 already names.
