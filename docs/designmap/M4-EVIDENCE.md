> **Историческая запись (design-map v1).** v1 удалён в P3 2026-11-24: файлы модели, сцена-контракт и семь инструментов `designmap_*` больше не существуют; имена ниже — история, не инструкция. Актуальное описание — `docs/DESIGNMAP-V2.md`.

# M4 — package, docs, profile wiring and retirement

Date: 2026-11-16 · package `@cc/dsh-designmap` **0.1.1** · author: BACKEND (M4 task
`task-mwj4equ1-jk1d31`) · status: **packaged and documented; install/restart NOT verified
(human step)**.

## 1. Verdict

| M4 acceptance item | State | Evidence |
|---|---|---|
| pack the new package with a bumped version, report sha256 | **done** | `pack-plugin` 0.1.0 → 0.1.1, tarball + sha below |
| README documents every tool, file location, read-only/edit split | **done** | `plugins/designmap/README.md` §Packaging/§split/§PNG/§vision |
| profile/cordis.patch.yml wiring proposed and checked against dsh-doc bundle rules | **done (proposal applied to the kit template; restart pending)** | §4 diff + checklist |
| report lists per-milestone evidence and the unverified install step | **done** | §2 and §7 |
| vision loop present but off by default, or explicitly dropped with a reason | **explicitly dropped** | §6 |
| optional PNG export | **done (opt-in, no dependency)** | §5 |

## 2. Per-milestone evidence (what is actually proven)

| Milestone | Evidence |
|---|---|
| M0 core | `node bin/acceptance.mjs` → `ok:true`; demo scene `sha256:3ec7cf040db5ee668a87e436a825249fa597e2757839c622c884e688f5207ec4` (3329 B), two runs byte-identical; 13 lint rules at §8 severities + `label_over_node` warning; 25-node perf ≤ 1500 ms (acceptance worst 90.53 ms, cold perf test 265.81 ms). Details in `M0-EVIDENCE.md`. |
| M1 panel | `M1-EVIDENCE.md` — real Chromium render of `fixtures/demo` (6 nodes/5 labelled edges, legend, breadcrumb, stale chip, 0 console messages), scene/index contract read through `workspaceFiles`. Client bundle `client.js` ships in this tarball. |
| M2 edit mode | `M2-EVIDENCE.md` — 12 browser states (read-only, edit, select, drag, colour, regenerate, reset node/view, undo) through `/designmap op:'overlay'`; only `overlays.json` is written. |
| M3 host loop | `M3-EVIDENCE.md` — seven `designmap_*` tools + ungated command, gated per `agentPreset`, JSONL events, SVG export, installed-tarball resolution, overlay write path closed by the orchestrator. Suite grew 79 → 85 → 93 tests with the overlay transport fix. |
| M4 package | `npm test` **94/94 pass, exit 0** (93 + PNG case); `node scripts/check-documentation.mjs` **ok**; tarball smoke: packed `src/host.mjs` exported an SVG from a temp workspace (`bytes 1476, nodes 2, edges 1`). |

## 3. Package and tarball

```text
$ node scripts/pack-plugin.mjs --dir plugins/designmap
pack-plugin: packed plugins/designmap 0.1.0 -> 0.1.1
  tarball /home/iustimov/dsh-kit/plugins/cc-dsh-designmap-0.1.1.tgz
  sha256  585fde54f0142abdfb2b6966268a00b9958f99b974a1b13ea7c4a7f9f090eade
  exit 0
```

Tarball contents (24 files): `package.json`, `README.md`, `index.js`, prebuilt
`client.js`, and `src/` (19 modules). `test/`, `fixtures/`, `bin/`, `harness/`,
`build-client.mjs` are development-only and excluded by `files`.

Runtime dependencies stay the pinned `elkjs@0.12.1`, `yaml@2.9.1`, `zod@4.6.7`;
`@xyflow/react` and React are bundled into `client.js` (React is a shell external).

> **Superseded 2026-11-16 (packaging).** The three pinned packages are now *bundled* into
> the shipped host half (`dist/`) instead of declared as `dependencies`; see
> `plugins/designmap/README.md` § Packaging and `API-TESTS-CORE.md` §5. Declared, they
> made every `dsh web` boot that reinstalled the tarball talk to the npm registry —
> 1m22s of `ECONNRESET` retries, and a failed retry sequence left the profile without its
> plugin set because the install runs `pnpm remove` first. The version bump to `0.1.2`-`0.1.4`
> also fixed the package entry: `exports["."]` pointed at the `src/index.mjs` *library*,
> which exports no `apply()`, so the loader row never activated (`failed to import`).
> `0.1.4` is installed and active in the live web profile; `npm test` → 94/94.
`dsh.client` declares `platform: web`, `immediately: true` and eight inject packages,
each present in the shipped `@deepseek-ai/dsh-web-app` bundle.

