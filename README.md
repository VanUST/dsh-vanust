# dsh-kit

Portable setup for **DeepSeek Harness (dsh)** plus the four plugins this
deployment needs beyond upstream, across all your machines (2× Linux, 1× Windows).
`plugins/inventory.json` is the single source of truth for the set and for each
plugin's provenance:

- **`@deepseek-ai/dsh-model-gate`** — a class-based flash-only cost policy for the
  official DeepSeek route.
- **`@cc/dsh-context`** — project structure, enforced rules and in-flight work orders
  exposed as tools (`context_module`, `context_rules`, `context_specs`,
  `ratchet_reconcile`). It is project-agnostic: it reads only `.dsh/project.json`, so a
  Python, C/C++ or Unity repository gets the same tools by writing its own manifest.
- **`@cc/dsh-kit-rules`** — the deployment's own operating rules, contributed to the
  system prompt as a binding section and re-read on every prompt assembly. It exists
  because the harness's own workspace-instruction loader does the opposite of what this
  deployment needs: it injects every `AGENTS.md`/`CLAUDE.md` from the project root down
  to the working directory, frames them as guidance, and lets the most specific file
  win. Cost policy, remote-change permission and verification duties must not be
  dilutable by whichever repository the agent happens to sit in, and they must read as
  binding — so that loader is disabled and this plugin owns the single rules file.
- **`@cc/dsh-ratchet`** — a project's architecture decisions (`docs/adrs/*.adr.md`)
  compiled into laws a command verifies, with every problem carrying a stable code and
  a proposed decision entering force only through a recorded human consent.

Clone this repo on a new machine, run `./install.sh` (or `install.ps1` on
Windows), and `dsh web` is up with the same pinned harness version, the same
plugins, and the same core operating rules.

```bash
git clone https://github.com/VanUST/dsh-vanust.git
cd dsh-vanust               # the repository is dsh-vanust; the kit it contains is dsh-kit
./install.sh          # or: powershell -ExecutionPolicy Bypass -File install.ps1
node scripts/dev-link.mjs   # only if install.sh warned: links the harness packages
                            # so the KIT'S OWN tests and ratchet gate run from this clone
```

**What a clone alone gives you, stated exactly.** Everything the deployment
installs is in the repository: the four plugin tarballs, the canonical profile, the
rules file, the pinned version in both installers, and the ratchet's decision
corpus with its state. Every plugin's source is here too — `plugins/ratchet/`,
`plugins/kit-rules/` and the reconstructed `plugins/dsh-context/`, plus a read-only
snapshot of `model-gate` under `plugins/model-gate/`, each external one carrying a
`SOURCE-NOTICE.md` that pins what it was copied from. Two things come from outside
it, and both are steps the installer performs rather than files a clone could carry:
the harness itself (`npm i -g @deepseek-ai/dsh@0.1.5-rc.1`, so npm must be
reachable) and your API credentials (per machine, configured at first run — never in
the repository). One further step is needed only to run the kit's OWN gate from the
checkout: the ratchet's tool adapter imports `@deepseek-ai/dsh-tools`, which lives in
the harness install, so `scripts/dev-link.mjs` links it beside the plugin (a
gitignored `node_modules`). Without that link the suite fails with one line naming
it, and `install.sh` runs it for you.

```
dsh-kit/
├── install.sh / install.ps1   # fresh-machine setup (Node check → pinned dsh → profile → plugins → rules)
├── start.sh / start.ps1       # easy startup: dsh web --port 3080
├── scripts/kit-update.mjs     # update path: hash drift check + convergence for an existing machine
├── plugins/inventory.json     # the shipped plugin set + each plugin's provenance (the source of truth)
├── plugins/*.tgz              # plugin tarballs: model-gate, cc-dsh-context, cc-dsh-kit-rules, cc-dsh-ratchet
├── plugins/model-gate/        # read-only source snapshot of model-gate (see its SOURCE-NOTICE.md)
├── plugins/kit-rules/         # source of the rules plugin; packed into its tarball above
├── plugins/ratchet/           # source of @cc/dsh-ratchet (packed into its tarball above)
├── plugins/dsh-context/       # reconstructed source of @cc/dsh-context (see its SOURCE-NOTICE.md)
├── profile/                   # canonical web profile: package.json (no deps) + cordis.patch.yml
├── rules/AGENTS.md            # the deployment's mandatory rules (installed to $DSH_HOME/AGENTS.md)
├── scripts/dev-link.mjs       # links the harness packages so the kit's own gate runs from a clone
├── scripts/verify-upgrade.sh  # upgrade gate: throwaway instance + shipped-artifact policy probe
├── scripts/pack-plugin.mjs    # repack an in-repo plugin with a version bump and one tarball left behind
├── scripts/rebuild-plugins.sh # rebuild + repack model-gate from the harness checkout
├── USERGUIDE.md               # per-machine setup, startup, first-run checks, Windows notes, troubleshooting
└── COMPAT.md                  # upstream API watchlist + the upgrade procedure
```

**Machine-local, never synced:** `$DSH_HOME/sessions`, `$DSH_HOME/storages`,
`.credentials.yaml`, `settings.yaml`, `node_modules`. The harness treats
session files as version-0 format with no compatibility promise — keep them
per-machine (see COMPAT.md §3).

