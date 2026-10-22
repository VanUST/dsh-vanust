# dsh-kit

Portable setup for **DeepSeek Harness (dsh)** plus the twelve plugins this
deployment needs beyond upstream, across all your machines (2× Linux, 1× Windows).
`plugins/inventory.json` is the single source of truth for the set:

- **`@cc/dsh-notify`** — a desktop notification when an agent finishes a turn and when it asks
  the user a question: `notify-send` on Linux, a WinRT toast (with a tray-balloon fallback)
  through `powershell.exe` on Windows, `osascript` on macOS. The notifier is spawned detached
  with argv-only arguments — no shell, and the text travels in environment variables on
  Windows — so it cannot block a turn, and a machine with no notifier loses the popup and
  nothing else. Silence it with `DSH_NOTIFY_DISABLED=1`.
- **`@cc/dsh-presentation`** — one tool that turns a JSON deck spec into a standalone
  HTML presentation in the session workspace. It ships no client half on purpose: the
  Sidebar document preview already renders `.html` in a script-enabled sandboxed frame,
  so the deck is its own viewer and the file the user previews is exactly the file they
  export and print.
- **`@cc/dsh-diagrams`** — one tool, `diagram`, that turns a JSON diagram spec into a
  standalone HTML document whose SVG is inline: flowcharts and algorithm illustrations,
  layered system designs, sequence diagrams and state machines, over one contract. The
  agent supplies nodes and relationships and the plugin computes every coordinate —
  layered ranking, edge routing and label placement are its own dependency-free layout
  engine — so a scheme is never handed a set of coordinates to maintain. Same reasoning
  as presentation for the missing client half: the Sidebar document preview renders the
  file, and the file prints as it looks.
- **`@cc/dsh-work-modes`** — one deployment policy on a harness seam that can actually
  refuse something: a monotonic guard refusing a third concurrent `subagent` child per
  session (a `workflow` fan-out is deliberately outside it, so it is not a ceiling on
  concurrent work, and the cap has a stated residual — a child the registry never
  disposes keeps its slot, while a child no registry can answer for stops being counted
  after the age bound). It injects no prompt section.
- **`@cc/dsh-godot-mcp`** — keeps a deployment's MCP server list declarative so it
  transfers between machines instead of being configured per machine. The harness's own
  MCP client bridge does the connecting; this plugin owns the canonical list, resolves
  the `uvx` launcher the Godot AI bridge needs, and reports for each declared server
  whether its tools are loadable. Its spec is projected to `$DSH_HOME/mcp-servers.json`
  and the row the loader reads is written to `$DSH_HOME/cordis.patch.yml` by
  `scripts/dsh-mcp-sync.mjs`, which imports the plugin's own row builder so the two
  cannot drift. It ships no MCP protocol code, by design: a second client implementation
  would diverge from the shipped one on precisely the details that are hard to get right.
- **`@cc/dsh-skills`** — nine runtime skills in one tarball: Ponytail's lazy-senior
  discipline (its test paragraph patched to the proof rule), grill-me/grilling, Karpathy
  clear-writing/explain-webpage/explain-diagram (the diagram skill adapted to the local
  `diagram` tool), the UI builder loop, the proof-not-tests ruling, and the literature
  review procedure. They register through `ctx.skills.register`; no `$DSH_HOME/skills` copy.
- **`@cc/dsh-flash-guard`** — one `agent/request` waterfall: a delegated child's model
  route is rewritten to the configured flash route, or refused, before dispatch. This is
  the enforcement behind the Subagent model-selection allowlist; external providers are
  the stated residual.
- **`@cc/dsh-proof-guard`** — a `tools/pre-execute` waterfall that denies a write or edit to
  a test file unless it carries a `PROOF:` header naming the production behavior and the
  failure it prevents. `mode: warn` exists for a trial; this is friction, not proof.
- **`@cc/dsh-taskboard`** — the task ledger and the dashboard that replaces the subagent
  catalog. One `.dsh/taskboard.json` per workspace holds objective, scope, non-scope,
  acceptance, status, results and a timeline; model tools and a `/taskboard` command share
  one Host service, plus pause/resume/close/remove lifecycle actions. The Web half reads
  through `workspaceFiles`, writes through the command Remote, adds a Tasks main panel and
  sidebar entry, a hideable detail pane, and a subagent roster with each child's role and
  active/sleeping/paused state. It reuses the `subagent-catalog` header id. The shipped `ui-subagent` client is disabled so the replacement is one cell,
  not two; child sessions are opened from the task detail.
