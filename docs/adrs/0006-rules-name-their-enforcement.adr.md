---
id: "0006"
title: A rule ships with the command that fails when it is broken
type: adr
status: active
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-13T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-13-ratchet-design-session.md
  hash: sha256:1abfded03aafb25e63e826f20a5917056084b58532a07b591caccd67a96efaf8
zones:
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: kit-tooling.rules-name-a-declared-command
    statement: A rule the kit claims must name a command the manifest declares and whose implementation exists; a rule with no enforcement point is reported as an unverified claim rather than presented as a constraint.
    checks:
      # `enforcedBy` appearing in the manifest is true of a rule citing a command
      # nobody declared. The invariant is that every citation resolves, which the test
      # checks against both the declared command list and the filesystem.
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: every manifest rule cites a declared verification command whose file exists
        timeoutMs: 300000
  - op: upsert
    id: kit-tooling.every-command-has-an-implementation
    statement: A declared verification command names a file that exists, because a command whose implementation is absent enforces nothing while reading as an enforcement point.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: every declared verification command names a file that exists
        timeoutMs: 300000
---

## Context

The deployment's rules file contains real obligations: use only Flash-class models,
never change a remote system without permission, verify before declaring work done.
Some of those had an enforcement point and some did not, and nothing distinguished
the two. A reader obeying the rules and a reviewer citing them both assume the rules
are checked, so a rule with no failure mode is worse than an absent one — it produces
the confidence of a constraint with the substance of a wish.

The design work made the distinction unavoidable, because building a gate forces the
question of what the gate actually refuses.

## Decision

Every rule the kit claims names the command that fails when it is broken, recorded in
`.dsh/project.json` as `enforcedBy`. Where no such command exists, the rule is listed
as an unverified claim in `docs/RATCHET-V2-DESIGN.md` §6.4 rather than presented as a
constraint.

## Reasoning

Naming the command forces the question "does this actually fail?" at the moment the
rule is written, which is the only moment anyone is thinking about it. A rule added
without an enforcement point is still allowed — it is recorded as a claim — but it
cannot be mistaken for a check.

The kit already had this insight in its rules file; this decision makes it
operational by giving rules a machine-readable place to name their enforcement. The
`context_rules` tool reads exactly this field and reports a rule whose cited command
is undeclared or whose implementation is missing as **not enforced**, so the answer
to "is this rule real?" is a tool call rather than a reading of prose.

## Consequences

- `context_rules` can answer "is this rule enforced?" without reading documentation.
- A rule whose command is declared but whose file does not exist is reported as
  unenforced, not as enforced — the tool refuses to claim protection that is absent.
- Several rules remain unenforced today and say so: `requiresDecisionRecord` is
  enforced by a tool guard only where a manifest opts in, and the Part 17 obligation
  to write an ADR before an architectural decision has no guard at all. §6.4 lists
  them.
- This record is agent-authored and `proposed`. Under the manifest's `proposeOnly`
  default it is intent, not law, until a human approval ADR names it — which is the
  authority model applied to the rules that describe the authority model.
