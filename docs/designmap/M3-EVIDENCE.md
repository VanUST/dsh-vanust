# M3 evidence — living doc: agent tools, manifest, stale detection, logs

Product-run evidence for the M3 host layer over the M0 core. Everything was run from
`/home/iustimov/dsh-kit/plugins/designmap` on node v24.20.0 with the pins from
`package.json` (elkjs 0.12.1, zod 4.6.7, yaml 2.9.1). The scene/overlay/index contract
is [SCENE-CONTRACT.md](SCENE-CONTRACT.md); the external API facts (defineTool shape,
tool/command names, `remote.commands.execute`, read-only `workspaceFiles`) are
[API-TESTS-CORE.md](API-TESTS-CORE.md) §4-§5.

Deliverables: `index.js` (Cordis plugin), `src/host.mjs` (status/scan/apply/render/
lint/open/export, manifest, JSONL logger), `src/tools.mjs` (seven tool definitions),
`src/command.mjs` (`/designmap`), `src/manifest.mjs`, `src/git.mjs`, `src/svg.mjs`,
`bin/living-doc.mjs`, `bin/tool-contract.mjs`, six new test files.

## 1. Test suite

```text
$ npm test
ℹ tests 79   ℹ pass 79   ℹ fail 0   [exit 0]
```

53 are the M0 core tests; 26 are the M3 host tests: tool schemas, status, scan, apply,
render/lint, export, logs and the living-doc loop. Each file carries a `PROOF:` header
naming the production path it protects.

## 2. Registration (fake Cordis ctx, real `defineTool`)

```text
$ node /tmp/m3-registration-probe.mjs      # imports index.js with dsh-tools resolvable
{
  "name": "designmap",
  "inject": ["tools", "commands"],
  "toolsForOrchestrator": ["designmap_apply","designmap_render","designmap_lint",
    "designmap_status","designmap_scan","designmap_open","designmap_export"],
  "toolsAfterOtherPreset": 7,
  "command": [{ "name": "designmap", "recordInput": false, "hasHandler": true }]
}
```

The `agent/created` gate registers all seven tools for an `orchestrator` agent and adds
nothing for a `backend` agent (7 before and after), so a specialist never receives the
write tools. The command is registered ungated — it is the human/panel path.

## 3. Tool schema (`node bin/tool-contract.mjs`, exit 0)

The **installed** `@deepseek-ai/dsh-tools` validator was used, i.e. the same code path
the host runs before `execute`:

```text
names: designmap_apply designmap_render designmap_lint designmap_status
       designmap_scan designmap_open designmap_export
dirty op violations:
  "ops[0].value.x" is not a declared property (additionalProperties: false)
  "ops[0].value.y" is not a declared property (additionalProperties: false)
  "ops[0].value.fill" is not a declared property (additionalProperties: false)
clean op violations: []
remove op violations: []
open without nodeId: ['missing required property "nodeId"']
```

The apply parameter schema is a closed object (`additionalProperties: false`) with a
superset of semantic fields and no `x`/`y`/`fill`/`stroke` property. A `oneOf` was
tried first and rejected during development: it collapses the same refusal into
`"ops[0]" must match exactly one oneOf branch`, losing the field name. The core zod
schema repeats the refusal with paths `["ops",0,"value","x"]` for direct callers.

## 4. The living-doc loop on a real edit (`node bin/living-doc.mjs`, exit 0)

A throw-away git repo is created with `designmap/` + two source files; one source file
is edited and one is added (nothing committed), then the whole cycle runs through the
real tool definitions:

