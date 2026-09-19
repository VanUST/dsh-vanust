# What of the implementation-mode rule a command can refuse

The deployment's own rules (`rules/AGENTS.md` §14) state that a session in
IMPLEMENTATION mode must have three things before its first write: (1) an
underlying decision record, `proposed` is enough; (2) a defined task, by name,
with the paths it may write; (3) a defined measure of the result and the
procedure that measures it. The measured position this record starts from is
that **none of the three was refused by anything in this repository**:
`.dsh/project.json` set `requiresDecisionRecord: false` on all three of its
zones, so the write guard was inert by configuration, and a file was written
into `plugins/**` with no record naming anything.

## 1. `specsRequired` is not the lever, measured

`ratchet.specsRequired: true` is already set in this project's manifest. Reading
where it is consumed shows exactly what it does and does not do:

- `plugins/ratchet/ratchet-state.mjs` `tracksSpecDocuments(root, specsDir,
  explicit)` returns `true` when `explicit === true`, and otherwise returns
  `true` once any `*.spec.md` exists under the manifest's **`specsDir`**
  (`docs/specs` here) or once the persisted bundle `.dsh/ratchet/specs.json`
  exists. Its callers are `ratchet-ops.mjs` (compile, verify) and
  `ratchet-verifier.mjs`.
- The documents that flag governs are therefore the **generated law cards** in
  `docs/specs/` — one per zone, rendered by `ratchet compile --write`. What the
  flag turns on is drift detection over those cards: a card that is stale,
  edited, missing or orphaned is reported (`ratchet-state.mjs`
  `detectSpecDrift`).

The "specification" in §14 requirement (2) is a different artifact entirely. It
is the **work order**: JSON under `.dsh/specs/`, read by
`plugins/dsh-context/context-core.mjs` (`const SPECS = '.dsh/specs'`,
`readSpecs`, `validateSpecs`), each carrying `scope: [{ resolver, path, exists }]`
and `acceptance: [{ condition, verifiedBy }]` where `verifiedBy` must be an id
declared in the manifest's `verification` list. The ratchet does not read that
directory at all: the string `.dsh/specs` appears nowhere under
`plugins/ratchet/`.

**Measured conclusion.** `specsRequired: true` tracks generated law cards in
`docs/specs/`; it cannot express, and does not enforce, "this task has a declared
scope and an acceptance command". The two are unrelated artifacts that happen to
share the English word "spec", and the manifest's existing flag is therefore not
the lever it looks like.

## 2. The zone flag is necessary and NOT sufficient, measured

Flipping `shipped-plugins.requiresDecisionRecord` to `true` makes
`governanceOf('plugins/ratchet/x.mjs')` answer `governed: true` for zone
`shipped-plugins`, while `governanceOf('scripts/x.mjs')` still answers
`governed: false` with the reason `zone "kit-tooling" does not require a decision
record`. That part works.

What the same measurement shows is that on **this** corpus the flag changes
nothing about what may be written. `loadDecisionState` satisfies a zone from
`zonesWithRecords` — the union of the zones of every record **in force** — and
the kit's corpus has twenty-four in-force records that name `shipped-plugins`
(0001, 0010, 0012, 0014, 0015, 0017, 0018, 0019, 0024, 0026, 0027, 0031–0035,
0043–0045, 0056, 0060, 0064–0066). The guard therefore answers:

```
governed zones: ["shipped-plugins"]
zones with records in force: ["shipped-plugins","kit-tooling","deployment-rules"]
governance of plugins/ratchet/x.mjs: {"governed":true,...,"requiresDecisionRecord":true}
```

and a write into `plugins/**` is allowed whether or not the record describes the
work being written. This is the gap in its exact shape: the flag enforces
"*some* record, at some time, named this zone", never "*this task* has a
decision". Turning it on is the right structural step — a project that has no
record naming the zone yet is refused — but it is not, by itself, the mode rule.

## 3. Why `requiresDecisionRecord` cannot be widened to carry (2) and (3)

The obvious closure is to require, for a write into an enabled zone, that a
record names the zone **and** that a live work order's scope covers the written
path **and** that the work order declares an acceptance command. Two independent
arguments refuse it.

**It would overturn a law in force.** `requiresDecisionRecord` has a contract
that is ratified law:

- `shipped-plugins.a-proposed-decision-licenses-the-work` (docs/adrs/0017,
  ratified by 0021): "A PROPOSED decision that names a zone satisfies that zone's
  requiresDecisionRecord, so an agent may write the work it describes before a
  human decides…"
- `shipped-plugins.a-proposal-never-licenses-a-human-only-zone` (same record).
- Both are bound to `node --test scripts/test-ratchet-guard.mjs`, whose case
  `guard: a PROPOSED agent record licenses the write while adding no law` drives
  the shipped guard over a fixture with a record and **no** work order and
  requires the write to be ALLOWED.

Adding the work-order clause under that same flag would make the shipped guard
refuse a write a ratified law says is licensed, and the command that law binds
would fail. The mechanism would not be holding the decision; it would be
overturning it.