## 4. Profile wiring (kit `profile/cordis.patch.yml`)

Proposed and applied to the kit template; the live `:3080` profile was not touched.

```yaml
- insert:
    - id: designmap
      name: '@cc/dsh-designmap'
      config:
        dir: designmap
        presets:
          - orchestrator
...
- id: design-map
  name: '@cc/dsh-design-map'
  disabled: true
```

Checked against the installed `dsh-doc` bundle rules (`references/plugin-development.md`,
`references/compositions.md`):

- the loader row id is the function name (`designmap`), one row per plugin, and it does
  not collide with the retired `design-map`;
- the row is a top-level Host row, correct because the plugin contributes tools/commands
  and no service that needs realm isolation;
- `dsh.client` in `package.json` carries the web platform and every injected package the
  shell mounts; no `!!js` expression and no profile write happens at runtime;
- the kit patch is the canonical template; the machine copy is written by the installer
  or `scripts/kit-update.mjs --apply`, not by this plugin;
- validation: the patch parses (32 entries; inserts list includes `designmap` and
  `design-map`; `disabled: true` overrides are `design-map` and the pre-existing
  `ui-subagent`).
- `plugins/inventory.json` gained the `designmap` row (`mounted: false`) and the retired
  `design-map` row was marked `mounted: false` with a note; the tarball stayed in place.

## 5. Optional PNG export

`designmap_export {format:'png'}` (and `/designmap {op:'export', format:'png'}`) writes
the SVG first, then rasterises it with the first available converter: `rsvg-convert`,
ImageMagick `convert`, or `magick`; `DESIGNMAP_PNG_CONVERTER` overrides the lookup.
Without one the service raises `png_converter_missing` and names the configured path;
conversion failure raises `png_export_failed` with bounded stderr. No rasteriser is
shipped — PNG is optional by design.

Observed (new case in `test/host-export.test.mjs`, suite 94/94):
```
✔ PNG export is optional: converter present → PNG bytes, absent → named refusal
  PNG signature bytes, pngBytes == file size, pngHash == sha256(file),
  svg still on disk; DESIGNMAP_PNG_CONVERTER=/nonexistent/... →
  png_converter_missing with details.configured
```

## 6. Vision loop — explicitly dropped

The "render → screenshot → feed the image to the model" loop is **not implemented and has
no switch**, by decision, not omission:

1. no M0–M3 contract defines an image-carrying tool result or what the loop would do with
   it, and the owner spec lists PNG only as an optional export;
2. it needs a model-facing image transport (content block, size budget, pixel redaction)
   that this milestone did not verify;
3. the panel renders the scene faithfully and the agent proves geometry from scene JSON +
   lint, which is deterministic and cheap.

Adding it later is a new tool/API spike, not a hidden default.

## 7. Not verified (explicit)

- **Install into the live `~/.npm/dsh/profiles/web` profile and `dsh web` restart** — the
  human's step; the running `:3080` process still has the old composition. No package was
  installed, no server restarted, no git commit/push.
- The packed panel `client.js` was not mounted by a real shell: its registration is proven
  by M1's harness render, not by the live profile.
- PNG export on a machine without any converter: only the refusal path is tested; the
  success path was observed with ImageMagick on this machine.
- `scripts/check-portability.mjs` is **15/17**: `no-raw-path-in-dynamic-import` and
  `no-url-pathname-as-path` fail on `plugins/designmap/harness/**` and
  `scripts/designmap-render-spike/**` (vendored DSH loader and a local dev server, both
  outside the package and outside M4 scope). The inventory/doc checks pass; the new
  tarball matches its source and is version-bumped.

## 8. Retirement plan for `@cc/dsh-design-map` 0.2.0

1. **Now (this M4):** the kit patch disables the `design-map` loader row and inserts
   `designmap`; inventory marks the old row `mounted: false`; source and tarball remain.
2. **Human install/restart:** reinstall the profile tarballs (`scripts/kit-update.mjs
   --apply` or the kit installer) and restart `dsh web`. Next boot composes only the new
   panel; `design.excalidraw` stays readable in Files but no tool writes it.
3. **After the new panel is verified live:** the owner may delete `plugins/design-map/`,
   its tarball and its inventory row. Not done here — M4 non-scope.
4. **Rollback:** remove the `disabled: true` override for `design-map` and restart; the
   old tarball is still in `plugins/`.
