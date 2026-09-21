---
id: "0074"
title: A declared verification command is bound by a law that runs it
type: adr
status: active
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-21T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-21-a-declared-verification-is-a-claim.md
  hash: sha256:c166905e1c3d0207872be7f1d0c3cf44024eeff565b36323b95bdbc88b968fbb
zones:
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: kit-tooling.the-rules-reach-the-prompt-and-nothing-else-does
    statement: The deployment rules reach a model through the kit's own section and a repository instruction file reaches none, and the clone URL the procedure quotes is the one the README carries.
    checks:
      - type: command
        run: node scripts/check-instruction-routing.mjs
        expects: the rules section is installed from DSH_HOME, the workspace loader is off, and the procedure, the README and every shipped plugin agree
        timeoutMs: 120000
  - op: upsert
    id: kit-tooling.a-non-flash-dispatch-is-vetoed
    statement: Every dispatch whose model is not Flash-class is vetoed before it is billed, and the veto names the ids it allows.
    checks:
      - type: command
        run: node scripts/check-model-gate.mjs
        expects: a pro-tier model id is refused and a Flash-class one is admitted
        timeoutMs: 120000
  - op: upsert
    id: kit-tooling.every-tracked-path-is-zoned
    statement: Every git-tracked path belongs to a declared zone or to an explicit exception, so a new file cannot fall silently to the manifest's default authority.
    checks:
      - type: command
        run: node scripts/check-zone-coverage.mjs --root .
        expects: the coverage rule reports a gap for an unplaced path and accepts a zoned or excepted one
        timeoutMs: 120000
        outputContains: zone coverage ok
  - op: upsert
    id: kit-tooling.every-law-check-is-hermetic
    statement: A law's check spawns no live server, holds no port and runs no nested gate, so the gate can be run anywhere a checkout can be read.
    checks:
      - type: command
        run: node scripts/check-hermetic-laws.mjs --root .
        expects: every command check in the corpus is a plain process that terminates
        timeoutMs: 120000
  - op: upsert
    id: kit-tooling.the-test-quality-lint-is-driven
    statement: The test-quality lint's own verdicts are driven over fixtures whose correct answer is known, including the false positives it must not report.
    checks:
      - type: command
        run: node --test scripts/test-check-test-quality.mjs
        expects: the lint reports the shapes it names and stays silent on the ones it must not
        timeoutMs: 120000
  - op: upsert
    id: kit-tooling.the-drill-verdicts-are-driven
    statement: The rule drill's verdict logic is driven over synthetic journals, so a scenario that does not elicit its violation is MISSED rather than passed.
    checks:
      - type: command
        run: node --test scripts/test-drill-kit-rules.mjs
        expects: pass, violation and missed are each produced by the journal they belong to
        timeoutMs: 120000
  - op: upsert
    id: kit-tooling.the-delegation-cap-and-modes-behave-as-stated
    statement: The subagent cap refuses a third RUNNING child, releases the slot when a run settles, and the per-session work mode is what the next prompt assembly carries.
    checks:
      - type: command
        run: node --test scripts/test-work-modes.mjs
        expects: the guard, the ledger's release rules, the mode section and the capability-fenced route all hold
        timeoutMs: 120000
  - op: upsert
    id: kit-tooling.the-cap-seam-is-measured
    statement: The seam the delegation cap rests on is measured rather than assumed, and because that measurement depends on the harness this machine happens to have, it is run in the release gate and NOT as a check of this corpus.
    checks: []
    unenforced: The measurement is `node scripts/probe-work-modes.mjs`, and it cannot be a check of this corpus: a probe reports on the harness the machine has, not on a property of the laws, so its colour would depend on an environment the gate does not control. `scripts/check-hermetic-laws.mjs` refused exactly that binding, which is what moved this law from a `command` check to this note. The measurement itself is release-gate evidence.
  - op: upsert
    id: kit-tooling.the-machine-facts-tell-absent-from-unreadable
    statement: The machine-facts document names this machine's platform, CPUs, memory, GPU, toolkit and compiler, and reports a device that is absent differently from a probe that could not run.
    checks:
      - type: command
        run: node --test scripts/test-machine-facts.mjs
        expects: a GPU machine states its devices, a GPU-less one says so with the reason, and a failed CPU probe is unknown rather than zero
        timeoutMs: 120000
---

## Context

`.dsh/project.json` declared twenty-four verification commands and the gate ran ten.
The other fifteen were declared, documented, and executed by nothing. A check nobody
runs is a claim nobody tests, and the kit's own §3 is explicit that this is the state
to report rather than to assume away.

## Decision

Eight of the fourteen are bound by a law each. They are hermetic and cheap — every one
was timed at between 0.15 and 0.45 seconds, with no credentials, no model and no
server — so they were always eligible to be law checks and simply were not bound. One
law per command, because one command verifies one claim: a law naming eight commands
would report that something failed without saying what.

The remaining six are deliberately left unbound. `gate` composes a throwaway instance,
the three `probe-dsh-api.mjs` modes drive a real harness, a real webserver or a model
turn, and the two breakers run the whole gate once per case. The deployment's own rule
is that a law's check is hermetic, so binding them would break the rule it was written
to enforce.

A seventh was tried and REFUSED, which is the useful part of this record.
`scripts/probe-work-modes.mjs` is fast and needs no credentials, so it looked like the
others; binding it turned this gate red under
`kit-tooling.every-law-check-is-hermetic`, whose verdict is that a law bound to a probe
depends on an environment the gate does not control. The check was right: a probe
measures the harness this machine has, not a property of the corpus. It stays in the
release gate.

## Reasoning

The split is the whole decision. "Bind everything declared" was rejected because it
would put a throwaway instance and a model turn inside the gate; "bind nothing" was
rejected because it leaves nine cheap, hermetic, already-written checks unrun. Each
law's `run` is byte-identical to the command the manifest declared, so the declaration
and the enforcement cannot drift apart, and a command that stops passing now fails the
gate instead of printing a line nobody reads.

## Consequences

- A regression in the instructions pipeline, the model gate, zone coverage,
  hermeticity, the test-quality lint, the drill verdicts, the delegation cap or the
  machine-facts document now fails `ratchet verify`.
- The gate grew by eight commands, all of them under half a second.
- The seven release-gate commands are still only declared: nothing fails if one is
  removed from the manifest, because there is no record of which verifications are
  deliberately unbound. That is a manifest field and a check, not more laws, and it is
  not done here.