**And it would not close the gap anyway.** A work order is keyed by **path**, not
by session or by task. Requiring "a live work order whose scope covers this
path" answers *"does any work order cover this path"* — the identical
shape of weakness as the zone rule, one level down. Two sessions, or two
successive tasks, share one `.dsh/specs/` directory in one project, so a stale
work order covering `plugins/` licenses work it never described. The mechanism
would move the dilution rather than remove it.

**A new manifest opt-in is not an agent's to introduce.**
`requiresDecisionRecord` cannot carry the extra clause, so the closure would need
a field of its own (for example a per-zone `requiresWorkOrder`) with its own
schema, guard semantics and failure direction. Nothing in the corpus authorises
it, an agent-authored proposal adds no law, and the ratchet's own guard would
then refuse writes on the strength of an unratified proposal — the exact shape
ADR 0017 refuses: a proposal governing a zone the manifest reserved to humans.
The guard would also have to read `.dsh/specs/`, a directory owned by a
*different* plugin (`@cc/dsh-context`) whose format it neither declares nor
validates; fail-closed would let one malformed work order block every write, and
fail-open would make the rule decorative. It is therefore recorded here as a
**recommendation for a human to decide**, not applied.

## 4. What is done instead, and what it buys

1. `shipped-plugins` — the zone that governs what this deployment ships — is
   declared `requiresDecisionRecord: true`. A project whose corpus has no record
   naming that zone is now refused a write into `plugins/**`, by the shipped
   guard rather than by a sentence: the guard is a `tools/pre-execute` denial,
   not a tool the model may decline to call. On this corpus the refusal is
   already satisfied by the records in force, which is stated in §2 rather than
   papered over.
2. `kit-tooling` (`scripts/**`, `probes/**`) is **left off**, deliberately and
   visibly. `scripts/` holds the gate, the probes and the falsifiers; requiring a
   decision record for a one-line repair to a checker would make the cure for a
   red gate harder to write than the defect it repairs. What governs that zone is
   the release gate, which runs `ratchet verify` and `ratchet falsify` over this
   project. This is a recommendation carried to the operator, not a decision
   taken silently.
3. `deployment-rules` (`rules/**`, `profile/**`, the installers and starters) is
   left off as well. `rules/**` already carries its own stronger gate: ADR 0060
   ("the rules zone requires ratification", ratified by 0062) is law in force
   over it, and the rules file is installed to `$DSH_HOME` by the release gate,
   not by an agent.
4. The rule text is narrowed in both places it is stated — `rules/AGENTS.md` §14
   and the implementation-mode prompt text shipped by `@cc/dsh-work-modes` — to
   claim only what a command refuses, and to carry the recommendation above where
   the rule is read rather than only in this source.

## 5. Requirements (2) and (3) after this change, stated plainly

They remain **prompt-level only**. No command in this repository fails when a
session in implementation mode has no defined task and no acceptance command.
What a command *can* check is narrower and is already checked elsewhere: a law
whose `checks` entry is a `command` fails until that command passes
(`ratchet verify`), and a work order that is `in-flight` with no acceptance
criterion bound to a declared verification id is reported by
`validateSpecs`/`context_specs` — but only for work orders that exist, and
nothing requires one to exist.

## 6. A law's check must be hermetic: from convention to a failing command

ADR 0043 (ratified by 0048) decided that "a law's check must be hermetic. Probes
that need a live webserver, a port or a nested process are release-gate evidence
(`scripts/verify-upgrade.sh`), not law checks", and narrowed six laws to hermetic
commands. Nothing enforced the rule itself: no command failed when a *new* law
bound itself to a probe, and the corpus state ("none remain") was held by
inspection.

`scripts/check-hermetic-laws.mjs` makes the decidable part of that rule a
command. It compiles the corpus from the manifest and, for every `command`
check, refuses a `run` string that names a probe script or the release gate, or
that carries a live-resource marker (`--port`, a loopback authority, an `http`
URL, `dsh web`). The residual is named rather than implied: a `run` string is
opaque, so a probe spelled some other way is not caught, and the check says so
in its own output. The enforcement is a rule in `.dsh/project.json` bound to a
declared verification command, not a law — implementing a decision already in
force is not a new decision, and an agent may not put a new law into force.

## 7. Residuals, named so they are not mistaken for guarantees

- The guard is a **write-tool** guard. It governs the harness's `write`, `edit`,
  `notebook_edit`, `multi_edit` and `str_replace_editor` calls; a shell command
  that writes a file, a Node script that writes one, or `pack-plugin.mjs`
  repacking a tarball is not seen. That boundary is already documented in the
  guard's own module header and is not changed here.
- The guard is **per zone** and satisfied by any record ever put in force naming
  it, so the flag cannot distinguish one task from another. §2 measures this.
- A path in no declared zone is not governed. `.dsh/**`, `docs/**` and
  `reports/**` are exempt by the manifest's own exception table, which is what
  keeps the cure for a refusal writable.
- Enabling the flag makes a one-character fix inside `plugins/**` require a
  record naming `shipped-plugins`, or the write is refused. That is the point of
  the flag and it is also its cost; it is reported to the operator rather than
  discovered later.