```text
status (clean)          stale=false commitBehind=0
edit                    src/checkout/api.ts modified, src/billing/refund.ts added
status (stale)          stale=true commitBehind=0
                        staleNodes=[{id:"svc.checkout.api",source:"src/checkout/api.ts",reason:"source_changed"}]
scan                    proposedOps=[{kind:"node",action:"upsert",value:{
                          id:"src.billing.refund",type:"service",label:"Refund",
                          group:null,source:"src/billing/refund.ts"}}]
                        affectedNodes=["svc.checkout.api"]
                        model.yaml unchanged (scan never writes)
apply (confirmed)       applied=2 skipped=0, manifest nodes=3, commit=HEAD
apply again             applied=0 skipped=2 (idempotent, bytes unchanged)
status (clean)          stale=false staleNodes=[]
render                  index.json + v.context.scene.json, lint.ok=true, stale=false,
                        new node + edge present
lint                    all views ok
overlay                 overlays.json byte-identical; scene node svc.checkout.api at (40,30)
export                  designmap/out/v.context.svg, 2213 B, sha256:6b7c047c…
                        colours=["svc.checkout.api"], labels include "Checkout API","Orders DB","refund"
command (/designmap status)  kind=success, stale=false
logs                    11 tool.enter / 11 tool.exit, model.diff×3, layout.done×3,
                        merge.applied×3, lint.result×3, render.done×3
```

`--keep` was not used; the reported repo `/tmp/designmap-living-dfmkr7` still holds the
artifacts quoted below.

### manifest.json (written by apply)

```json
{ "schemaVersion": 1, "commit": "128f129ac0a25a3662b1dc1d43f82ffc5118b488",
  "generatedAt": "2026-11-16T11:06:44.101Z",
  "sourceHashes": {
    "db.orders": "sha256:94f8794d…",
    "src.billing.refund": "sha256:2251a54c…",
    "svc.checkout.api": "sha256:c2c28b0f…" } }
```

A node without `source` is absent. `writeManifest` compares `commit` + `sourceHashes`
(ignoring `generatedAt`) and skips the write when they match, which is what makes the
second apply leave every file byte-identical.

### logs/events.jsonl (excerpt)

```json
{"event":"tool.enter","tool":"designmap_apply","arguments":{"ops":[]}}
{"event":"model.diff","counts":{"added":0,"removed":0,"changed":0},…}
{"event":"tool.exit","tool":"designmap_apply","ok":true,"code":null,"ms":48.15}
{"event":"tool.enter","tool":"designmap_status","arguments":{}}
{"event":"tool.exit","tool":"designmap_status","ok":true,"code":null,"ms":25.18}
…
{"event":"render.done","viewId":"v.context","nodes":3,"edges":2,"groups":0,
 "bytes":1834,"sceneHash":"sha256:06c922b8…","ms":44.33}
{"event":"tool.enter","tool":"command","op":"status"}
{"event":"tool.exit","tool":"command","op":"status","ms":24.78}
```

Null-safety is proven by a seeded case in `test/host-log.test.mjs`: an event carrying
`undefined`, `NaN`, `Infinity`, `null` and a circular object is written as
`null`/`"[circular]"` and the line still parses.

## 5. SVG parses as XML and shows the overlay (`python3 xml.etree`)

```text
parsed root: {http://www.w3.org/2000/svg}svg viewBox 0 -32 392 200
nodes 3 edges 2
 node db.orders           212 8  #fef3c7 #d97706 'Orders DB'
 node src.billing.refund  212 84 #e0e7ff #4338ca 'Refund'
 node svc.checkout.api     40 30 #2563eb #4338ca 'Checkout API'   <- overlay x/y/fill/stroke
 edge e.api.db   'SQL / reads'
 edge e.api.refund 'refund'
overlay colour present: True
```

## 6. Acceptance mapping

| acceptance line | evidence |
|---|---|
| tool schema refuses a coordinate/colour field with a named error | §3, `test/host-tools.test.mjs` |
| idempotent re-apply → applied=0/skipped=N, files unchanged | §4 apply/apply again; `test/host-apply.test.mjs` byte comparison |
| status on a manifest commit behind HEAD → stale + affected nodes | `test/host-status.test.mjs` (commitBehind=1, staleNodes) |
| missing manifest → stale plus warning | `test/host-status.test.mjs`, `/designmap status` on a fresh repo |
| full loop on a real edit, every step in logs | §4; `test/host-loop.test.mjs` |
| export SVG reflects overlay positions/colours and parses | §5; `test/host-export.test.mjs` |
| log serialization survives null/undefined | §4 log paragraph; `test/host-log.test.mjs` |

## 7. Deviations, assumptions, unverified

