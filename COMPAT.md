# COMPAT.md — upstream compatibility watchlist & upgrade gate

The harness is pre-1.0 (`0.1.x`). Its own `AGENTS.md` states the policy
verbatim: *"Remove at the first tagged release. Until then, prefer correct
foundations to compatibility shims: rename or repackage freely and update
every reference. Backends reject old on-disk formats."* — **breaking changes
are the expected norm**. This file is the checklist that turns each upgrade
from a leap into a gated, greppable procedure.

Pinned baseline (this kit): `@deepseek-ai/dsh@0.1.1-rc.2`, Node ≥ 24,
pnpm 11.7 (corepack).

---

## 1. The upstream API surface our plugins use

Every row = one place upstream can break us. Greps are against the harness
source checkout (`~/deepseek-harness`, pinned to the same version as the
installed harness).

### Host side — `packages/host/web-workbench`

| # | Upstream API | Where | Verify grep (in checkout) |
|---|---|---|---|
| H1 | `ctx.webServer.register({kind:'prefix',path,handler})` | `@deepseek-ai/dsh-host-webserver` | `grep -n "interface WebRoute" packages/host/webserver/src/index.ts` |
| H2 | `ctx.webServer.registerUpgrade({path,handler})` | same | `grep -n "interface WebUpgradeRoute" packages/host/webserver/src/index.ts` |
| H3 | `ctx.workspaceRegistry.get(id)` + `WorkspaceId()` | `@deepseek-ai/dsh-workspace` | `grep -n "get(id" packages/workspace/workspace/src/index.ts` |
| H4 | Cordis `Service`/`Context`/`[Service.init]` | vendored cordis (`vendor/cordis`) | `grep -n "abstract class Service" vendor/cordis/src/service.ts` |
| H5 | schemastery `z.object` plugin Config | vendored schemastery | `grep -n "export function object" vendor/schemastery/src/*.ts` |
| H6 | **external deps**: `node-pty@1.2.0-beta.15` (exact — native ABI, Node-major-sensitive), `ws@^8.21` | npm | `node -p "require('node-pty/package.json').version"` after install |

### Client side — `packages/client/ui-workbench` + `ui-terminal`

| # | Upstream API | Where | Verify grep |
|---|---|---|---|
| C1 | `ctx.slots.inject(name, fn)` / `ctx.slots.register({name,id,order,locale}, Component)` | `@deepseek-ai/dsh-client-ui-slots` + `ui-renderer` | `grep -rn "register(" packages/client/ui-slots/src/store.ts | head` |
| C2 | Slot key `conversation.session.header.utilities` | `@deepseek-ai/dsh-client-ui-conversation` | `grep -rn "header.utilities" packages/client/ui-conversation/src/client/contract/slots.ts` |
| C3 | Standard props `useSessions`/`useWorkspaces` (GlobalStandardProps) via `PropsRuntime` | `ui-session` / `ui-conversation` / `ui-slots` | `grep -rn "useSessions\|useWorkspaces" packages/client/ui-slots/src/index.ts` |
| C4 | Locale face: `ctx.locale.register(NS,{zh,en})`, `t` seat, `LocaleNamespaceMap` merge | `@deepseek-ai/dsh-client-locale` | `grep -rn "interface LocaleNamespaceMap" packages/client/ui-slots/src/index.ts` |
| C5 | **DOM structure coupling**: layout frame = `div:has(> [data-shell-overlay])` (ui-layout AppFrame) — used by the tiling CSS in both plugins | `@deepseek-ai/dsh-client-ui-layout` | `grep -rn "data-shell-overlay" packages/client/ui-layout/src/client/AppFrame.tsx` |
| C6 | `dsh.client` manifest + loader rows + `/plugins/<id>/client.js` serving | `@deepseek-ai/dsh-client-modules` | `grep -rn "dsh.client" packages/client/modules/src/index.ts` |
| C7 | `window.__DSH_BOOT__` boot graph shape (informational) | same | — |

### Ours (stable by construction — do not let upstream churn touch these)

- The **`/wb-api` HTTP + WebSocket protocol** (host route + browser client are
  both in our packages). Transport hooks are H1/H2; the protocol itself is
  ours. *Planned: `protocolVersion` in `/system/capabilities` so a mismatched
  host/client fails loudly.*
- The **`dsh:terminal.open`** cross-plugin event (name mirrored in both client
  packages — keep the two copies in sync).
- The wire types mirrored in `ui-workbench|ui-terminal/src/client/types.ts`
  vs `web-workbench/src/types.ts` (keep in sync).

---

## 2. Upgrade procedure (the gate)

**Before any upgrade, snapshot:** `git -C <kit> commit` (plugins tarballs
included) and `cp -r "$DSH_HOME/profiles/web" profiles-web.bak`.

1. **Install the candidate** globally — exact version, never unpinned:
   `npm install -g "@deepseek-ai/dsh@<candidate>"`
2. **Align the checkout:** point `HARNESS_DIR` at a checkout of the candidate
   version (same tag), re-run `corepack pnpm install` if needed.
3. **Rebuild the plugins** against that checkout: `./scripts/rebuild-plugins.sh`
   (regenerates `plugins/*.tgz` into the kit — commit them).
4. **Run the watchlist greps** (§1) against the candidate source. Any missing
   hit = the API moved: read the new shape, adapt the package, rebuild again.
5. **Run the gate:** `./scripts/verify-upgrade.sh` — boots a throwaway
   instance from the kit with the candidate `dsh` and probes health, static
   assets, capabilities, WS+PTY round-trip, and boot-graph membership.
6. **Roll to live only on PASS:** reinstall the tarballs into the live
   profile (`cd "$DSH_HOME/profiles/web" && corepack pnpm add <kit>/plugins/*.tgz`),
   restart `dsh web`, refresh the browser.
7. **On FAIL:** revert with step 0 (`npm i -g "@deepseek-ai/dsh@0.1.1-rc.2"`,
   restore the profile backup), and report the failing probe upstream.

**Never** upgrade an unpinned `dsh` on a live machine, and never rebuild
plugins against a `main` checkout much newer than the installed harness —
the two must match.

---

## 3. Known upstream churn signals (from history)

- The fork ecosystem (`yth1120/deepseek-harness`) shows that RPC layers have
  already been replaced once (apiproxy vs the stock typert remotes) — client
  transport surfaces (C1–C4) are the likeliest breakage points.
- `SESSION_FORMAT_VERSION = 0`, no compat promise: **session files are
  machine-local by design** — do not sync `$DSH_HOME/sessions|storages`
  across machines or expect them to survive upgrades.
- The "pre-release stance" section may be removed at the first tagged
  release — that tag is when the API is expected to stabilize.
