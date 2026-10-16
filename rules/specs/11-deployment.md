---
title: Operating this deployment
slot: rules
order: 110
status: active
---
## 0. Operating this deployment

When asked to set up, install, start, update, verify or troubleshoot the DeepSeek Harness
deployment itself — not the project you are working in — read `$DSH_HOME/DEPLOYMENT.md` and
follow it. Do not reconstruct the steps from memory, and do not substitute `USERGUIDE.md`,
which is a human's copy of the same material.

The kit repository is the source of truth; `$DSH_HOME` is the live profile projected from it.
Convergence is decided by content hash, never by version or git state:
`node <kit>/scripts/kit-update.mjs --check --fetch --json` reports drift and `--apply`
converges the machine. A profile or plugin change needs `dsh web` restarted; a spec item is
re-read on every prompt assembly and takes effect without one.

Nothing here is machine-enforced — no gate, no compiled check, no verdict, no judge. An ADR
under `docs/adrs/` is a document a human keeps, and nothing reads it. Do not go looking for
enforcement machinery that does not exist.

**Two different things are called a spec.**

- `docs/specs/*.md` — advisory requirements a HUMAN owns, injected into every agent's prompt
  in that project unless their `status` is `draft`, `done` or `inactive`. An agent does NOT
  author, edit or delete one; they are written in the Specs window.
- `.dsh/project.json` and `.dsh/specs/` — the project declaration `@cc/dsh-context` reads:
  languages, verification commands, every rule it claims with the command that fails when it
  is broken, and the work orders in flight with the paths they claim and the command that
  accepts them. Optional.

Follow the specs you are given. Where one conflicts with what you were asked to do, say so
rather than silently choosing between them.