**Plugins** are installed from `plugins/*.tgz` by `install.sh`, which adds every tarball in that
directory.

**Keeping an installed machine current** is `scripts/kit-update.mjs`, which
compares the kit's artifacts by content hash against a machine record
(`$DSH_HOME/.dsh-kit-state.json`), writes the drifted profile files and rules,
reinstalls the drifted tarballs with the pinned pnpm, and installs the pinned
harness when it differs:

```bash
node scripts/kit-update.mjs --check            # report drift, change nothing
node scripts/kit-update.mjs --check --fetch    # same, after asking git for new commits
node scripts/kit-update.mjs --apply            # converge this machine, then record it
```

`kit-update.mjs` is the update path for a machine that is already installed —
including one where a plugin was added to the kit after that machine was set up
(see USERGUIDE §5). Its one rule to know: **bump a plugin's version before
repacking it.** pnpm resolves a `file:` dependency by its path string, so a
tarball that keeps its filename is served from the profile's lockfile snapshot;
the updater drops that lockfile and verifies the installed bytes against the
tarball, so this case is reported rather than passing silently.

`plugins/inventory.json` names each plugin's packing entry point. In short:

- **`@cc/dsh-context`** — the owning project is unreachable and the package is not on
  npm, so `plugins/dsh-context/` is a **reconstruction** extracted verbatim from the
  shipped tarball, not the original build tree (see its `SOURCE-NOTICE.md`). Edit it
  only through `node scripts/pack-plugin.mjs --dir plugins/dsh-context`, which bumps
  the patch version, packs, leaves one tarball behind and prints the sha256.
- **`@cc/dsh-kit-rules`** and **`@cc/dsh-ratchet`** — source lives in this repository
  under `plugins/kit-rules/` and `plugins/ratchet/`, packed the same way with
  `node scripts/pack-plugin.mjs --dir plugins/<name>`.
- **`@deepseek-ai/dsh-model-gate`** — built in the harness checkout from
  `packages/host/model-gate` (`HARNESS_DIR=~/deepseek-harness ./scripts/rebuild-plugins.sh`).
  `plugins/model-gate/` is a read-only source snapshot for review; it does not produce
  the tarball.

**Where the rules come from, and why not from the repository.** The harness ships a
workspace-instruction loader (`@deepseek-ai/dsh-agent-instructions`) that injects every
`AGENTS.md`/`CLAUDE.md` between the project root and the working directory, wraps them in "may be
relevant to your work … use them as guidance", and lets the most specific file take precedence. This
deployment cannot use it: rules that carry cost policy, remote-change permission and verification
duties must not be overridable by whichever repository the agent is opened in, and their framing has
to read as binding, which is a code constant upstream and therefore not a configuration option. The
profile patch therefore disables that row and mounts `@cc/dsh-kit-rules`, which reads exactly one file
— `$DSH_HOME/AGENTS.md`, the kit's own rules — and contributes it to the system prompt as a section
whose text is a provider, re-evaluated on every prompt assembly. Editing that file takes effect on
the next request, without a restart, which is the hot reload worth keeping.

**Consequence for projects:** a repository's own `AGENTS.md` no longer reaches the model. Project
facts belong in `.dsh/project.json` and the `context_*` tools, where they are declared, checkable and
carry the command that proves them — not in prose that competes with the deployment's rules.

**Reviewing this kit.** The reviewable units, and where they are:

- **Plugin source** — `plugins/ratchet/`, `plugins/kit-rules/`, and the reconstructed
  `plugins/dsh-context/`; `plugins/model-gate/` is a read-only upstream snapshot. Each
  package whose owning project is not this repository carries a `SOURCE-NOTICE.md` that
  states exactly what it is and is not. `plugins/inventory.json` is the set.
- **Decisions** — `docs/adrs/*.adr.md`, each citing its reasoning in
  `docs/ratchet/sources/` whose sha256 the ratchet verifies; the consent that put a
  decision into force is an approval record bound to a content hash.
- **Design rationale** — `docs/RATCHET-V2-DESIGN.md` (living contracts),
  `docs/RATCHET-DESIGN.md` (the superseded brief whose defects motivated the rewrite) and
  `docs/RATCHET-API-FACTS.md` (harness facts measured by `scripts/probe-dsh-api.mjs`).
- **Enforcement** — `node scripts/check-portability.mjs` (platform + packaging + plugin
  inventory), `node --test scripts/test-ratchet.mjs`, the gate itself
  (`node plugins/ratchet/ratchet-cli.mjs verify --root .`), and the breaker
  (`node plugins/ratchet/ratchet-cli.mjs falsify --root .`), which breaks one generic
  invariant at a time and requires the gate to fail. The last three need the one-time
  `node scripts/dev-link.mjs`. `rules/DEPLOYMENT.md` §4 is the same list with the exit
  codes.

**Upgrades:** the harness is pre-1.0 and breaking changes are policy. Always
go through the gate: `npm i -g @deepseek-ai/dsh@<candidate>` →
`./scripts/rebuild-plugins.sh` → `./scripts/verify-upgrade.sh` → only then
touch the live profile. Details + the API watchlist: **COMPAT.md**.

**Versions:** harness pin `0.1.5-rc.1` · Node ≥ 24 · pnpm 11.7 (corepack).

**License:** MIT (see `LICENSE`); third-party attributions in `NOTICE`.
