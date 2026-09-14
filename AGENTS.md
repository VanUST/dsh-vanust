# AGENTS.md — dsh-kit

Deployment kit for **DeepSeek Harness (dsh)** plus the **five plugins** this
deployment adds beyond upstream, across the user's machines (2× Linux, 1× Windows):
`@deepseek-ai/dsh-model-gate`, `@cc/dsh-context`, `@cc/dsh-kit-rules`,
`@cc/dsh-ratchet` and `@cc/dsh-adr-panel`. `plugins/inventory.json` is the single source of truth for that
set and for each plugin's provenance; `scripts/check-portability.mjs` fails when a
tarball, a mounted profile row, a source directory or a packing entry point disagrees
with it. Read `USERGUIDE.md` (per-machine setup/startup) and `COMPAT.md` (upgrade
gate + upstream API watchlist) before changing anything.

The kit ships each plugin's tarball and, for every plugin whose owning project is not
this repository, a read-only **source snapshot** beside a `SOURCE-NOTICE.md` that pins
what it was copied from. The build may still run in the owning project (the harness
checkout for `model-gate`); the snapshot is what makes the plugin reviewable here.

## What each artifact is and when to update it

The kit declares itself in `.dsh/project.json`: its languages, its verification
commands, the rules it claims with the command that fails when each is broken, and
the eleven records under `docs/adrs/` — eight decisions in force, two approval records,
and the superseded ADR 0007. Two tools read it —
the `context_*` tools answer questions about the kit, and the ratchet checks the kit
against its own decisions.

