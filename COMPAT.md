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
| G6 | `defineTool` from `@deepseek-ai/dsh-tools` compiles an author schema into the enforced JSON-Schema subset; a definition registered directly is validated as RAW JSON Schema and rejects the DSL-only `{type:'json'}` node | `@deepseek-ai/dsh-tools` | `node scripts/probe-dsh-api.mjs` (checks `tool.*.dispatched`, `output_schema.*`) |
| G7 | The subagent runtime registers as **`subagents`** (plural, `super(ctx, "subagents")`); `ctx.get(name)` resolves a mounted service without an `inject` declaration, while reading `ctx.<name>` for an undeclared service throws `cannot get property "<name>" without inject` | `@deepseek-ai/dsh-subagent` | `node scripts/probe-dsh-api.mjs --probe-judge` (6/6; spawns a real judge child) |
| G8 | A tool body's session workspace is `exec.agent.session.header.cwd`; `exec.signal` is an `AbortSignal`; `exec.deferContext` is callable | `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-tools` | `node scripts/probe-dsh-api.mjs` (checks `env.*`) |
| G9 | Durable `tool/result` shape is `data.message.content[]`, one block per result **per batch**, each with `toolCallId` and `isError` — not a flat `{callId, content, isError}` | `@deepseek-ai/dsh-session` log format | `node scripts/probe-dsh-api.mjs` (a wrong reader yields zero results while every record exists) |
| G10 | The human-question seam registers as **`userQuestions`** (`super(ctx, "userQuestions")`) and answers through the `user-questions/request` waterfall; `ask({ agent, questions, signal })` resolves `{ answers: [{ id, selected, custom? }] }`, authenticates the exact live runtime ROOT when an agent is supplied (`CALLER_NOT_LIVE`, `DELEGATED_CALLER`), and a root-scope listener receives an agent-scoped dispatch | `@deepseek-ai/dsh-user-questions` | `node scripts/probe-dsh-api.mjs --ratchet-ratify` (10/10; a stub answerer stands in for the human) |
| G11 | The live agent registry registers as **`agents`**; `agents.roots()` lists the runtime roots, which is how a tool tells a root caller from a spawned child | `@deepseek-ai/dsh-agent` | `node scripts/probe-dsh-api.mjs --ratchet` (the plugin boots) plus the recursion-guard test in `scripts/test-ratchet.mjs` |
| G12 | The permission presets a session runs under (`workspace-write` → approval `ask`, `danger-full-access` → approval `never`) come from `@deepseek-ai/dsh-permission-presets`, and the effective policy is a session event folded by `ctx.approval` | `@deepseek-ai/dsh-permission-presets`, `@deepseek-ai/dsh-user-approval` | `grep -n "danger-full-access" node_modules/@deepseek-ai/dsh-permission-presets/lib/index.js` in the installed harness |

G10 and G11 are the ratification path's dependencies and the sharpest new ones: an
upstream rename of either, or a change to how `ask()` authenticates its caller, would
turn ratification into a degraded path that reports a reason instead of recording a
consent — which is why the probe asserts both, and why a decision nobody can be asked
about stays pending instead of being silently activated.

### Ours (stable by construction — upstream churn must not touch these)

- The **gate policy semantics**: class-based model matching, the
  `MODEL_NOT_ALLOWED` failure code, and the config shape
  `{ enabled, allowedModels?, allowedModelPatterns? }`.
- The **flash-class default pattern** `^deepseek-(v[0-9.]+-)?flash(-[a-z0-9-]+)*$`,
  which admits future Flash releases without a policy edit.
- Kit-side: the profile patch's `llm-deepseek` catalog row that keeps
  non-Flash tiers out of the picker.

### The ratchet's watchlist (G6–G12)

`@cc/dsh-ratchet` ships as a tarball with a profile row of its own
(`plugins/cc-dsh-ratchet-*.tgz`, mounted by `profile/cordis.patch.yml`), and its
static layer and its dynamic layer are both implemented and tested against the
facts in `docs/RATCHET-API-FACTS.md`. Every upgrade must re-run the
probe, because **the ratchet's guarantees are only as good as the harness facts
underneath them**:

```bash
node scripts/dev-link.mjs                           # once per clone: links the harness
                                                    # packages the kit's tests import
node --test scripts/test-ratchet.mjs                # 249 tests, no RUNNING harness needed
node scripts/check-consent-surface.mjs              # 7 claims about the consent surface
node scripts/check-instruction-routing.mjs          # 8 claims about instruction routing
node scripts/check-gate-invariants.mjs              # 12 verdicts, asserted behaviourally
node scripts/falsify-kit-gate.mjs                   # 6 invariants broken, ~5 minutes
node scripts/probe-dsh-api.mjs                      # 18/18 harness facts
node scripts/probe-dsh-api.mjs --probe-judge        # 6/6 dynamic capability (costs a child turn)
node scripts/probe-dsh-api.mjs --ratchet-ratify     # 10/10 ratification seam (no model turn)
node scripts/probe-dsh-api.mjs --ratchet            # 3/3 the plugin still boots
```

Two of these are churn detectors rather than ratchet tests. **G7 is the sharp one:**
an upstream rename of the `subagents` service would silently turn the dynamic layer
into its degraded mode, and the probe is what makes that a red check instead of a
quiet capability loss.

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