- **Owner spec §5/§8/§9/§11 were not present as files in this workspace.** Tool names,
  parameters and the loop order come from this task brief and the initiative contract;
  §8's event names are exactly the M0 event vocabulary. `designmap_scan` derives
  proposals from paths (no AST, §11) and deliberately proposes **nodes only** — the
  connecting edge is the human/agent semantic decision, applied in the same confirmed
  batch in §4. If §5 names different parameters, `src/tools.mjs` is the one place.
- **Index row shape is M1's, not mine.** A sibling working M1 edited
  `src/index-file.mjs` during this task to `{viewId,title,level,direction,parent,
  scenePath,sceneHash,bytes}` sorted by `viewId`; the M3 render envelope and tests were
  aligned to it rather than reverted (shared tree rule). The README index example was
  corrected to match.
- **Tool registration is proven on a fake Cordis ctx, not the live host.** Installing
  into the `:3080` profile is out of scope; `index.js` imports
  `@deepseek-ai/dsh-tools` as the host provides it.
- **Overlay writes are M2.** `overlay.write` is in the log vocabulary but no M3 command
  writes `overlays.json`; the M3 loop proves overlays survive regeneration, not that the
  panel can create them yet.
- `designmap_scan` treats a deleted node with edges as `blocked` instead of inventing a
  remove-edge + remove-node batch: silent cascade deletion is worse than a refusal.
- A malformed `manifest.json` is treated as missing (status warns and reports every
  sourced node as stale); the loader does not crash the tool.
- Test/CLI helpers resolve the installed `dsh-tools` via `DSH_INSTALL`/`DSH_TOOLS` or
  the machine-local harness path; on a machine without the harness the schema test skips
  and `bin/tool-contract.mjs` fails loudly.

## 9. Overlay write path — closed by the orchestrator

The panel's only write path (`/designmap op:'overlay'`) was implemented but unproven when
the M3 session budget ran out. The orchestrator wrote `plugins/designmap/test/host-overlay.test.mjs`
(6 cases) and ran the suite: `npm test` **85/85 pass, exit 0** (79 + 6).

Covered, with the production path `command -> host.overlay -> workspace.writeOverlays`:

- upsert stores `x/y/fill/stroke`, a following `render` reports the stored position
  (node `svc.checkout.api` at 40,30), and the write touches neither `model.yaml` nor
  `out/`; `render` does not rewrite `overlays.json` (sha256 unchanged).
- a partial upsert merges (`{x:55}` keeps `y:20, fill:'#e0e7ff'`).
- `resetNode` removes exactly one row.
- `resetView` removes only the rows of the nodes on that view (two-view fixture:
  `v.svc` with `include: ["svc.*"]` removes the svc row and keeps `db.orders`).
- refused inputs keep `overlays.json` byte-identical and return a stable code:
  `unknown_node` (upsert and resetNode), `invalid_coordinate` (string x), `negative_coordinate`
  (y=-5), `colour_out_of_palette` (#123456), `invalid_overlay` (no keys, unknown action),
  `unknown_view` (resetView). NaN is refused at the service boundary (`invalid_coordinate`).
- `$version: 1` is written as the reserved key and no node row uses it.
- no `designmap_overlay` tool exists: `TOOL_SPECS` is exactly the seven agent tools, so the
  overlay path stays human-only (NFR-4).

Note for M2 (unchanged from the implementation): negative `x`/`y` is refused by design
(spec §6 lists negative overlay coordinates as invalid), so the panel must clamp a drag at
`0` instead of letting the write fail.

**Transport/domain split (fix round).** The host guard's allow-list
(`action,nodeId,viewId,row,x,y,fill,stroke`) refused the command's transport key `op`,
so every `/designmap op:'overlay'` was `model_fields_forbidden` (5 red tests).
`src/command.mjs` now builds an explicit overlay payload and uses `op` only for
dispatch/logging; `src/host.mjs` is unchanged and still refuses a model field passed
directly to the domain call (`service.overlay({action:'upsert',nodeId:'db.orders',type})`
→ `model_fields_forbidden: overlay cannot write model fields (type)`). Regression:
`test/host-command.test.mjs` “the overlay op forwards only visual fields; the domain
guard still refuses model fields”; suite **93/93 pass, exit 0**.
