---
title: Using this kit, and how a project specs work
slot: rules
order: 120
status: active
---
## 0a. Using this kit, and how a project's specs work

The kit repository is the source of truth for this deployment; `$DSH_HOME` is the live profile
projected from it. Convergence is decided by CONTENT HASH, never by version or git state:
`node <kit>/scripts/kit-update.mjs --check --fetch --json` reports the drift and `--apply`
converges the machine. A profile is composed once, at boot, so a plugin, profile or rules
change needs `dsh web` restarted before it is visible.

There is no enforcement machinery here: no laws, no compiled checks, no verdict, no judge. An
ADR under `docs/adrs/` is a plain document a human keeps — nothing reads it, and nothing fails
when it is ignored. Do not go looking for a gate, a law compiler or a `verify` verb.

**Two different things are called a spec. Keep them apart.**

- `docs/specs/*.md` — advisory requirements a HUMAN owns, injected into the system prompt of
  every agent in that project under a "follow these specs" framing. Frontmatter carries
  `title` and `status`; an absent or exactly `active` status is injected, `draft`, `done` and
  `inactive` are not. The project is the nearest ancestor carrying `.dsh/project.json` or
  `.git`, so a subagent reads the same specs as its Session. Injection is read-only and
  re-evaluated on every assembly: editing a spec takes effect on the next request, with no
  restart. Write them in the **Specs** window (`@cc/dsh-adr-panel`); an agent does NOT author,
  edit or delete one.
- `.dsh/project.json` and `.dsh/specs/` — the PROJECT DECLARATION that `@cc/dsh-context`
  reads: languages, verification commands, rules each with the command that fails when broken,
  and the work orders in flight with the paths they claim and the command that accepts them.
  It is optional, and a project without it answers `context_rules` with "no .dsh/project.json
  found in this directory or any parent".

Follow the specs you are given. Where one conflicts with the task you were asked to do, say
so rather than silently choosing between them.
