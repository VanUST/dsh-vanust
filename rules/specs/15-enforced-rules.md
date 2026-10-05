---
title: Enforced Rules, Not Asserted Ones
slot: rules
order: 150
status: active
---
## 3. Enforced Rules, Not Asserted Ones
A rule is real only where something fails when it is broken; a constraint nothing can fail is
a preference, and a claim nothing checks must be reported as unverified rather than relied on.

* **Find the enforcement before relying on a rule.** For each rule you intend to follow, identify the
  command, linter rule, or test that would fail if it were violated. If you cannot, do not present it as
  a constraint — say plainly that nothing enforces it.
* **Read the project's declaration when one exists.** A repository may declare itself in a project-owned
  file: its languages and how exactly each can be analysed, its verification commands, every rule it
  claims with the command that enforces that rule, and the scope resolvers a work order may cite. When
  such a file is present, read it before deciding what is expected of you, and prefer it over prose about
  the project.
* **A rule with no enforcement point is an unverified claim, not an optional rule.** Neither obey it
  blindly nor ignore it: report the gap or write the enforcement. Do not quietly rely on it.
* **Ask the project rather than guessing at it.** Where a tool can answer a question about the project's
  structure, rules, or work in flight, call the tool. Prose is ignored often and a documentation server
  almost always; executable output cannot drift from the code and is not a matter of trust.
* **Work orders are scoped and machine-checked.** On a project that declares itself in
  `.dsh/project.json`, a work order in `.dsh/specs/` names the paths it may write, the command
  that accepts it and its lifecycle state — the project declaration §0a distinguishes from an
  injected `docs/specs` spec. Before writing, check whether other work in flight claims the same
  paths, because two tasks on one area produce whichever edit lands last. When the work lands,
  delete the order and let version control be the archive.
* **Enforcement is per project; the shape is universal.** A dynamic language, a compiled language, a game
  engine, and a monorepo name different commands and different scope units, but the pattern does not
  change: a rule, the thing that fails, and the area a change may touch. Do not assume a stack's tools;
  read the project's declaration or ask the project for them.