- **`@cc/dsh-orchestrator`** — a root-only policy section, a child-only specialist section,
  and a root-only `delegate_task` tool. The tool creates the task, renders a self-contained
  brief (objective, scope, non-scope, inputs, acceptance, output, proof, timebox), starts a
  flash child and links the child id. It applies to every preset; no preset is duplicated.
- **`@cc/dsh-handoff`** — one tool that renders a structured result into a self-contained
  A4 HTML page (TL;DR, objective, changes, evidence, decisions, risks, next, artifacts) and,
  when Chrome/Chromium is available, a PDF beside it. The HTML is the source of truth.
- **`@cc/dsh-papers`** — the literature-research tool family: `papers_search` across arXiv
  and Hugging Face, `papers_trending` for the HF daily list, and `papers_download` to save an
  arXiv PDF under `.dsh/papers/` with a `pdftotext` extraction. No API key; one source can
  fail while the other returns results.

**Third-party add-on: Hindsight memory.** `@vectorize-io/hindsight-coding-agents@0.8.2`
is installed separately by its own command (`npx @vectorize-io/hindsight-coding-agents install dsh`),
not from this repository, and is therefore not one of the twelve in-repo plugins. It writes a
row into `$DSH_HOME/cordis.patch.yml` (the home layer, shared by every profile) and a
companion skill into `~/.agents/skills/hindsight-coding-agent`. Its settings live in
`~/.hindsight/coding-agent.json`; this machine's file is enabled with `serverMode: daemon`
at `apiPort: 18888` and is backed by a running local daemon using the native DeepSeek
provider. The daemon is a separate process, not auto-started by DSH; start it with the
command in `rules/DEPLOYMENT.md` §1.1, or point the config at Cloud/self-hosted. Hindsight
tools register at DSH boot, so restart DSH after changing the config. `kit-update` preserves
the home row and repairs the installer's footer, but does not configure Hindsight; the row
survives a kit convergence by design.

**Prompt, skills and model policy are now deployment surfaces.** The harness still owns the
persona and the request pipeline, but this kit deliberately adds a root/child orchestration
policy (`@cc/dsh-orchestrator`), nine runtime skills (`@cc/dsh-skills`) and a flash-route
guard (`@cc/dsh-flash-guard`). This is a change from the earlier "no plugin contributes
prompt text" stance; `rules/DEPLOYMENT.md` §2 states the policy and the seams, and the
model route still offers what the profile configures.

## Plugin list

Clone this repo on a new machine, run `./install.sh` (or `install.ps1` on
Windows), and `dsh web` is up with the same pinned harness version and the same
plugins.

```bash
git clone https://github.com/VanUST/dsh-vanust.git
cd dsh-vanust               # the repository is dsh-vanust; the kit it contains is dsh-kit
./install.sh          # or: powershell -ExecutionPolicy Bypass -File install.ps1
```

**What a clone alone gives you, stated exactly.** Everything the deployment
installs is in the repository: the twelve plugin tarballs, the canonical profile, the
procedure and the pinned version in both installers. Every plugin's source is here
too — `plugins/notify/`, `plugins/presentation/`, `plugins/diagrams/`,
`plugins/work-modes/`, `plugins/godot-mcp/`, `plugins/skills/`, `plugins/flash-guard/`,
`plugins/proof-guard/`, `plugins/taskboard/`, `plugins/orchestrator/` and
`plugins/handoff/`. Two things come from
outside it, and both are steps the installer performs rather than files a clone could
carry: the harness itself (`npm i -g @deepseek-ai/dsh@0.2.1-rc.2`, so npm must be
reachable) and your API credentials (per machine, configured at first run — never in
the repository). The kit's own checks read the checkout only, so they run on a fresh
clone with nothing else installed.

