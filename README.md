# dsh-kit

Portable setup for **DeepSeek Harness (dsh)** plus the eight plugins this
deployment needs beyond upstream, across all your machines (2× Linux, 1× Windows).
`plugins/inventory.json` is the single source of truth for the set and for each
plugin's provenance:

- **`@deepseek-ai/dsh-model-gate`** — a class-based flash-only cost policy for the
  official DeepSeek route.
- **`@cc/dsh-context`** — project structure, declared rules and work orders
  exposed as tools (`context_module`, `context_rules`, `context_specs`). It is
  project-agnostic: it reads only `.dsh/project.json`, so a Python, C/C++ or Unity
  repository gets the same tools by writing its own manifest.
- **`@cc/dsh-kit-rules`** — the deployment's own operating rules, contributed to the
  system prompt as a binding section and re-read on every prompt assembly. It exists
  because the harness's own workspace-instruction loader does the opposite of what this
  deployment needs: it injects every `AGENTS.md`/`CLAUDE.md` from the project root down
  to the working directory, frames them as guidance, and lets the most specific file
  win. Cost policy, remote-change permission and verification duties must not be
  dilutable by whichever repository the agent happens to sit in, and they must read as
  binding — so that loader is disabled and this plugin owns the single rules file.
- **`@cc/dsh-specs`** — injects a project's human-authored specs
  (`<project>/docs/specs/*.md`) into the system prompt of every root session and every
  subagent, re-read on every prompt assembly. A spec whose frontmatter `status` is
  absent or exactly `active` is injected; `draft`, `done` and `inactive` are not. The
  project is found by walking upward from the session workspace to the nearest
  directory holding `.dsh/project.json` or `.git`. It compiles, checks and writes
  nothing: specs are advisory text a human owns, and the plugin only reads them.
- **`@cc/dsh-adr-panel`** — the deployment's own window on those specs: a session-header
  **Specs** button opens a frame-wide overlay that lists, creates, edits and deletes
  `docs/specs/*.md` through one capability-fenced host route. It renders no decisions
  and mints no consent.
- **`@cc/dsh-work-modes`** — one deployment policy on a harness seam that can actually
  refuse something: a monotonic guard refusing a third concurrent `subagent` child per
  session (a `workflow` fan-out is deliberately outside it, so it is not a ceiling on
  concurrent work, and the cap has a stated residual — a child the registry never
  disposes keeps its slot, while a child no registry can answer for stops being counted
  after the age bound). It injects no prompt section.
- **`@cc/dsh-presentation`** — one tool that turns a JSON deck spec into a standalone
  HTML presentation in the session workspace. It ships no client half on purpose: the
  Sidebar document preview already renders `.html` in a script-enabled sandboxed frame,
  so the deck is its own viewer and the file the user previews is exactly the file they
  export and print.
- **`@cc/dsh-godot-mcp`** — keeps a deployment's MCP server list declarative so it
  transfers between machines instead of being configured per machine. The harness's own
  MCP client bridge does the connecting; this plugin owns the canonical list, resolves
  the `uvx` launcher the Godot AI bridge needs, and reports for each declared server
  whether its tools are loadable. Its spec is projected to `$DSH_HOME/mcp-servers.json`
  and the row the loader reads is written to `$DSH_HOME/cordis.patch.yml` by
  `scripts/dsh-mcp-sync.mjs`, which imports the plugin's own row builder so the two
  cannot drift. It ships no MCP protocol code, by design: a second client implementation
  would diverge from the shipped one on precisely the details that are hard to get right.

Clone this repo on a new machine, run `./install.sh` (or `install.ps1` on
Windows), and `dsh web` is up with the same pinned harness version, the same
plugins, and the same core operating rules.

```bash
git clone https://github.com/VanUST/dsh-vanust.git
cd dsh-vanust               # the repository is dsh-vanust; the kit it contains is dsh-kit
./install.sh          # or: powershell -ExecutionPolicy Bypass -File install.ps1
node scripts/dev-link.mjs   # only if install.sh warned: links the harness packages
                            # so the KIT'S OWN tests run from this clone
```

**What a clone alone gives you, stated exactly.** Everything the deployment
installs is in the repository: the eight plugin tarballs, the canonical profile, the
rules file and the pinned version in both installers. Every plugin's source is here
too — `plugins/kit-rules/`, `plugins/specs/`, the reconstructed `plugins/dsh-context/`,
and a read-only snapshot of `model-gate` under `plugins/model-gate/`, each external one
carrying a `SOURCE-NOTICE.md` that pins what it was copied from. Two things come from
outside it, and both are steps the installer performs rather than files a clone could
carry: the harness itself (`npm i -g @deepseek-ai/dsh@0.2.0-rc.2`, so npm must be
reachable) and your API credentials (per machine, configured at first run — never in
the repository). One further step is needed only to run the kit's OWN tests from the
checkout: `scripts/dev-link.mjs` links the harness packages the in-repo plugins and
probes import (`@deepseek-ai/dsh-tools`) beside them (a gitignored `node_modules`).
Without that link the suite fails with one line naming it, and `install.sh` runs it
for you.

