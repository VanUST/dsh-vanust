> **Историческая запись (design-map v1).** v1 удалён в P3 2026-11-24: файлы модели, сцена-контракт и семь инструментов `designmap_*` больше не существуют; имена ниже — история, не инструкция. Актуальное описание — `docs/DESIGNMAP-V2.md`.

# M3 handoff (session budget reached mid-step)

## Done and proven

- M3 host plugin over M0 core: `index.js` (tools + `/designmap` command),
  `src/host.mjs` (status/scan/apply/render/lint/open/export, manifest, JSONL logger),
  `src/tools.mjs` (7 tools), `src/command.mjs`, `src/manifest.mjs`, `src/git.mjs`,
  `src/svg.mjs`, `bin/living-doc.mjs`, `bin/tool-contract.mjs`.
- Proof commands (all green at 14:08):
  - `npm test` → 79/79 pass, exit 0 (53 M0 + 26 M3; six `test/host-*.test.mjs` files).
  - `node bin/living-doc.mjs` → exit 0, `ok:true`, all 31 checks; loop
    status(stale) → scan(proposal) → apply(2) → re-apply(0/2) → render(lint clean)
    → lint → export(overlay x/y/fill in SVG); logs contain tool.enter/exit, model.diff,
    layout.done, merge.applied, lint.result, render.done.
  - `node bin/tool-contract.mjs` → exit 0; installed `@deepseek-ai/dsh-tools` validator
    names `ops[0].value.x|y|fill` as undeclared; clean/remove ops pass.
  - Registration fake-ctx probe: 7 tools for `orchestrator`, none added for `backend`,
    command `designmap` registered.
- Evidence doc: [M3-EVIDENCE.md](M3-EVIDENCE.md) (including the M1 index-shape
  alignment note). M0 acceptance still green; demo scene hash unchanged
  `sha256:2c5fa9e8…`.

## In flight at the cutoff

The orchestrator's 10:46 task note adds two requirements to M3:

1. **`out/index.json`** — implemented (M1 sibling owns the row shape:
   `{viewId,title,level,direction,parent,scenePath,sceneHash,bytes}` + model/views/
   overlays hashes, sorted, no timestamp). **Still to do:** add the index section to
   `docs/designmap/SCENE-CONTRACT.md` as a CT-SCENE contract extension (orchestrator
   asked for it in the same change) and flag the extension in the final report.
2. **Overlay write path** — `/designmap {op:'overlay', action:'upsert'|'resetNode'|
   'resetView', nodeId?, x?, y?, fill?, stroke?, viewId?}`.
   - `src/host.mjs overlay()` is written: validates node existence, finite/non-negative
     x/y, palette colours; `workspace.writeOverlays()` writes `$version` first with
     sorted ids; logs `overlay.write`; resetNode/resetView supported.
   - `src/command.mjs` dispatches `op:'overlay'` (OPS list + case).
   - **Not yet done:** tests (`test/host-overlay.test.mjs`), and re-running the full
     proof after adding them. `node --test test/host-command.test.mjs
     test/host-loop.test.mjs` passes with the new code loaded, so the wiring does not
     break the loop.

## Exact next step

Write `test/host-overlay.test.mjs` (with the `PROOF:` header this deployment requires)
covering: upsert writes x/y/fill/stroke and render reflects them; partial upsert merges;
`resetNode` deletes one row; `resetView` deletes only that view's node rows; unknown
node / NaN / negative coordinate / out-of-palette colour are `DesignmapRefusal` values
with codes `unknown_node`, `invalid_coordinate`, `negative_coordinate`,
`colour_out_of_palette` and leave `overlays.json` bytes unchanged; and that no
`designmap_overlay` tool exists (only the command may write overlays). Then run
`npm test`, `node bin/living-doc.mjs`, `node bin/tool-contract.mjs`, and append the
overlay evidence to M3-EVIDENCE.md + `docs/designmap/SCENE-CONTRACT.md` index section.

## Traps for the next session

- **Shared tree:** an M1 sibling is editing `src/index-file.mjs`, `test/index.test.mjs`,
  `client.js`, `build-client.mjs`, `package.json`. Do not revert their index-row shape;
  align to `{viewId, parent, …}`. Re-read a file before editing it.
- `plugins/designmap/index.js` imports bare `@deepseek-ai/dsh-tools`; importing it
  locally needs a temporary `node_modules/@deepseek-ai/dsh-tools` symlink to the
  installed harness (the registration probe did this, then removed it). The tools tests
  resolve it via `test/host-helpers.mjs loadDshTools()`.
- Tests create real git repos in `mkdtemp`; `git diff` hides untracked files, which is
  why `src/git.mjs diffNameStatus` appends `git ls-files --others --exclude-standard`.
- `designmap_apply`'s tool schema is intentionally ONE closed object (superset of
  semantic fields), not a `oneOf`: a `oneOf` loses the field name in violations.
- The scene contract's `edges[].points` re-anchoring after overlay moves lives in
  `src/overlays.mjs reattachEdges`; export uses the merged scene plus
  `merge.colours`.
- Nothing was installed into the live `:3080` profile; keep it that way unless asked.