```
dsh-kit/
├── install.sh / install.ps1   # fresh-machine setup (Node check → pinned dsh → profile → plugins → procedure)
├── start.sh / start.ps1       # easy startup: dsh web --port 3080
├── Makefile                   # `make usage`: analyse the newest usage export and open the report;
│                              #   `make usage-gate`: fail when the peak share or the retired-name
│                              #   premium exceeds its cap
├── scripts/usage-analytics.mjs # DeepSeek usage export → peak/cache/agent-hour analytics (md, json, html),
│                              #   with --gate for a spend threshold and --retired-rate for prices the
│                              #   current card no longer carries
├── scripts/session/            # what the harness's own session logs say: session-report.mjs (one
│                              #   session), extract-corpus.mjs + analyse-corpus.mjs (`make
│                              #   session-analysis`: every session, in seconds per question)
├── scripts/kit-update.mjs     # update path: hash drift check + convergence for an existing machine
├── plugins/inventory.json     # the shipped plugin set (the source of truth)
├── plugins/*.tgz              # plugin tarballs: twelve packages, including notify, presentation,
│                              #                  diagrams, work-modes, godot-mcp, skills, flash-guard,
│                              #                  proof-guard, taskboard, orchestrator, handoff
├── plugins/notify/            # source of @cc/dsh-notify (desktop notifications; packed above)
├── plugins/presentation/      # source of @cc/dsh-presentation (deck tool; no client half by design)
├── plugins/diagrams/          # source of @cc/dsh-diagrams (scheme tool; own layout engine, no client half)
├── plugins/work-modes/        # source of @cc/dsh-work-modes (packed into its tarball above)
├── plugins/godot-mcp/         # source of @cc/dsh-godot-mcp (packed into its tarball above)
├── plugins/skills/            # source of @cc/dsh-skills (nine runtime skills)
├── plugins/flash-guard/       # source of @cc/dsh-flash-guard (child model-route guard)
├── plugins/proof-guard/       # source of @cc/dsh-proof-guard (test-file PROOF header)
├── plugins/taskboard/         # source of @cc/dsh-taskboard (Host service, command, Web panel)
├── plugins/orchestrator/      # source of @cc/dsh-orchestrator (root/child policy + delegate_task)
├── plugins/handoff/           # source of @cc/dsh-handoff (one-page HTML + PDF)
├── plugins/papers/            # source of @cc/dsh-papers (arXiv/HF search, trending, PDF text)
├── profile/                   # canonical web profile: package.json (no deps) + cordis.patch.yml
├── rules/DEPLOYMENT.md        # operating this machine: install, update, checks, troubleshooting ($DSH_HOME/DEPLOYMENT.md)
├── scripts/pack-plugin.mjs    # repack an in-repo plugin with a version bump and one tarball left behind
├── scripts/check-portability.mjs  # platform, packaging and inventory checks
├── scripts/check-documentation.mjs # the pin, the named scripts and the plugin set
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
(`$DSH_HOME/.dsh-kit-state.json`), writes the drifted profile files and procedure,
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

`plugins/inventory.json` names each plugin's packing entry point; every shipped plugin is
in-repo and packed with `node scripts/pack-plugin.mjs --dir plugins/<name>`, which bumps the
patch version, packs, leaves one tarball behind and prints the sha256.

**Reviewing this kit.** The reviewable units, and where they are. The machine this was
verified on and the procedure for reproducing that verification are `rules/DEPLOYMENT.md`.

- **Plugin source** — `plugins/notify/`, `plugins/presentation/`, `plugins/diagrams/`,
  `plugins/work-modes/`, `plugins/godot-mcp/`, `plugins/skills/`, `plugins/flash-guard/`,
  `plugins/proof-guard/`, `plugins/taskboard/`, `plugins/orchestrator/`, `plugins/handoff/`,
  `plugins/papers/`.
  `plugins/inventory.json` is the set.
- **Design rationale** — `docs/` carries the analysis notes this kit was built from
  (`docs/HARNESS-COMPACTION-REVIEW.md`, `docs/SESSION-CONTEXT.md`); they are readings, not
  contracts, and the artifacts win wherever they disagree.
- **Enforcement** — `node scripts/check-portability.mjs` (platform + packaging + plugin
  inventory) and `node scripts/check-documentation.mjs` (the pin, the named scripts, the
  plugin set). `make verify` runs them.
  **There is no test suite**: the kit ships no automated tests, and what replaces them is
  running the product and quoting what it produced. `rules/DEPLOYMENT.md` §4 is the same
  list with the details.

**Upgrades:** the harness is pre-1.0 and breaking changes are policy. Install the
candidate and rebuild the plugins against its checkout first:
`npm i -g @deepseek-ai/dsh@<candidate>`, then `node scripts/pack-plugin.mjs --dir plugins/<name>`
for each plugin, and only then touch the live profile. Details: **`rules/DEPLOYMENT.md`**
§3–4 and **`USERGUIDE.md`** §7 (the short version).

**Versions:** harness pin `0.2.1-rc.2` · Node ≥ 24 · pnpm 11.7 (corepack).

**License:** MIT (see `LICENSE`); third-party attributions in `NOTICE`.
