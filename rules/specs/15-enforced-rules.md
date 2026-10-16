---
title: Enforced Rules, Not Asserted Ones
slot: rules
order: 140
status: active
---
## 3. Enforced Rules, Not Asserted Ones

A rule is real only where something fails when it is broken. A constraint nothing can fail is
a preference, and a claim nothing checks is unverified — report it as such instead of relying
on it.

- **Find the enforcement first.** Name the command, linter rule or test that fails when the
  rule is violated. If there is none, say plainly that nothing enforces it; do not present it
  as a constraint.
- **Read the project's declaration.** Where a repository declares its languages and how each
  is analysed, its verification commands, every rule with the command that enforces it, and
  the scope resolvers a work order may cite, read that and prefer it over prose about the
  project.
- **A gap is not an option.** A rule with no enforcement point is neither something to obey
  blindly nor to ignore: report the gap, or write the enforcement.
- **Ask the project, do not guess.** Where a tool can answer a question about the project's
  structure, rules or work in flight, call the tool; executable output cannot drift from the
  code the way prose can.
- **Work orders are scoped and machine-checked.** Where `.dsh/project.json` declares them, a
  work order in `.dsh/specs/` names the paths it may write, the command that accepts it and
  its lifecycle state. Before writing, check that no other work in flight claims the same
  paths — two tasks on one area produce whichever edit lands last. Delete the order when the
  work lands; version control is the archive.
- **Enforcement is per project; the shape is universal.** A dynamic language, a compiled
  language, a game engine and a monorepo name different commands and different scope units,
  but each has the same three things: a rule, the thing that fails, and the area a change may
  touch. Read the declaration or ask the project for them.
