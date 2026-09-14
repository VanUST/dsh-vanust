# REVIEW.md — context a reviewer needs that is not in the repository

This file exists because a repository cannot describe the machine, the upstream
project, or the decisions that were made while building it. Everything that *is* in
the kit is described where it lives — `README.md` (what each plugin is and how to
clone), `AGENTS.md` (what each artifact is, and the twelve hard rules),
`docs/adrs/*.adr.md` (the decisions), `docs/ratchet/sources/` (the reasoning each
decision cites), `docs/RATCHET-V2-DESIGN.md` (the living design),
`docs/RATCHET-API-FACTS.md` (measured harness facts) and `docs/SESSION-CONTEXT.md`
(session cost behaviour). This document adds only what those cannot: **environment,
upstream, out-of-repo dependencies, the history of this review cycle, and the
limitations that remain.**

Nothing here is a contract. Where this file and an artifact disagree, the artifact
wins and this file is the bug.

---

## 1. The environment this was built and verified on

Measured on the machine that produced the current `main`:

| Fact | Value |
|---|---|
| OS | Ubuntu 22.04.5 LTS, Linux 5.15.0-191-generic |
| Node | **v24.20.0** at `~/.npm/node/bin/node` — not nvm's default (`nvm` on this machine still points at v20) |
| npm | 11.19.0 |
| Harness CLI | `dsh` 0.1.5-rc.1 at `~/.npm/node/bin/dsh` |
| `DSH_HOME` | `/home/iustimov/.npm/dsh` (exported by `~/.npm/dsh/env.sh`) |
| Profiles | `$DSH_HOME/profiles/{web,headless,node_modules}` |
| Live profile | `$DSH_HOME/profiles/web`, composed from `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` |
| Harness checkout | `~/deepseek-harness`, `github.com/deepseek-ai/deepseek-harness.git`, tag `dsh-v0.1.5-rc.1` + 1 commit (`9041f8dbb8`) |
| Kit remote | `github.com/VanUST/dsh-vanust` — the repository is `dsh-vanust`; the kit it contains is `dsh-kit` |

Three layout details explain failures that otherwise look mysterious:

- **Node lives outside nvm.** `~/.npm/node` is a standalone Node 24 distribution, and
  `~/.npm/dsh/bin/dsh` is a wrapper that pins that interpreter so nvm's v20 default can
  never run the harness. The kit's scripts assume `node` ≥ 24; on a shell where nvm wins,
  `node` is v20 and things fail for the wrong reason. `.bashrc` prepends
  `$HOME/.npm/node/bin` after nvm loads, so a new interactive shell is correct.
- **pnpm hoists the workspace store to `$DSH_HOME/profiles/node_modules`**, not into each
  profile. `scripts/dev-link.mjs` has to look there *and* under each profile; it
  originally looked only one level down and reported "no harness installed" on a machine
  that had one.
- **The harness is a global npm install, and `npm root -g` is only correct when the
  running node is the one that installed it.** The default HTTP/2 Git push on this
  network also fails a TLS handshake (`gnutls_handshake() failed`); pushes need
  `git -c http.version=HTTP/1.1 push` (a repo-local `http.version` setting would fix it
  permanently).

## 2. What the reviewer cannot get from the repository

| Needed for | Where it comes from | Notes |
|---|---|---|
| Running the harness at all | `npm i -g @deepseek-ai/dsh@0.1.5-rc.1` | network; the kit pins the version but does not vendor the harness |
| The kit's own tests/gate | a globally installed harness, then `node scripts/dev-link.mjs` | `@deepseek-ai/dsh-tools` lives in the harness install, not here |
| Rebuilding `model-gate` | `~/deepseek-harness` at the pinned ref, then `scripts/rebuild-plugins.sh` | `plugins/model-gate/` is a read-only snapshot (now including its built `lib/`), not the build tree |
| `@cc/dsh-context` original source | unreachable | `plugins/dsh-context/` is a reconstruction from the shipped tarball; see its `SOURCE-NOTICE.md` |
| Probes that run a model | `$DSH_HOME/.credentials.yaml` | machine-local, never committed |
| Session state | `$DSH_HOME/sessions`, `$DSH_HOME/storages` | format-v0, no compatibility promise, machine-local |

`model-gate`'s `package.json` declares its harness dependencies with the workspace
protocol (`workspace:^`). That is deliberate and means `npm install` inside the snapshot
will not resolve them. The snapshot carries the built `lib/` precisely so the package
*imports and packs* without a build; recompiling `src/` requires upstream's toolchain.

## 3. Harness mechanics the ratchet depends on (measured, not recalled)