```
dsh-kit/
├── install.sh / install.ps1   # fresh-machine setup (Node check → pinned dsh → profile → plugins → rules)
├── start.sh / start.ps1       # easy startup: dsh web --port 3080
├── Makefile                   # `make usage`: analyse the newest usage export and open the report
├── scripts/usage-analytics.mjs # DeepSeek usage export → peak/cache/agent-hour analytics (md, json, html)
├── scripts/kit-update.mjs     # update path: hash drift check + convergence for an existing machine
├── plugins/inventory.json     # the shipped plugin set + each plugin's provenance (the source of truth)
├── plugins/*.tgz              # plugin tarballs: model-gate, cc-dsh-context, cc-dsh-kit-rules, cc-dsh-specs,
│                              #                  cc-dsh-adr-panel, cc-dsh-presentation, cc-dsh-work-modes,
│                              #                  cc-dsh-godot-mcp
├── plugins/model-gate/        # source snapshot + built lib/ of model-gate (see its SOURCE-NOTICE.md)
├── plugins/kit-rules/         # source of the rules plugin; packed into its tarball above
├── plugins/specs/             # source of @cc/dsh-specs (packed into its tarball above)
├── plugins/work-modes/        # source of @cc/dsh-work-modes (packed into its tarball above)
├── plugins/godot-mcp/         # source of @cc/dsh-godot-mcp (packed into its tarball above)
├── plugins/dsh-context/       # reconstructed source of @cc/dsh-context (see its SOURCE-NOTICE.md)
├── plugins/dsh-adr-panel/     # source of @cc/dsh-adr-panel (browser-half UI; see its README)
├── plugins/presentation/      # source of @cc/dsh-presentation (deck tool; no client half by design)
├── profile/                   # canonical web profile: package.json (no deps) + cordis.patch.yml
├── rules/AGENTS.md            # the deployment's mandatory rules (installed to $DSH_HOME/AGENTS.md)
├── rules/DEPLOYMENT.md        # operating this machine: install, update, checks, troubleshooting ($DSH_HOME/DEPLOYMENT.md)
├── scripts/dev-link.mjs       # links the harness packages so the kit's own tests run from a clone
├── scripts/pack-plugin.mjs    # repack an in-repo plugin with a version bump and one tarball left behind
├── scripts/rebuild-plugins.sh # rebuild + repack model-gate from the harness checkout
└── USERGUIDE.md               # per-machine setup, startup, first-run checks, Windows notes, troubleshooting
```

**Machine-local, never synced:** `$DSH_HOME/sessions`, `$DSH_HOME/storages`,
`.credentials.yaml`, `settings.yaml`, `node_modules`. The harness treats
session files as version-0 format with no compatibility promise — keep them
per-machine (see `rules/DEPLOYMENT.md` §3).

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
- **`@cc/dsh-kit-rules`**, **`@cc/dsh-specs`**, **`@cc/dsh-work-modes`**,
  **`@cc/dsh-godot-mcp`**, **`@cc/dsh-adr-panel`** and **`@cc/dsh-presentation`** —
  source lives in this repository under `plugins/<name>/`, packed with
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

**Specs, and what they are not.** A project's human-authored specs are plain markdown in
`docs/specs/`; `@cc/dsh-specs` injects the active ones into every agent's prompt and the
**Specs** button served by `@cc/dsh-adr-panel` is where a human writes them. They are
advisory text a human owns: nothing compiles them, nothing verifies code against them, and
nothing fails when one is ignored. Architecture decision records under `docs/adrs/` are
likewise plain documents a human keeps; nothing reads them.

**Reviewing this kit.** The reviewable units, and where they are. The machine this was
verified on and the procedure for reproducing that verification are `rules/DEPLOYMENT.md`.

- **Plugin source** — `plugins/kit-rules/`, `plugins/specs/`, `plugins/work-modes/`,
  `plugins/godot-mcp/`, `plugins/dsh-adr-panel/`, `plugins/presentation/`, and the
  reconstructed `plugins/dsh-context/`; `plugins/model-gate/` is a read-only upstream
  snapshot. Each package whose owning project is not this repository carries a
  `SOURCE-NOTICE.md` that states exactly what it is and is not. `plugins/inventory.json`
  is the set.
- **Design rationale** — `docs/` carries the analysis notes this kit was built from
  (`docs/HARNESS-COMPACTION-REVIEW.md`, `docs/SESSION-CONTEXT.md`,
  `docs/SUPERPOWERS-COMPARISON.md`); they are readings, not contracts, and the artifacts
  win wherever they disagree.
- **Enforcement** — `node scripts/check-portability.mjs` (platform + packaging + plugin
  inventory), `node scripts/check-model-gate.mjs` (the canonical composition's flash-only
  cost policy, read out of the packed plugin rather than retyped),
  `node scripts/check-instruction-routing.mjs` and `node scripts/check-test-quality.mjs`.
  Some of these need the one-time `node scripts/dev-link.mjs`. `rules/DEPLOYMENT.md` §4
  is the same list with the details.

**Upgrades:** the harness is pre-1.0 and breaking changes are policy. Install the
candidate and rebuild the plugins against its checkout first:
`npm i -g @deepseek-ai/dsh@<candidate>` → `./scripts/rebuild-plugins.sh` → only then
touch the live profile. Details: **`rules/DEPLOYMENT.md`** §3–4 and **`USERGUIDE.md`**
§7 (the short version).

**Versions:** harness pin `0.2.0-rc.2` · Node ≥ 24 · pnpm 11.7 (corepack).

**License:** MIT (see `LICENSE`); third-party attributions in `NOTICE`.
