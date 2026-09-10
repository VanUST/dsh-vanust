# COMPAT.md — upstream compatibility watchlist & upgrade gate

The harness is pre-1.0 (`0.1.x`). Its own `AGENTS.md` states the policy
verbatim: *"Remove at the first tagged release. Until then, prefer correct
foundations to compatibility shims: rename or repackage freely and update
every reference. Backends reject old on-disk formats."* — **breaking changes
are the expected norm**. This file is the checklist that turns each upgrade
from a leap into a gated, greppable procedure.

Pinned baseline (this kit): `@deepseek-ai/dsh@0.1.5-rc.1`, Node ≥ 24,
pnpm 11.7 (corepack).

---

## 1. The upstream API surface this kit uses

The kit ships exactly one plugin (`@deepseek-ai/dsh-model-gate`), so the
watchlist is small. Greps run against the harness source checkout
(`~/deepseek-harness`, on the branch/tag matching the installed harness).

| # | Upstream API | Where | Verify grep (in checkout) |
|---|---|---|---|
| G1 | `llm/stream` waterfall event `(options: GenerateOptions, next) => AsyncIterable<StreamChunk>`, emitted around every dispatch | `@deepseek-ai/dsh-llm` | `grep -rn "'llm/stream'" packages/llm/llm/src/index.ts` |
| G2 | `LlmError(message, code)` with a stable `code` on the thrown error | `@deepseek-ai/dsh-llm` | `grep -n "class LlmError" packages/llm/llm/src/index.ts` |
| G3 | Cordis function-plugin idiom: `name` / `inject` / `Config` (schemastery) / `apply(ctx, config)` plus `ctx.on(event, listener, {global, prepend})` | vendored cordis | `grep -rn "waterfall" vendor/cordis/src/events.ts \| head` |
| G4 | The `llm-deepseek` adapter's `models` catalog config (advertised models with `id`/`name`/`contextWindow`/`inputModalities` plus image budgets) | `@deepseek-ai/dsh-llm-deepseek` | `grep -n "models:" packages/llm/llm-deepseek/src/index.ts \| head` |
| G5 | Profile composition: `insert` rows in `cordis.patch.yml`, plugin tarballs installed with pnpm into `$DSH_HOME/profiles/<name>` | `@deepseek-ai/dsh` CLI | `dsh --profile web --dump-config` after a change |

### Ours (stable by construction — upstream churn must not touch these)

- The **gate policy semantics**: class-based model matching, the
  `MODEL_NOT_ALLOWED` failure code, and the config shape
  `{ enabled, allowedModels?, allowedModelPatterns? }`.
- The **flash-class default pattern** `^deepseek-(v[0-9.]+-)?flash(-[a-z0-9-]+)*$`,
  which admits future Flash releases without a policy edit.
- Kit-side: the profile patch's `llm-deepseek` catalog row that keeps
  non-Flash tiers out of the picker.

---

## 2. Upgrade procedure (the gate)

**Before any upgrade, snapshot:** `git -C <kit> commit` (plugin tarballs
included), `cp -r "$DSH_HOME/profiles/web" <backup>/profiles-web`, and copy
`settings.yaml` plus a tarball of `$DSH_HOME/sessions` and `storages` — session
files are machine-local with no compatibility promise, so a rollback needs
them.

1. **Install the candidate** globally — exact version, never unpinned:
   `npm install -g "@deepseek-ai/dsh@<candidate>"`
2. **Align the checkout:** put `~/deepseek-harness` on the branch/tag whose
   packages match the candidate, then `corepack pnpm install`.
3. **Rebuild the plugin** against that checkout:
   `HARNESS_DIR=~/deepseek-harness ./scripts/rebuild-plugins.sh` (repacks
   `plugins/model-gate-<version>.tgz`; commit it).
4. **Run the watchlist greps** (§1). A missing hit means the API moved: read
   the new shape, adapt `packages/host/model-gate`, rebuild again.
5. **Run the gate:** `./scripts/verify-upgrade.sh` — builds a throwaway
   `$DSH_HOME` from the kit, installs the tarball, asserts the composed tree
   mounts `model-gate`, boots `dsh web` (0.1.5+ fences the UI behind the
   `?token=` printed on the boot line), and drives the **installed artifact**
   against the candidate's cordis: a disallowed model must fail with
   `MODEL_NOT_ALLOWED` before the dispatch base, a Flash model must reach it.
6. **Probe session history separately** (the gate does not cover it): boot the
   candidate against a *copy* of the real `sessions/` and confirm the chats
   list. 0.1.5-rc.1 keeps same-layout v0/v1 readers, but the harness promises
   nothing across versions.
7. **Roll to live only on PASS:** repoint the live profile
   (`cd "$DSH_HOME/profiles/web" && corepack pnpm remove <old> && corepack pnpm add <kit>/plugins/*.tgz`),
   copy `profile/cordis.patch.yml` into the live profile, restart `dsh web`,
   and open the **token URL printed at boot** (a bare `http://127.0.0.1:3080/`
   now answers 401).
8. **On FAIL:** revert with step 0 (`npm i -g "@deepseek-ai/dsh@<previous>"`,
   restore the profile backup and tarball set) and report the failing probe.

**Never** upgrade an unpinned `dsh` on a live machine, and never rebuild the
plugin against a checkout much newer than the installed harness — the two must
match.

---

## 3. Known upstream churn signals (from history)

- **0.1.5 introduced browser authentication.** `dsh web` prints
  `http://…/?token=…`; requests without it answer 401. Bookmarks and probes
  that assume an open `http://127.0.0.1:3080/` must use that URL.
- **The web app now provides what this kit used to build.** Files
  (`ui-sidebar-files`), document/media preview (`ui-sidebar-documentpreview`),
  open-in-app and a docking layout (`ui-dockkit`) ship upstream, which is why
  the kit retired its custom workbench and terminal plugins. Upstream's
  `terminal/` family is model-facing agent tooling, not a browser panel.
- **On-disk formats:** 0.1.5-rc.1 keeps frozen v0/v1 session readers and the
  `--<cwd>--/<id>/session.jsonl.zstd` layout, so old session directories boot
  clean — but this is not a promise. `SESSION_FORMAT_VERSION` remains 0 and the
  storage backends may reject old formats at any release: do not sync
  `$DSH_HOME/sessions|storages` across machines, and always snapshot before an
  upgrade.
- The "pre-release stance" above may be removed at the first tagged release —
  that tag is when the API is expected to stabilize.
