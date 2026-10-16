# Consolidating the global rules

**Date:** 2026-10-14 · **Scope:** the binding rules in `rules/specs/` · **Verified with:**
`make verify`, `node scripts/probe-dsh-api.mjs --global-specs`

## The decision

The 15 numbered rule sections were **merged to 11 and rewritten to their normative core**:
4 sections were folded into others (4 files deleted), and every section lost the wording
that restated another section, explained why, or gave an illustrative example rather than
an obligation. No obligation was retired.

| After | Before |
|---|---|
| §0 Operating this deployment | §0 + §0a |
| §1 Log-Driven Development | §1 |
| §2 Documentation and API Discipline | §2 + §4 (fetch-api-first) |
| §3 Enforced Rules, Not Asserted Ones | §3 |
| §4 Architecture and Consultation | §5 + §6 |
| §5 Grilling Option | §7 |
| §6 Model and Cost Policy | §8 |
| §7 Remote Systems | §9 |
| §8 Evidence and Adversarial Verification | §10 + §11 |
| §9 No Tests Driven Development | §12 |
| §10 Gather the Context You Do Not Have | §13a |

## Why

The rules are one prompt item each, injected into **every session and every subagent, in
every project**. The measured problem was not the slot's size budget (80,000 chars, never
approached) but **attention**: 15 sections of ~4,169 words in which the heaviest five were
55% of the text, the same obligations appeared in two or three places, and reference
material that answers *how the mechanism works* sat inside the block that answers *what you
must do*. A rule the reader skims past because it is the third restatement of one already
read is the rule that does not get followed.

The duplication was concrete: the doc-is-part-of-the-change duty appeared in both §1 and
§2; "nothing enforces this" in §0a, §3 and §12; "look up facts, don't ask" twice in §7;
"falsify before trusting" in both §10 and §11. The non-normative material was concrete too
— §0a explained the spec scopes, ADRs and the kit's hash mechanics, and §2 carried a full
example — all true, and all already carried by `DEPLOYMENT.md` and `USERGUIDE.md` §3.1.

## Measured result

| | Before | After | Change |
|---|---|---|---|
| Rule sections | 15 + intro | 11 + intro | −27% |
| Seeds in `rules/specs/` | 20 | 16 | −20% |
| Words (rule bodies) | 4,169 | 2,837 | −32% |
| **Chars in the assembled `specs:rules` prompt** | **26,315** | **17,615** | **−33%** |

The prompt figure is the one that matters and it is the probe's own:
`node scripts/probe-dsh-api.mjs --global-specs` prints `specs:rules present (N chars)`.

**The estimate was optimistic.** The reduction was projected at ~55% on the assumption that
most rationale was cuttable. Measured, it is 33%. A second pass could reach further only by
removing the one-line *why* a rule exists or the edge cases that give it force — which would
trade a lower character count for weaker compliance, the opposite of the goal. That trade
was not made.

## What was preserved, and how it is checked

- Every obligation survives. The consolidation is a merge, not a subtraction: each old
  section's normative statements were carried into the new section that owns the topic,
  and a phrase-level audit confirmed each one is present in the new text.
- `scripts/check-instruction-routing.mjs` previously asserted `seeds.length >= 18`, a count
  that passes a catalogue which swapped one section for another. It now **names the twelve
  required section seeds** and fails when any is missing, so retiring or renaming a section
  is an explicit edit to the check rather than a silent subtraction. `make verify` is green
  with the new claim (`rules/specs holds every rules section as its own item — 12 section(s)
  present`).
- The 5 `rules/drills/*.json` scenarios carried `ruleSection` anchors into the old
  numbering; each was repointed to its consolidated heading.

## Alternatives considered

- **Tighten without merging (16 files kept).** Smaller diff and no anchor churn, but it
  leaves 15 top-level sections competing for the same attention. Rejected: the count was
  as much of the complaint as the length.
- **A short binding core, with the detail demoted to on-demand reference.** The strongest
  focus on obedience, but it demotes currently-binding rules, which is a policy change, not
  a simplification. Held for a separate decision.
- **Wiring the drill runner as part of this change.** The 5 drill scenarios have no verdict
  runner — nothing reads their `green`/`red`, and no `make` target invokes `--drill`. That
  is the one mechanism the kit designed to test a prompt rule, and it is the honest way to
  claim this reduction did not weaken compliance. It is a separate, larger piece of work and
  was not bundled in.

## Gaps this change exposes

1. **A retired seed is not removed from a machine.** `kit-update.mjs` treats
   `$DSH_HOME/specs/*.md` as seeds: it writes a seed that is new or changed, and leaves a
   seed a human edited alone. It has no notion of a seed the kit *withdrew*, so after an
   apply the four deleted files remain on the machine and their old sections are injected
   **beside** their replacements. The projection needs a retirement path, or the four files
   must be removed from `$DSH_HOME/specs` explicitly.
2. **The drills are still unwired.** Consolidation repointed their anchors; it did not give
   them a runner.
