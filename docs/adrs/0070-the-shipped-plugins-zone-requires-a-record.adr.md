---
id: "0070"
title: The shipped-plugins zone requires a decision record, and the mode rule claims only what a command refuses
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-19T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-19-what-of-the-mode-rule-a-command-can-refuse.md
  hash: sha256:a559f0272ef5d6c3b137676140a998b6a4da81d5f2dd98fd70d295071662dde9
zones:
  - shipped-plugins
supersedes: []
approves: []
laws: []
---

## Context

`rules/AGENTS.md` §14 states that a session in IMPLEMENTATION mode must have three
things before its first write: an underlying decision record (`proposed` is enough), a
defined task with the paths it may write, and a defined measure with the command that
measures it. Measured, none of the three was refused by anything in this repository:
`.dsh/project.json` declared `requiresDecisionRecord: false` on all three zones, so the
shipped write guard was inert by configuration and a file could be written into
`plugins/**` with no record naming anything.

A second gap sits under the first. Even with the flag on, the guard requires that *some
record names the zone*, not that *this task* has a decision, a scope and an acceptance
command — and on this corpus twenty-four records in force already name `shipped-plugins`,
so the flag alone refuses nothing that used to be allowed. The obvious closure — require a
live work order whose scope covers the written path and which declares an acceptance
command — was examined and refused, twice over: it would make the shipped guard deny a
write that `shipped-plugins.a-proposed-decision-licenses-the-work` (ADR 0017, ratified by
0021) says is licensed, and the command that law binds would fail; and it would not close
the gap, because a work order is keyed by path rather than by task, so a stale work order
covering `plugins/` would license work it never described.

## Decision

1. **`shipped-plugins` is declared `requiresDecisionRecord: true`.** A write into
   `plugins/**` is refused by the shipped guard until a record **in force or
   proposed** names that zone — which is why this record, `status: proposed` and
   agent-authored, is what licenses the change it describes. The flag is a manifest
   declaration, not a law: enabling it adds no law and no check, and the guard whose
   behaviour it turns on is already law
   (`shipped-plugins.a-proposed-decision-licenses-the-work`,
   `shipped-plugins.a-proposal-never-licenses-a-human-only-zone`, both bound to
   `node --test scripts/test-ratchet-guard.mjs`).
   **Measured, and stated rather than implied: on this corpus the flag is necessary
   and not sufficient.** Twenty-four records already in force name `shipped-plugins`,
   so `zonesWithRecords` satisfies the zone on its own and a write into `plugins/**`
   is allowed whether or not any record describes that work. The flag enforces "*some*
   record named this zone", never "*this task* has a decision"; a project with no
   record naming the zone yet is refused, which is the state this change repairs.
2. **`kit-tooling` stays off, as a recommendation rather than a silent choice.**
   `scripts/**` and `probes/**` hold the gate, the probes and the falsifiers; requiring a
   decision record for a one-character repair to a checker would make the cure for a red
   gate harder to write than the defect it repairs. What governs that zone is the release
   gate, which runs `ratchet verify` and `ratchet falsify` over this project.
3. **`deployment-rules` stays off**, because `rules/**` already carries a stronger gate:
   ADR 0060 (ratified by 0062) is law in force that the rules zone requires a human, and
   the rules file is installed by the release gate rather than by an agent.
4. **The mode rule is narrowed to what is enforced.** `rules/AGENTS.md` §14 and the
   implementation-mode prompt text shipped by `@cc/dsh-work-modes` both say that
   requirement (1) is the enforced one and that requirements (2) and (3) are prompt-level
   only, with the recommendation above carried where the rule is read.
5. **A law's check must be hermetic** — the rule ADR 0043 decided and left to
   convention — gains an enforcement point: `scripts/check-hermetic-laws.mjs` refuses a
   compiled law whose `command` check runs a decidable non-hermetic entry point (a probe
   script, the release gate, or something naming a port, a loopback URL or `dsh web`),
   and the manifest declares it as verification command `hermetic-laws` cited by a rule.

## Reasoning

The reasoning source is
`docs/ratchet/sources/2026-09-19-what-of-the-mode-rule-a-command-can-refuse.md`, whose
hash this record pins. It measures what `ratchet.specsRequired` actually does (it tracks
the generated law cards in `docs/specs/`, not the work orders in `.dsh/specs/`), measures
that the zone flag is diluted on this corpus by the records already in force, states why
the flag cannot be widened without contradicting law in force — and why widening it would
not close the gap anyway, because a work order is keyed by path and not by task, so a
stale work order covering `plugins/` would license work it never described, which is the
same dilution one level down — names the two requirements that remain prompt-level, and
lists the residuals the change leaves.

The trade is stated rather than hidden. Turning the flag on means a one-character fix
inside `plugins/**` needs a record naming the zone or a declared exemption; that is the
cost, and it is the point. Leaving `kit-tooling` off means requirement (1) is not
enforced on the scripts that repair the gate; the release gate is what stands in its
place, and whether that is enough is a human's call, which is why it is a recommendation
in this record rather than a change in the manifest.

## Consequences

- A write into `plugins/**` with no record naming `shipped-plugins` is refused by the
  guard; with a proposed record naming it, the write proceeds; a zone whose flag is off
  is unaffected. All three are asserted against this project's own manifest in
  `scripts/test-ratchet-guard.mjs`.
- The guard cannot see a shell command, a Node script or `pack-plugin.mjs` writing a
  file. The flag governs the harness's write tools and nothing else, and that boundary
  is unchanged by this record.
- Requirements (2) and (3) of the mode rule hold by convention after this change. The
  rule text says so, and the recommendation to build a `requiresWorkOrder` mechanism is
  recorded here for a human to decide rather than enacted by an agent.
- Enabling the flag is not retroactive and needs no migration: a record already in force
  that names `shipped-plugins` would satisfy it on its own, and the proposal above does
  today.