These are the non-obvious upstream facts the design rests on. Each was measured against
0.1.5-rc.1 and is recorded with its reproduction in `docs/RATCHET-API-FACTS.md`; they are
summarised here because a reviewer will otherwise assume the conventional behaviour:

- **Cordis function plugins**: `name` / `inject` / `Config` / `apply(ctx, config)`.
  An `inject` is a hard boot gate: declaring a service the composition does not mount
  fails the whole boot, which is why the ratchet reaches `subagents` and `userQuestions`
  through `ctx.get(name)` at call time instead.
- **Service names are not guessable**: the subagent runtime registers as **`subagents`**
  (plural — the row id is `subagent`), the human-question seam as **`userQuestions`**, the
  live agent registry as **`agents`**.
- **The UI's subagent switcher is fed by a session event, not by a registry call.**
  A one-shot `ctx.subagents.start('spawn', { parent, … })` appends a `subagent/catalog`
  event to the *parent session*; `@deepseek-ai/dsh-client-ui-subagent` renders the top
  lineage switcher from the resulting projection. A spawn is visible in the UI because of
  that event — which is why "the ratchet's judge appears in the UI" was a matter of the
  plugin being installed, not of extra wiring.
- **The user-questions channel is the only consent path.** The `danger-full-access`
  permission preset this deployment runs bundles `approval: never`, so the harness
  approval seam is inert exactly where ratification happens; `userQuestions` is not.
- **Profiles compose at boot** (`patchReload: live` refreshes rows, but newly installed
  plugin bytes need a restart). `kit-update.mjs --apply` therefore ends with
  `restart=required`.

## 4. What this review cycle changed, and why

Five commits on `main`, in order:

1. `e613324` — cross-platform fixes and the contradiction resolution.
2. `10bc046` — the project-agnostic breaker, plus a gate readiness bug.
3. `cabe7e8` — breaker hardening (realpath, journal, signals) and a complete model-gate
   snapshot.
4. `135c0e6` — documentation corrections for the recovery behaviour.
5. `c32bb4a` — command-check memoisation (12.7× gate speedup) and the timing
   corrections it invalidated.

Notable decisions that are **not** each an ADR:

- **`fail 0` and test names are not enforcement.** The kit's own breaker demonstrated
  that deleting a covering test's body while keeping its name produced `239 pass / 0 fail`
  and a green gate. ADR 0009 records the general fix for `kit-tooling`; the same weak
  assertions remain in three human-ratified laws from ADR 0007 — see §6.
- **Memoising identical command checks is sound only if command checks are read-only.**
  One `verify` used to take 125.5 s because 14 of its 18 command checks named the same
  8.5 s suite; it now takes 9.9 s. The assumption is documented next to the code and in
  `docs/RATCHET-V2-DESIGN.md` §6.7.
- **No rewrite in another language, no compile cache.** Measured: Node's compile cache
  saved ~4% (9.25 s → 8.92 s); the remaining cost is process starts and temporary-fixture
  I/O, not CPU-bound JavaScript. Both alternatives are rejected in §6.7.
- **A breaker must be context-scoped.** `ratchet falsify` writes only inside the project's
  declared scopes plus the ratchet's own record dirs; a target that escapes through a
  symlink is refused by `realpath` containment, and an out-of-scope target is reported,
  never written. `SIGKILL` cannot be caught, so every mutation is journaled before it is
  written and the next run (or `ratchet falsify --recover`) repairs it.

## 5. Reproducing the verification from a fresh clone

```bash
git clone https://github.com/VanUST/dsh-vanust.git /tmp/dsh-review
cd /tmp/dsh-review
export PATH="$HOME/.npm/node/bin:$PATH"   # Node >= 24, and the harness install
node scripts/dev-link.mjs                 # links @deepseek-ai/dsh-tools beside the code
node scripts/check-portability.mjs        # platform + packaging + plugin inventory
node --test scripts/test-ratchet.mjs      # the suite (263 tests, offline, no model)
node scripts/check-instruction-routing.mjs
node scripts/check-gate-invariants.mjs
node plugins/ratchet/ratchet-cli.mjs verify --root .   # the kit's own gate (19 laws)
node plugins/ratchet/ratchet-cli.mjs falsify --root .  # the breaker: breaks, requires failure, restores
node scripts/falsify-kit-gate.mjs         # the kit-specific breaker (6 cases, runs the gate per case)
```