| File | Role | Update when |
|---|---|---|
| `.dsh/project.json` | the kit's self-declaration: languages, rules with `enforcedBy`, verification commands, scopes, zones | a rule, a verification command or a zone changes |
| `docs/adrs/*.adr.md` | the kit's architecture decisions: **eight decisions in force** — 0001–0006, 0009 and 0010 (0007 was superseded by 0010 once a human ratified it) — plus two approval records (0008 for 0001–0007, 0011 for 0010). 0002–0006 and 0009 govern `kit-tooling`/`scripts`, where agents may self-activate. 0001 and 0010 govern `shipped-plugins`, which the manifest restricts to `proposeOnly`, so they are in force because a **human ratified them**; 0008 and 0011 carry that consent as one content hash per record. Editing a ratified record or its approval voids the consent (`RATIFICATION_STALE`), which is why a change to either ships as a new amendment ADR for the human to ratify, never as an edit | a decision is made; a human ratifies a proposed record |
| `docs/ratchet/sources/` | the reasoning each ADR cites, with a sha256 the ratchet verifies, plus the transcript of every ratification session | a decision's reasoning is added or changed (then update the ADR's hash with `ratchet hash`) |
| `plugins/*.tgz` | the built plugin tarballs (`model-gate`, `cc-dsh-kit-rules`, `cc-dsh-context`, `cc-dsh-ratchet`, `cc-dsh-adr-panel`). `cc-dsh-context` is packed from `plugins/dsh-context/` — the owning project is unreachable, see that directory's `SOURCE-NOTICE.md` | every shipped plugin change — rebuild/repack, then **commit** |
| `plugins/inventory.json` | the single source of truth for the shipped plugin set: one row per plugin with its package name, tarball prefix, provenance (`in-repo`, `reconstruction` or `snapshot`), source directory, optional `SOURCE-NOTICE.md`, packing entry point and whether it is mounted in the profile patch | a plugin is added, renamed, repacked elsewhere, or its provenance changes |
| `plugins/model-gate/` | **read-only source snapshot** of `@deepseek-ai/dsh-model-gate`, copied from the harness checkout and pinned by its `SOURCE-NOTICE.md`. It carries the authoring source AND the built `lib/` output the tarball ships, so `main` resolves and the package can be imported and packed here with no build step; regenerating `lib/` from `src/` is upstream's build and needs the harness toolchain. Read-only in the strict sense: the tarball is still produced by `scripts/rebuild-plugins.sh`, and an edit here is overwritten by the next re-copy | a harness upgrade moves the pinned ref (then re-copy src, tests and lib, and update the notice) |
| `plugins/kit-rules/` | source of `@cc/dsh-kit-rules`: contributes `$DSH_HOME/AGENTS.md` to the system prompt as a binding section, re-read per prompt assembly | the rules must reach the prompt differently (framing, precedence, source) |
| `plugins/ratchet/` | source of `@cc/dsh-ratchet`: the Ratchet v2 static layer (ADR schema, law compiler, deterministic verifier, state/reports/ledger, bootstrap, the `requiresDecisionRecord` guard) plus the dynamic layer (review, grilling agenda, ingestion) plus **ratification** (the human quiz, the transcription of its answer, and the hash-bound approval it writes) and the `ratchet` CLI. **Shipped since 2026-09-14: tarball `plugins/cc-dsh-ratchet-*.tgz` and a `ratchet` row in `profile/cordis.patch.yml`** | any ratchet behaviour changes (bump the version, repack, reinstall) |
| `plugins/ratchet/ratchet-falsify.mjs` | the **project-agnostic breaker**: `ratchet falsify --root <project>` breaks one generic invariant at a time (a hand-written approval, a law with no check, and the four file/text check kinds), runs the real verifier, and requires the expected problem code. It writes only inside the project's declared scopes plus the ratchet's own record dirs, reports an out-of-scope target without touching it (including one that escapes through a symlink, which `realpath` containment refuses), restores every mutation and the persisted verdict, and handles SIGINT/SIGTERM. A SIGKILL cannot be caught, so every mutation is journaled before it is written and `ratchet falsify --recover` (or the next run) repairs what a hard kill left behind. A check that cannot fail is reported `missed`. Exit 0 all detected, 1 any missed or errored, 2 unusable | a generic invariant or check kind is added, or the scoping model changes |
| `plugins/dsh-context/` | source of `@cc/dsh-context`, **reconstructed from the shipped tarball** — the owning project is not on this machine and the package is not on npm. Read its `SOURCE-NOTICE.md` before editing; if the owning project becomes reachable, it owns this package again | a change to the context plugin (then `node scripts/pack-plugin.mjs --dir plugins/dsh-context`) |
| `plugins/dsh-adr-panel/` | source of `@cc/dsh-adr-panel`, the deployment's web-UI window on ADRs and specs. **Browser-half only**: the host `index.js` is an empty `apply` whose only job is to make the loader discover `dsh.client` and serve `./client`; the hand-written closure-factory bundle registers a session-header button and a `shell.overlay` window, reads `docs/adrs` and `docs/specs` through the workspace file API, and asks the agent to run `ratchet_ratify` instead of minting a consent. No build step and no dependencies. Its README records the exact contracts and what was unverified without a browser | the panel's UI, its data path or its injected services change (bump the version and repack) |
| `scripts/pack-plugin.mjs` | the repack step for any in-repo plugin: derives the tarball prefix from the package name, bumps the patch version, packs, removes every other tarball for the package, prints the sha256. Refuses to overwrite an existing version, because pnpm serves an unchanged filename from the lockfile. `--dir plugins/<name>` selects the plugin; `--dry-run` reports without writing | the packing rule changes |
| `scripts/test-ratchet.mjs` | the ratchet's tests: schema, compiler, verifier, state, bootstrap, dynamic prompts, grilling agendas, ingestion, derived checks, **ratification and its falsifications**, verdict breaker regressions, verdict validation, tool declarations, and the gate's exit codes. Needs no RUNNING harness, no credentials and no model — but the tool-surface tests import `@deepseek-ai/dsh-tools`, so the checkout must be linked (`node scripts/dev-link.mjs`); without it the suite fails with one line naming that command rather than a module-not-found stack | any ratchet behaviour changes |
| `scripts/test-ratchet-guard.mjs` | the `requiresDecisionRecord` guard: what it refuses, what is exempt, what satisfies it, and that the cache notices a new ADR without a restart | the guard's rule changes |
| `scripts/check-portability.mjs` | mechanical cross-platform checks over shipped source — Windows-only paths, separator assumptions, CRLF in `.sh`/`.mjs`, bare-binary spawns — plus packaging: every module a plugin imports must be in its `files` list, and every `plugins/inventory.json` row must agree with the tarballs, sources, `SOURCE-NOTICE.md`s, packing entry points, mounted profile rows and `README.md` | the kit gains a platform assumption, a plugin gains a module, or the plugin inventory changes |
| `scripts/check-consent-surface.mjs` | the consent surface as an enforcement point: no shell mint, no tool argument that accepts an answer, blocked decisions reported with their reason, retired decisions not queued. Prints `consent surface ok` | a consent-shaped claim moves from a function into the tool or CLI surface |
| `scripts/dev-link.mjs` | links the harness packages (`@deepseek-ai/dsh-tools`) beside `plugins/ratchet` and `probes/api-probe`, which is what lets the kit's own tests and gate run from a fresh clone. The DEPLOYMENT never needs it — an installed plugin resolves its peers through the profile — so it is setup, not a gate. `--check` reports without writing, and both installers run it | a module gains a harness import, or the harness layout changes |
| `scripts/normalize-eol.mjs` | repair for the detector above: a Windows editing pass (`Set-Content`, `WriteAllText`) writes CRLF into shipped source, and this rewrites it as LF. `--check` reports without writing | shipped source was edited on Windows |
| `scripts/check-gate-invariants.mjs` | the gate's own invariants, asserted **behaviourally**: a law nothing checks is reported, a check that cannot fail is refused where the decision is compiled, a deny is called inert only when disjointness is proven, a module does not "ship" because a list names it, output assertions read each stream as written, a hand-written approval mints nothing, editing an approved record voids its consent (`RATIFICATION_STALE`) and its law leaves force, the ratification question carries the record's own file text with only the exact approve label minting consent, and the code hash moves when the code does. Prints `gate invariants ok`. It exists because a law's `outputContains: "fail 0"` was satisfied by a green run of a suite whose covering test had been emptied — a test name is not an assertion | an invariant's verdict changes, or another wrong verdict is found |
| `scripts/test-adr-panel.mjs` | the ADR panel's browser half, executed rather than merely parsed: it loads the shipped `plugins/dsh-adr-panel/client.js` through a stub module loader with a minimal React, drives `apply` with a fake client context, renders the overlay over the kit's real `docs/adrs` and `docs/specs`, and asserts the UX contract — the three reader-facing sections, states filled, provenance outlined, the awaiting-a-human state in the warn tone, no glob pattern in the chrome, and the `decided in` chip taking the tone of the record it names. A synthetic corpus covers the states the real one lacks (a superseded decision, an unknown id). No browser, no harness, no model; prints `adr panel render ok` | the panel's UI contract or its bundle layout changes |
| `scripts/falsify-kit-gate.mjs` | the breaker: breaks one kit invariant at a time and requires the ratchet gate to fail. Six cases, each verified to have actually broken something before the gate runs — including a hand-written approval ADR, which must mint nothing. A release-gate command: it runs the whole gate once per case | an invariant is added, or the gate stops catching one |
| `probes/api-probe/` | throwaway plugin the API probe mounts over a scratch `DSH_HOME`; never shipped, and its `node_modules/` is a local junction to the harness packages. `review-probe.mjs` drives the ratchet's real review path against a fixture project; `ratify-probe.mjs` drives the ratification quiz through the user-questions channel with a stub answerer standing in for the human | a harness API fact needs re-measuring, or a production path needs proving end to end |
| `scripts/probe-dsh-api.mjs` | API discovery and integration: builds a scratch home, mounts the probe rows, asserts the harness facts the ratchet rests on. `--probe-judge` spawns a judge child; `--ratchet-review` runs the ratchet's own review end to end; `--ratchet-ratify` runs the ratification quiz end to end; `--ratchet` boots the shipped plugin | a harness fact changes, or a new capability must be proven before it is designed against |
| `docs/RATCHET-API-FACTS.md` | the measured harness facts, each with its reproduction and the command producing it | a probe result changes (then the quoted figures change with it) |
| `docs/RATCHET-V2-DESIGN.md` | the living design: module contracts, the one-way boundary rule, rejected alternatives, open questions. It deliberately carries no build status or test counts — those drift, and `scripts/ratchet-cli.mjs verify` and the suite are the current answer | a contract or the static/dynamic boundary changes |
| `profile/cordis.patch.yml` | canonical profile patch: the `agent-instructions` disable, `kit-rules`, `model-gate`, the `llm-deepseek` catalog row, `dsh-context`, `ratchet` and `adr-panel` | plugin ids/names, instruction routing, or the model policy change |
| `profile/package.json` | canonical profile manifest (bundles; **no deps** — installers add machine-local tarball paths) | bundle list changes |
| `profile/pnpm-workspace.yaml` | pnpm policy incl. `allowBuilds: node-pty: true` (pre-approves its build script) | pnpm policy changes |
| `rules/AGENTS.md` | the deployment's mandatory rules, installed to `$DSH_HOME/AGENTS.md` and injected by `kit-rules`. **Section 0 points at `$DSH_HOME/DEPLOYMENT.md`** as the procedure for setup, update, verification and troubleshooting, because the operator is an agent and a user guide is a file nobody opens | the rules themselves change (mirror `~/vibecoding/INSTRUCTIONS.md`) |
| `rules/DEPLOYMENT.md` | the agent-facing operating procedure, installed to `$DSH_HOME/DEPLOYMENT.md`: what this deployment is, the clone URL, fresh-machine setup, `kit-update.mjs --check/--apply`, running the kit's own gate (`dev-link`, the suite, `ratchet verify`), the rules that must not be broken while operating, and troubleshooting. `check-instruction-routing.mjs` fails when a script it names is missing, when the pin it quotes disagrees with the installers, or when the clone URL disagrees with `README.md` | a setup, update or verification step changes |
| `install.sh` / `install.ps1` | fresh-machine setup (Node ≥ 24 → pinned dsh → profile → plugins → rules → the dev links the kit's own gate needs) | harness pin, Node requirement, or setup steps change |
| `scripts/kit-update.mjs` | update path for an installed machine: content-hash drift check, profile/rules/rules write, tarball reinstall with a lockfile drop, pinned-harness install, machine state record in `$DSH_HOME/.dsh-kit-state.json` | kit artifact layout or the convergence contract changes |
| `start.sh` / `start.ps1` | one-command startup (`dsh web --port 3080`) | port/launch changes |
| `scripts/verify-upgrade.sh` | upgrade gate: throwaway instance + composition/boot/installed-artifact policy probes | probe surface changes with the protocol |
| `scripts/probe-ratchet.mjs` | evidence for the ratchet brief: builds synthetic decision directories and prints what `ratchet_reconcile` hands the agent | the plugin's record reading changes (then `docs/RATCHET-DESIGN.md` quotes change with it) |
| `docs/RATCHET-DESIGN.md` | supervisor brief: harness/plugin/system-prompt context, the ratchet as built, its defects with reproductions, open design questions | the ratchet is redesigned, or a defect in Part IV is fixed |
| `scripts/session/session-log.mjs` | shared reader for stored session logs (concatenated zstd frames; usage on `assistant/message`) | the session file format or usage accounting changes |
| `scripts/session/session-report.mjs` | session diagnostics: record mix, prompt-size curve, cache share, compaction events, largest cache miss | session accounting changes, or the report needs another figure |
| `docs/SESSION-CONTEXT.md` | what the GUI's token counter means, how prefix caching makes long sessions affordable, what compaction this profile actually runs, and what long sessions do to cost, latency and quality | the profile's compaction wiring changes, or the model's window/pricing changes (then the quoted figures must be re-measured) |
| `scripts/rebuild-plugins.sh` | rebuild + repack from `~/deepseek-harness` (env `HARNESS_DIR`) | nothing — it is the update loop's front door |
| `COMPAT.md` | upstream watchlist (12 touchpoints, G10–G12 added for the ratification seam) + upgrade procedure | upstream API churn is detected (run its greps each upgrade) |
| `USERGUIDE.md` | per-machine setup, first-run checks, Windows notes, troubleshooting | any user-facing step changes |
| `REVIEW.md` | the out-of-repo context a reviewer needs: the machine it was verified on, the harness as an external dependency, the layout facts that explain apparent failures, this review cycle's decisions, the reproduction commands, and every remaining limitation. Not a contract — where it and an artifact disagree, the artifact wins | a review cycle changes the environment, the open items, or the reproduction steps |

## Hard rules

1. **Pins:** harness version exact (`@deepseek-ai/dsh@0.1.5-rc.1` in both
   installers), Node ≥ 24 on every machine.
   Bump all pins together and re-run the gate.
2. **The gate is mandatory:** `npm i -g @deepseek-ai/dsh@<candidate>` →
   `scripts/rebuild-plugins.sh` (checkout pinned to the candidate) →
   `scripts/verify-upgrade.sh` → only on PASS touch the live profile +
   restart. Never upgrade an unpinned dsh on a live machine.
3. **Do not commit machine-local state:** `$DSH_HOME/sessions`,
   `$DSH_HOME/storages`, `.credentials.yaml`, `settings.yaml`,
   `node_modules` — sessions are format-v0 with no compatibility promise.
4. **The kit's `profile/` files are canonical templates.** Machine profiles
   get absolute tarball paths written by the installer; never edit the
   machine profile and forget to mirror it here (and vice versa).
   `scripts/kit-update.mjs --check` is what detects the resulting drift: it
   compares content hashes, not version numbers, and refuses to let a machine
   that disagrees with the kit look converged.
5. **Tarballs live in this repo** — the deployment profile references
   `file:<kit>/plugins/*.tgz` paths; `/tmp`-only tarballs are how this broke
   before.
6. **Bump a plugin's version before repacking it.** pnpm resolves a `file:`
   dependency by path string, so an unchanged filename is served from the
   profile lockfile and the new bytes never land. The updater drops the
   lockfile and verifies installed bytes against the tarball, so a violation is
   reported as a warning instead of shipping quietly — but the fix is upstream
   of it, in the version bump.
7. **The deployment rules come from this kit and nowhere else.** The profile
   patch disables the harness's workspace-instruction loader and mounts
   `kit-rules`, which reads only `$DSH_HOME/AGENTS.md`. Never re-enable that
   loader to "also pick up project instructions": its precedence model lets a
   repository override the rules that carry cost policy and remote-change
   permission. Project facts belong in `.dsh/project.json` and the `context_*`
   tools, where a rule names the command that fails when it is broken.
8. **Verify prompt-affecting changes on a throwaway profile before the live
   one.** A `kit-rules` change is invisible in `--dump-config` beyond the row
   itself; run a headless turn against a scratch profile and ask what the model
   received, because the failure mode (rules silently absent, or a stale plugin
   installed under an unchanged version) produces a boot that looks healthy.
9. **A gate is real only where a command fails.** Before claiming the ratchet
   (or anything else in this kit) enforces a rule, name the command that exits
   non-zero when the rule is broken. `node --test scripts/test-ratchet.mjs`,
   `node plugins/ratchet/ratchet-cli.mjs verify` and
   `node plugins/ratchet/ratchet-cli.mjs falsify` are the current answers for the
   ratchet; where there is no such command, the rule is an unverified claim and
   `docs/RATCHET-V2-DESIGN.md` §6.4 lists it as one.
10. **`plugins/dsh-context/` is a reconstruction, not the owning project's
    tree.** Edit it only through `scripts/pack-plugin.mjs --dir plugins/dsh-context`,
    which bumps the version (hard rule 6) and leaves one tarball behind. If the owning
    project becomes reachable, it takes the package back — see the directory's
    `SOURCE-NOTICE.md`.
11. **The kit is authored on Windows and deployed to Linux.** Run
    `node scripts/check-portability.mjs` before shipping any change to shipped
    source; it catches the assumptions that work everywhere the author looks. A
    module added to a plugin must also be added to that plugin's `files` list, or
    the checkout works and the installed copy does not.
12. **A decision enters force through a recorded human consent, and nothing else.**
    The ratchet asks the human through the harness user-questions channel, showing
    the record's own text, and writes an approval ADR whose `ratification` block
    binds one content hash per approved record. The consent covers the text the human
    was SHOWN: editing an approved record voids it (`RATIFICATION_STALE`), and so does
    editing it while the question is open. An approval with **no well-formed
    ratification block** confers nothing (`RATIFICATION_UNPROVEN`). There is
    deliberately no argument, no tool parameter and no shell command that accepts an
    answer you composed — a consent the ratchet cannot pair with a question it asked
    is one it cannot tell from a sentence an agent typed — so `ratchet pending` only
    lists what waits and the quiz runs in a session; `scripts/check-consent-surface.mjs`
    is what fails when any of that stops holding. **The residual gap, stated plainly:**
    a hand-written approval that reproduces the block correctly — channel, time, and a
    matching hash — is indistinguishable from a generated one, so an agent that writes
    that file can forge a consent. The same is true of one word in a record's
    frontmatter: `authority: human` makes an agent's decision self-activate in any zone,
    including one the manifest reserves to humans, because nothing verifies who wrote
    the file. Never do either, and never ask an agent to.

## Common workflows

- **Ratify a proposed decision:** `node plugins/ratchet/ratchet-cli.mjs pending --root .`
  lists what waits, with the content hash each "yes" would cover. The ratification
  itself happens in a session — call `ratchet_ratify`, answer the quiz, and the tool
  writes the approval ADR plus its transcript. Then compile, verify and **commit the
  approved record together with its approval**: an edit to either one afterwards
  voids the consent, so they are only meaningful as a pair.
- **Ship a plugin change:** for `model-gate`,
  `HARNESS_DIR=~/deepseek-harness ./scripts/rebuild-plugins.sh`; for any in-repo
  plugin (`dsh-context`, `kit-rules`, `ratchet`, `adr-panel`),
  `node scripts/pack-plugin.mjs --dir plugins/<name>`. Then reinstall on the machine
  (`cd $DSH_HOME/profiles/web && corepack pnpm add <kit>/plugins/*.tgz`) → restart
  `dsh web` → commit the new tarballs. `plugins/inventory.json` names each plugin's
  packing entry point.
- **Falsify a project's laws:** `node plugins/ratchet/ratchet-cli.mjs falsify --root <project>`
  breaks one generic invariant at a time and requires the gate to fail, then restores
  every mutation and the persisted verdict. It writes only inside the project's declared
  scopes; an out-of-scope target is reported, not touched. About a minute on this kit,
  because every applicable case runs the real gate.
- **Upgrade the harness:** follow COMPAT.md §2 (snapshot → candidate →
  rebuild → greps → gate → roll).
- **New machine:** clone → `./install.sh` (or `install.ps1`) → `./start.sh`
  → configure credentials in the onboarding → run USERGUIDE §3 first-run
  checks.
- **Existing machine (migration):** USERGUIDE §5 — re-add tarballs from the
  kit, refresh patch + rules, restart.
