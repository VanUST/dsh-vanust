# M4 handoff — package, docs, profile wiring, retirement

Status at handoff: **M4 deliverables written; install/restart deliberately not done.**
Task: `task-mwj4equ1-jk1d31` (BACKEND, M4).

## Done and proven

1. **PNG export (optional, no dependency)** — `src/host.mjs` `exportView({format:'png'})`
   writes the SVG, then rasterises with `rsvg-convert` / `convert` / `magick`
   (`DESIGNMAP_PNG_CONVERTER` override). Missing converter → `png_converter_missing`;
   failure → `png_export_failed`. Wired through `src/tools.mjs` (`format` enum, default
   svg) and `src/command.mjs` (`op:'export'`). Case added to `test/host-export.test.mjs`.
   Proof: `npm test` → **94/94 pass, exit 0** (was 93 + PNG).
2. **Package** — `node scripts/pack-plugin.mjs --dir plugins/designmap`:
   `0.1.0 -> 0.1.1`, tarball `plugins/cc-dsh-designmap-0.1.1.tgz` (24 files),
   **sha256 `585fde54f0142abdfb2b6966268a00b9958f99b974a1b13ea7c4a7f9f090eade`**.
   Packed smoke: extracted tarball, `src/host.mjs` exported SVG from a temp workspace
   (`bytes 1476, nodes 2, edges 1`), exit 0.
3. **README** — `plugins/designmap/README.md` now documents package/files/deps, profile
   row, read-only vs edit split (panel reads `out/`; writes only via command), optional
   PNG, vision-loop drop, retirement/rollback, tools table (`designmap_export` format).
4. **Profile wiring** — kit `profile/cordis.patch.yml`: insert `id: designmap`
   (`dir: designmap`, `presets: [orchestrator]`), plus `- id: design-map ... disabled: true`
   override to retire 0.2.0. Patch parses (32 entries). `plugins/inventory.json`:
   new `designmap` row (`mounted: false`), old `design-map` row `mounted: false` + note;
   old tarball/source kept.
5. **Kit docs required by gates** — new package named in kit `README.md`, `USERGUIDE.md`,
   `rules/DEPLOYMENT.md` (check-documentation now **ok**).
6. **M4 report** — `docs/designmap/M4-EVIDENCE.md` (acceptance table, per-milestone
   evidence, wiring diff + dsh-doc bundle checklist, PNG, vision drop, unverified install,
   retirement plan).

## Remaining (small)

- Nothing code-wise; the only red is the pre-existing portability pair:
  `node scripts/check-portability.mjs` → **15/17**, failures
  `no-raw-path-in-dynamic-import` and `no-url-pathname-as-path` in
  `plugins/designmap/harness/vendor/dsh-client-modules.client.js`,
  `plugins/designmap/harness/serve.mjs`, `scripts/designmap-render-spike/**`
  (UX/M1 dev harness + old spike, outside M4 scope). Inventory/doc checks pass.
- Optional: final `task_note` and the orchestrator's acceptance.

## Exact next step

Read `docs/designmap/M4-EVIDENCE.md` §7 and accept the two portability failures as
out-of-scope (or delegate them to the harness owner), then mark M4 done. Do **not**
install/restart `:3080` — that is the human's call.

## Traps the next session would otherwise repeat

- `pack-plugin` writes the **only** tarball for the prefix; re-running after edits needs
  another version bump (`--version` or default patch) or it refuses. The sha changes.
- `check-portability` scans every `.mjs`/`.js` in the kit, including untracked
  `harness/` and `scripts/designmap-render-spike/`; its two remaining failures predate
  M4 (they were present before the pack — do not "fix" them by editing vendored bundles).
- `check-documentation` requires the new package name in **three** files: kit `README.md`,
  `USERGUIDE.md`, and `rules/DEPLOYMENT.md` (the "every mounted plugin" rule scans the
  patch's top-level `name:` rows even when `disabled: true` is present).
- The overlay suite is green only because `src/command.mjs` strips the transport `op`
  before `service.overlay`; the host allow-list in `src/host.mjs` must stay unchanged.
- `client.js` is a 479 KB prebuilt bundle owned by the UX child; do not edit it by hand.