Expected: portability `14/14`; gate invariants `16/16` plus `gate invariants ok`; tests
`263 pass / 0 fail`; gate `20 checks evaluated, 0 pending, no problems`; falsify
`3 detected, 0 missed, 3 skipped`; kit breaker `6/6`.
`scripts/verify-upgrade.sh` is the full upgrade gate and additionally installs the
tarballs into a throwaway profile, boots `dsh web` on port 3081 and probes the cost
policy; it needs network for pnpm. The probes that run a model
(`--probe-judge`, `--ratchet-review`, `--ratchet-ratify`) need credentials and are not
part of the offline gate.

**The `ratchet_*` tools are not the gate.** The tool surface deliberately supplies no
command runner, so `ratchet_verify` reports `command` checks as *pending* and cannot
report a pass. The gate is the CLI above; the tools are for an agent mid-session.

## 6. Open items, stated plainly

- **A conflict between two in-force decisions is closed.** ADR 0009's law says an
  enforcement point "never rests on a test name or on output a green run prints anyway",
  while three laws from ADR 0007 asserted `outputContains: "fail 0"` or test names. The
  kit's own dynamic review found the contradiction. Amendment **ADR 0010** now supersedes
  0007; a human ratified it through the user-questions quiz, and the approval is recorded
  as ADR 0011 with its transcript. All four laws are restated unchanged and three are
  re-bound to `scripts/check-gate-invariants.mjs`, which covers both missing claims as
  behavioural invariants — editing an approved record voids its consent and the law leaves
  force; and the question detail is the record's own file text with only the exact approve
  label minting consent. Each was falsified in a scratch copy. 0007's file was not edited;
  it is retired by supersession, so the consent 0008 recorded for it is not rewritten.
- **`RATIFICATION_STALE` cannot verify who wrote a record**, only that the text still
  hashes to what a consent recorded. A forged ratification block is indistinguishable
  from a generated one; a hand-written `authority: human` self-activates. This is ADR
  0007's own residual gap, restated in `AGENTS.md` hard rule 12.
- **`@cc/dsh-context` is a reconstruction**, not the owning project's tree. If that
  project becomes reachable, it owns the package again.
- **The model-gate snapshot cannot be rebuilt here.** Its `src/` is reviewable and its
  `lib/` runs, but producing new `lib/` output needs the harness checkout and its
  toolchain.
- **`ratchet falsify` assumes command checks are read-only** (the memoisation assumption
  above), and it does not enforce a single runner: two concurrent runs on one root would
  share a journal path.
- **`ratchet falsify` recovery is per-root and needs the project's manifest to be
  present for a *run*** (not for `--recover`, which falls back to the default journal
  location). A corrupted journal is deliberately left in place with a warning rather than
  deleting the only copy of the originals.
- **The kit-specific breaker leaves `VERIFY_NOT_RUN` behind.** It mutates laws, so after
  `scripts/falsify-kit-gate.mjs` the recorded verification points at a law set that no
  longer exists; re-run `ratchet verify` before trusting `status`.
- **A judge stopped with `stopReason: error` once** during a live `review_corpus` while
  its text was still parsed into validated findings. The findings were correct and were
  verified by hand; the stop reason itself is unexplained and worth a second run.
- **The harness is a release candidate** (0.1.5-rc.1). `COMPAT.md` is the watchlist of the
  twelve upstream touchpoints, with the grep that detects each; upgrades must go through
  `scripts/verify-upgrade.sh` before a live profile is touched.
- **This machine's live profile is converged** on `main` as of `c32bb4a` (ratchet 0.2.8,
  kit-rules 0.1.1, dsh-context 0.1.3, model-gate 0.1.5-rc.1) and the GUI was restarted, so
  the ratchet tools and the `ratchet-judge` subagent are live. A reviewer on another
  machine gets that state with `./install.sh` or `node scripts/kit-update.mjs --apply`.

## 7. Suggested reading order

1. `README.md` — the five plugins, the clone, and the "Reviewing this kit" map.
2. `AGENTS.md` — the artifact table and the twelve hard rules (rule 9 is the one that
   says a gate is real only where a command fails, and rule 12 is consent).
3. `docs/RATCHET-V2-DESIGN.md` — the module contracts, the one-way boundary, §6.7 on
   performance, §9 on open questions.
4. `docs/adrs/0007` and `0009` (the conflict), then `0010` (the proposed amendment) with
   its source in `docs/ratchet/sources/2026-09-14-enforcement-amendment.md`.
5. `docs/RATCHET-DESIGN.md` — the superseded brief whose eleven defects motivated the
   rewrite; frozen as historical evidence, not a description of the current code.
6. `plugins/ratchet/ratchet-falsify.mjs` — the breaker, as the clearest statement of how
   this kit treats verification.
