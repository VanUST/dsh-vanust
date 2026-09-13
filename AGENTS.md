# AGENTS.md — dsh-kit

Deployment kit for **DeepSeek Harness (dsh)** plus **`@deepseek-ai/dsh-model-gate`**,
the one plugin this deployment adds beyond upstream (a class-based flash-only
cost policy), across the user's machines (2× Linux, 1× Windows). Read
`USERGUIDE.md` (per-machine setup/startup) and `COMPAT.md` (upgrade gate +
upstream API watchlist) before changing anything. The plugin source lives in
`~/deepseek-harness` (`packages/host/model-gate`); this repo carries only
**shipping artifacts** and the **canonical deployment files**.

## What each artifact is and when to update it

| File | Role | Update when |
|---|---|---|
| `plugins/*.tgz` | the built `model-gate` plugin tarball | every shipped plugin change — via `scripts/rebuild-plugins.sh`, then **commit** |
| `profile/cordis.patch.yml` | canonical profile patch: the `model-gate` row + the `llm-deepseek` catalog row | plugin ids/names or the model policy change |
| `profile/package.json` | canonical profile manifest (bundles; **no deps** — installers add machine-local tarball paths) | bundle list changes |
| `profile/pnpm-workspace.yaml` | pnpm policy incl. `allowBuilds: node-pty: true` (pre-approves its build script) | pnpm policy changes |
| `rules/AGENTS.md` | user-global core operating rules, installed to `$DSH_HOME/AGENTS.md` | the rules themselves change (mirror `~/vibecoding/INSTRUCTIONS.md`) |
| `install.sh` / `install.ps1` | fresh-machine setup (Node ≥ 24 → pinned dsh → profile → plugins → rules) | harness pin, Node requirement, or setup steps change |
| `scripts/kit-update.mjs` | update path for an installed machine: content-hash drift check, profile/rules/rules write, tarball reinstall with a lockfile drop, pinned-harness install, machine state record in `$DSH_HOME/.dsh-kit-state.json` | kit artifact layout or the convergence contract changes |
| `start.sh` / `start.ps1` | one-command startup (`dsh web --port 3080`) | port/launch changes |
| `scripts/verify-upgrade.sh` | upgrade gate: throwaway instance + composition/boot/installed-artifact policy probes | probe surface changes with the protocol |
| `scripts/rebuild-plugins.sh` | rebuild + repack from `~/deepseek-harness` (env `HARNESS_DIR`) | nothing — it is the update loop's front door |
| `COMPAT.md` | upstream watchlist (5 touchpoints) + upgrade procedure | upstream API churn is detected (run its greps each upgrade) |
| `USERGUIDE.md` | per-machine setup, first-run checks, Windows notes, troubleshooting | any user-facing step changes |

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

## Common workflows

- **Ship a plugin change:** `HARNESS_DIR=~/deepseek-harness ./scripts/rebuild-plugins.sh`
  → reinstall on the machine (`cd $DSH_HOME/profiles/web && corepack pnpm add <kit>/plugins/*.tgz`)
  → restart `dsh web` → commit the new tarballs.
- **Upgrade the harness:** follow COMPAT.md §2 (snapshot → candidate →
  rebuild → greps → gate → roll).
- **New machine:** clone → `./install.sh` (or `install.ps1`) → `./start.sh`
  → configure credentials in the onboarding → run USERGUIDE §3 first-run
  checks.
- **Existing machine (migration):** USERGUIDE §5 — re-add tarballs from the
  kit, refresh patch + rules, restart.
