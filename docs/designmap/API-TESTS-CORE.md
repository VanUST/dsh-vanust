# API tests for designmap v1 core — §12 fetch-first gate

Executed API proof for the four host-side APIs the redesign depends on: **elkjs**,
**zod 4**, **yaml**, and the **DSH tool/command transport**. This report is written
before any `designmap-core` feature code exists, so M0 is written against observed
behaviour instead of memory.

- Machine: `/home/iustimov/dsh-kit`, node **v24.20.0**, npm **11.19.0**, pnpm **10.18.0**.
- Installed harness read for the transport section:
  `/home/iustimov/.npm/node/lib/node_modules/@deepseek-ai/dsh` — package version
  **0.2.2-rc.3**.
- Spike package: [`scripts/designmap-api/`](../../scripts/designmap-api/) — its own
  `package.json`, local `node_modules`, five runnable scripts, no feature code.
- Method: every claim below comes from a command whose output is quoted. For ELK this
  matters twice over: **silence is not acceptance** — an unknown option id and an
  invalid enum value are both dropped without an error, so an option was counted as
  accepted only when the geometry changed in the direction the option promises.

Run everything:

```bash
cd scripts/designmap-api
npm install                                   # once; pins exact versions (see §5)
for f in elk-layout elk-options elk-browser zod-strict yaml-roundtrip; do node "$f.mjs"; done
```

All five scripts exit `0`. `out/*.log` holds the captured JSON of the last local run.

---

## 1. elkjs 0.12.1 — layout, determinism, interactive options, worker

### 1.1 Pinned install

```bash
$ cd scripts/designmap-api && npm install --no-audit --no-fund
added 3 packages in 6s
$ npm ls --depth=0
├── elkjs@0.12.1
├── yaml@2.9.1
└── zod@4.6.7
```

`package.json` pins all three exactly (`"elkjs": "0.12.1"`, no `^`).

### 1.2 Layout of a grouped graph with ported edges

Command: `node elk-layout.mjs out/elk-layout-a.json` → exit 0.
Input: `elk.algorithm=layered`, `elk.direction=RIGHT`,
`elk.hierarchyHandling=INCLUDE_CHILDREN`; `grp.checkout` is a group node containing
`svc.checkout.api` (two ports, `FIXED_SIDE`) and `svc.checkout.worker`; `db.orders`
sits outside the group. Both edges connect **ports**, and one edge crosses the group
boundary.

Observed geometry (from `out/elk-layout-a.log`):

```json
canvas: {"x":0,"y":0,"w":621,"h":119}
groups: [["root",0,0,621,119],["grp.checkout",8,8,412,103]]
nodes:  [["svc.checkout.api","grp.checkout",32,24,160,44],
         ["svc.checkout.worker","grp.checkout",228,24,160,44],
         ["db.orders","root",453,64,160,44]]
ports:  svc.checkout.api.in  {"x":-8,"y":18,"w":8,"h":8}
        svc.checkout.api.out {"x":160,"y":18,"w":8,"h":8}
edges:  e.api.worker start {x:200,y:46} end {x:220,y:46} bends [] fromPort svc.checkout.api.out toPort svc.checkout.worker.in
        e.api.db     start {x:208,y:54} end {x:445,y:86} bends [{x:218,y:54},{x:218,y:86}]
                     fromPort svc.checkout.api.out toPort db.orders.in
layoutMs: 140.08
```

**Determinism (FR-3 / NFR-1 / INV-IDEMPOTENT).** The same input was laid out twice
in one process and once more in a second process:

```text
rawJsonEqualAcrossRuns   : false
internalKeysInRawResult  : ["$H"]
projectedHashRun1        : 01097e83238e3c6d852c0ec933f23ed2a40bf2205a2e48294cffc8ee3f477ecf
projectedHashRun2        : 01097e83238e3c6d852c0ec933f23ed2a40bf2205a2e48294cffc8ee3f477ecf
projectedEqual           : true

$ sha256sum out/elk-layout-a.scene.json out/elk-layout-b.scene.json
83633f98e5ca1766a9bdd2976a846cc4dd7733bbdcca0c6f4fe7bf456fbfaad0  out/elk-layout-a.scene.json
83633f98e5ca1766a9bdd2976a846cc4dd7733bbdcca0c6f4fe7bf456fbfaad0  out/elk-layout-b.scene.json
```

**The one fact that changes M0:** the layout *geometry* is deterministic, but the raw
elkjs result object is **not** serializable as-is — every node and the graph itself
carry a GWT identity field `$H` whose value changes on every run (`13` vs `364` in the
same process). `designmap-core` must project only documented fields into the scene and
never `JSON.stringify(elkResult)`; the projection above is what produced
byte-identical scenes across two processes. Two further geometry facts fall out of the
same run: child coordinates are **relative to the parent group**
(`svc.checkout.api` at `(32,24)` inside `grp.checkout` at `(8,8)`), so flattening to
absolute scene coordinates needs an explicit offset; and ports are returned relative to
their node (`-8` / `160` on a 160-wide node).

### 1.3 The v1.1 interactive options named by the spec

Command: `node elk-options.mjs` → exit 0. The test first asks the installed package for
its own metadata (`elk.knownLayoutOptions()`, 243 entries; `elk.knownLayoutAlgorithms()`
includes `org.eclipse.elk.layered`), then runs a five-node diamond with and without
each candidate and compares geometry hashes.

Metadata from the installed package:

| id | in metadata | type | targets |
|---|---|---|---|
| `elk.layered.layeringStrategy` | **no** | — | — |
| `elk.layered.crossingMinimizationStrategy` | **no** | — | — |
| `elk.layered.layering.strategy` | yes | ENUM | PARENTS |
| `elk.layered.crossingMinimization.strategy` | yes | ENUM | PARENTS |
| `org.eclipse.elk.position` | yes | OBJECT | NODES, PORTS, LABELS |

Observed runs (`a@12,62 b@12,12 c@92,17 d@172,17` is the baseline):

```text
baseline (no interactive options)                              a@12,62 b@12,12 c@92,17 d@172,17   fde570db98b8ff72
spec keys layeringStrategy+crossingMinimizationStrategy=INTERACTIVE, node x/y given
                                                               a@12,62 b@12,12 c@92,17 d@172,17   fde570db98b8ff72
canonical layering.strategy=INTERACTIVE, node x/y given        a@92,38 b@12,12 c@172,17 d@252,17  57bfab294b53a38d
canonical layering.strategy=INTERACTIVE, NO node x/y           a@12,62 b@12,12 c@92,17 d@172,17   fde570db98b8ff72
canonical layering.strategy=BOGUS, node x/y given              a@12,62 b@12,12 c@92,17 d@172,17   fde570db98b8ff72
canonical crossingMinimization.strategy=INTERACTIVE            a@12,12 b@12,62 c@92,17 d@172,17   db672e17b415a790
layering INTERACTIVE + crossingMinimization INTERACTIVE        a@92,12 b@12,37 c@172,17 d@252,17  76b0d6f4ff8c3595
org.eclipse.elk.position as "x,y" strings, algorithm=fixed     a@400,0 b@0,50                    9108e0f8cdfd8538
org.eclipse.elk.position as {x,y} object, algorithm=fixed      ERROR java.lang.Error: Severe implementation error in the Json to ElkGraph importer.
org.eclipse.elk.position as "x,y" strings, algorithm=layered   a@12,62 b@12,12 db@92,62           01d7689b8ec4eae0
```

Verdicts:

- `elk.layered.layeringStrategy=INTERACTIVE` — **IGNORED**. The id is absent from the
  package's option metadata and the run is byte-equal to the baseline. The correct id
  is `elk.layered.layering.strategy`.
- `elk.layered.crossingMinimizationStrategy` — **IGNORED**, same evidence. Correct id:
  `elk.layered.crossingMinimization.strategy`.
- `elk.layered.layering.strategy=INTERACTIVE` — **ACCEPTED** (geometry moves `a` from
  layer 0 to layer 1), but only when every node carries an input `x`/`y`: without
  positions the run silently falls back to the baseline. This is consistent with the
  bundled source, where `InteractiveLayerer` reads `node.pos.x_0` from the input node
  (`node_modules/elkjs/lib/elk-worker.js:51515`), not a layout option.
- `elk.layered.crossingMinimization.strategy=INTERACTIVE` — **ACCEPTED**: it changes
  node order (`a`/`b` swap) on its own and changes the result again when combined with
  interactive layering.
- `org.eclipse.elk.position` — **KNOWN but not the interactive-layout input for
  layered**. It exists (OBJECT, for the fixed algorithm, whose own description says
  "used by the 'Fixed Layout' algorithm"), accepts the string form `"x,y"` (fixed
  layout honours it exactly: `a@400,0 b@0,50`), **throws** on the object form
  (`{x,y}`), and has no effect on layered layout.
- Control: an invalid enum value (`layering.strategy=BOGUS`) is **silently ignored**.
  Therefore "it did not throw" is never evidence of acceptance — only a geometry change
  is.

**The one fact that changes M0:** the spec's option names must be corrected to
`elk.layered.layering.strategy` / `elk.layered.crossingMinimization.strategy`, and
interactive layout needs the **previous render's node x/y fed back as input node
coordinates** (`org.eclipse.elk.position` will not do it). If M0 emits the spec's
spelling, the option is dropped and the layout silently reverts to NETWORK_SIMPLEX —
a failure that looks like success.

### 1.4 Browser / Web Worker constraint

Command: `node elk-browser.mjs` → exit 0. The installed package answers this itself:

```text
elk-api.js: worker is mandatory for the API-only entry
    43  throw new Error("Cannot construct an ELK without both 'workerUrl' and 'workerFactory'.");
    49  return new Worker(url);                    // workerUrl builds a browser Worker
main.js: Node entry installs an in-process fake worker
    54  if (!optionsClone.workerFactory) {
    55    var _require = require('./elk-worker.min.js'),
    56      _Worker = _require.Worker;
    57    optionsClone.workerFactory = function (url) {
main.js: web-worker package is optional, with a fallback
    49  console.warn("Web worker requested but 'web-worker' package not installed. ... Falling back to non-web worker version.");
```

Executed construction:

```text
apiOnlyEntry            : threw: Cannot construct an ELK without both 'workerUrl' and 'workerFactory'.
nodeEntry               : constructed without workerUrl/workerFactory
bundledEntryHasFakeWorker: true
```

So: **`elkjs/lib/elk-api.js` requires a worker; `elkjs` (the Node entry) and
`elkjs/lib/elk.bundled.js` install an in-process fake worker and need no Web Worker.**
In a browser you must either use `elk.bundled.js` in the main thread or pass
`workerUrl` to `elk-api.js`; the worker exists to keep the UI thread responsive, not
because the algorithm requires it. When layout stays **server-side in the DSH host**,
no Web Worker is needed — but layout then runs **synchronously on the host thread**:

```text
120-node graph: layoutMs 1408.16, longest event-loop tick gap 1407.04 ms, blockedTheThread true
25-node graph : layoutMs median 63.98 (runs 62.83 / 63.98 / 102.01)
```

**The one fact that changes M0:** no worker dependency is needed for server-side
layout, but a large view blocks the host event loop for the whole layout duration
(1.4 s at 120 nodes; ~64 ms at 25 nodes — inside the 1500 ms NFR-3 budget). If the host
must stay responsive for views above ~50 nodes, M0 needs `worker_threads` (or a node
cap) — this is a design decision, not an elkjs requirement.

---

## 2. zod 4.6.7 — strict objects and the geometry trap

Command: `node zod-strict.mjs` → exit 0. Schema under test: `z.strictObject` for the
`designmap_apply` op, with node and edge strict objects, then a dirty op that also
carries `x`, `y`, `fill`.

Observed:

```json
{
  "zod": "4.6.7",
  "api": {
    "strictObject": "function",
    "plainObjectStrictMethod": "function",
    "plainObjectPassthroughMethod": "function",
    "flatMapTopLevelError": "function",
    "treeifyError": "function"
  },
  "dotStrict": { "available": true, "behaviour": { "success": false,
    "issues": [{ "code": "unrecognized_keys", "path": [], "keys": ["x"] }] } },
  "strictRejectsGeometry": true,
  "cleanOpAccepted": true,
  "issues": [{
    "code": "unrecognized_keys",
    "path": ["nodes", 1],
    "message": "Unrecognized keys: \"x\", \"y\", \"fill\"",
    "keys": ["x", "y", "fill"],
    "pathLength": 2,
    "pathTypes": ["string", "number"]
  }],
  "plainObjectSilentlyStrips": { "success": true,
    "parsedKeys": ["id", "type", "label", "source"], "droppedCoordinates": true }
}
```

- Both spellings exist in 4.6.7: `z.strictObject({...})` and the older
  `z.object({...}).strict()`. Both reject with `code:"unrecognized_keys"`; the strict
  object form is the current one (`z.strictObject` is exported as a function).
- `safeParse` failure shape: `error.issues[]` with `code`, `path` (array of
  `string | number`, index included: `["nodes",1]`), `message`, and `keys` for
  `unrecognized_keys`. `z.flattenError` and `z.treeifyError` are both available for
  envelope formatting.

**The one fact that changes M0:** a **plain `z.object` silently strips** `x`/`y`/`fill`
(`success: true`, coordinates dropped). If `designmap-core` uses plain objects for the
op schema, INV-NO-GEO / FR-2 would be enforced only by the prompt — the exact failure
mode the redesign is fixing. Use `z.strictObject` (or `.strict()`) for every object in
the model and op schemas, and assert the rejected path in the M0 test.

---

## 3. yaml 2.9.1 — parse → validate → stringify

Command: `node yaml-roundtrip.mjs` → exit 0. Document shape: `schemaVersion`, `nodes`
(`id`, `type`, `label` including a two-line label, `source`), `edges`
(`id/from/to/kind/label`), `views` (`id/title/level/include/direction`) — the shape
described by the initiative contract (`docs/analysis/designmap-redesign.json`, FR-1,
D-MODEL) and `docs/designmap/SCENE-CONTRACT.md`. The spec's §4 text itself is not in
this repository; if §4 differs, the schema half of this test must be re-run (see
"Unverified").

Observed:

```json
{
  "yaml": "2.9.1",
  "validationOk": true,
  "parseResult": {
    "schemaVersion": 1, "nodeCount": 3, "edgeCount": 2, "viewCount": 1,
    "multilineLabelRaw": "\"Checkout API\\naccepts orders and reserves stock\"",
    "labelLineCount": 2,
    "keptBlockLabelRaw": "\"first line\\nsecond line\\n\"",
    "strippedBlockLabelRaw": "\"first line\\nsecond line\"",
    "keptBlockKeepsTrailingNewline": true
  },
  "emittedWithPinnedOptions": {
    "bytes": 735,
    "secondRoundTripBytesIdentical": true,
    "multilineLabelForm": "    label: |-"
  },
  "emittedWithDefaults": {
    "secondRoundTripBytesIdentical": true,
    "longLabelWrapped": true,
    "longLabelDefaultLines": 10,
    "longLabelPinnedLines": 9
  },
  "authoredToEmittedByteIdentical": false,
  "duplicateMapKeys": "threw: Map keys must be unique at line 5, column 1:"
}
```

- Parse → zod validate → stringify → parse → stringify is **byte-identical** when the
  emitter options are pinned and explicit (`lineWidth: 0, indent: 2,
  blockQuote: 'literal', defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN'`): the two
  passes hash to the same value (`e4dd34daba430c8f…`), and a multiline label is emitted
  as a `|-` block scalar.
- With **default** options the same document also round-trips stably, but the default
  80-column `lineWidth` **folds long scalars**: a 118-character label emitted as 10
  lines instead of 9. So formatting is stable *for a given yaml version + option set*,
  not stable across releases/defaults.
- A `|` block scalar keeps its trailing newline (`"first line\nsecond line\n"`), a
  `|-` does not. Labels are not paragraphs: core must normalise before validation or
  the scene carries a phantom line the label lint counts.
- Duplicate mapping keys throw (`uniqueKeys: true` is the default), so a duplicated
  `id` in a YAML mapping cannot pass silently.
- Human-authored text does **not** survive byte-identically: `authoredToEmittedByteIdentical:
  false` (flow-sequence `include: [svc.*, …]` is re-emitted as a block sequence).

**The one fact that changes M0:** byte-identical commits are achievable only for
**core-emitted** YAML (pinned options, canonical key order, `lineWidth: 0`), not for
human formatting. Apply must rewrite `model.yaml` in canonical form and the PR diff
must be judged on that canonical form; expecting a human's file to round-trip
unchanged would fail at the quote/indent level.

---

## 4. DSH transport (installed 0.2.2-rc.3)

### 4.1 `defineTool` contract

`defineTool` is `@deepseek-ai/dsh-tools/src/schema.ts:555`; its options interface is at
`:484`:

```ts
// dsh-tools/src/schema.ts:484
export interface DefineToolOptions<S extends ParameterSchemaSpec, O extends ValueSchemaSpec> {
  /** Tool name (must be unique). */
  readonly name: string
  /** Human-readable description sent to the model. */
  readonly description: string
  /** Per-property parameter schema compiled to an implicit open object root. */
  readonly parameters: S
  /** Canonical output schema plus pure Native and presentation projections. */
  readonly output: {
    readonly schema: O
    render(args: InferArgs<S>, value: InferValue<NoInfer<O>>): ContentBlock[]
    presentationMeta?(args, value): JsonValue
  }
  readonly deferLoading?: true
  readonly timeoutMs?: number
  isConcurrencySafe?(args: InferArgs<S>): boolean
  execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<NoInfer<O>>>
  …
}
```

It is **`parameters` + required `output.schema`/`output.render`**, not
`inputSchema`: no `inputSchema` field exists in this version. `defineTool` validates
arguments against the compiled schema before calling `execute` and throws
`ToolArgsError` (`INVALID_ARGS`) with path-qualified violations
(`schema.ts:461-475, 590-596`). The model-facing schema is exactly
`{ name, description, parameters }` (`dsh-llm/src/types.ts:517`; projection whitelists
those three, `dsh-tools/src/contracts.ts:66`).

Registration (`dsh-tools/src/index.ts:128-151`) additionally requires the output
declaration, a unique name per scope, and rejects the reserved PTC name:

```ts
if (output === undefined || … typeof output.render !== 'function')
  throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`)
if (name === RUN_CODE_NAME)
  throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the PTC mode presentation transport…`)
```

### 4.2 Per-agent registration (`agentPreset` gate)

The shipped 0.2.0 plugin registers its tool on the **orchestrator preset only**
(`plugins/design-map/index.js:1212-1224`), from an `agent/created` listener on the
host context; an unknown preset gets no tool (fail closed):

```js
export function registerForOrchestrator(ctx, tool) {
  ctx.on('agent/created', ({ agent }) => {
    if (agent?.session?.header?.agentPreset === 'orchestrator') agent.ctx.tools.register(tool)
  })
}
```

and the plugin declares both registries it needs (`index.js:89`):
`export const inject = ['tools', 'commands']`. The panel command is deliberately **not**
gated — it is the human path (`index.js:1290-1296`).

### 4.3 Tool-name constraints

`dsh-tools` itself enforces **no character or length pattern** on a native tool name in
`register()` — only uniqueness, the reserved `run_code` name, and the output
declaration (`dsh-tools/src/index.ts:128-151`). The **model-facing** name contract is
stated in `dsh-mcp-client/src/tools.ts:53-64` and applied to every MCP-derived name:

```ts
/** DeepSeek function-name contract: at most 64 characters. Wire-protocol constant … */
const MAX_PUBLIC_NAME_LENGTH = 64
/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g
```

So the safe native-tool alphabet is **`[A-Za-z0-9_-]`, ≤ 64 characters**; a dotted name
(`designmap.scan`) is outside the wire contract, a snake_case name
(`designmap_scan`, 14 chars) is inside it. DEC-NAMES' `designmap_scan/apply/render/…`
is therefore safe. (Provider-side rejection of a long/dotted native name was not
exercised — see §7.)

Command names are stricter and validated at registration
(`dsh-commands/src/index.ts:32,179-183`): `const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u`,
with a non-empty description and a function handler; `commands.register()` at `:285`.
The name excludes dots and uppercase, so `/designmap` or `/designmap-panel` is legal.

### 4.4 How the panel asks the host to do something

Three mechanisms exist; the current panel already uses the right one for writes:

1. **Command** — a registered `CommandDefinition`, executed without a model turn, and
   exposed to the client as a Remote service (`dsh-commands/src/index.ts:360`):
   ```ts
   @Remote
   async execute(agent: Agent, line: string, submittedAttachments: …, signal: AbortSignal):
     Promise<CommandExecution | undefined>
   ```
   It logs `command/run` / `command/done` lifecycle events, and its `CommandResult` is
   `{kind:'success'|'error', text?}` — a refusal is a value the panel can quote.
2. **Tool** — model-facing only, gated by `agentPreset` in 0.2.0; a panel must not
   depend on a tool it does not own.
3. **Remote service** — `@Remote` methods on host services, assembled into the client's
   `remote` namespace (`dsh-api-remotes/src/client/index.ts:8,200` imports
   `dsh-commands/remote` among the contributions). `workspaceFiles` is **read-only**:
   `read`, `readBytes`, `stat`, `list` are the only `@Remote` methods
   (`dsh-api-workspace-files/src/index.ts:246,271,304,317`); there is no write method.

The shipped panel calls the command through the injected remote service
(`plugins/design-map/client.js:113-121`, injection list at `:395`):

```js
const result = await remote.commands.execute(sessionId, `/design-map ${JSON.stringify(op)}`, [])
…
inject: ['slots', 'remote', 'remote.workspaceFiles', 'remote.commands', 'layout'],
```

**The mechanism the new panel should use:** a single `/designmap <json-op>` command
(same pattern as 0.2.0) for **render, open, export, and overlay writes**. Reasons, from
the sources above: a sandboxed Web frame cannot write the workspace, `workspaceFiles`
is read-only, and tools are model-facing and preset-gated. The command handler is the
host-side writer for `overlays.json` (debounced 500 ms from the renderer) and for
`out/*.scene.json`/SVG export; the agent tools (`designmap_scan` …) stay
`agentPreset`-scoped, exactly like `design_map` today. A separate Remote service is
possible but is a larger surface (a new contribution package) with no benefit for
v1.

---

## 5. Dependency shipping: real npm dependencies, not vendoring

Verified path: **pack the plugin with declared dependencies, install the tarball with
the kit's pinned pnpm, run it.** Scratch profile in `/tmp` — the live profile was not
touched.

```bash
$ npm pack --pack-destination /tmp/dsh-plugin-dep-test3        # spike package, deps elkjs/yaml/zod
$ cd /tmp/dsh-plugin-dep-test3/profile                          # empty package.json
$ corepack pnpm@10.18.0 add ../cc-dsh-designmap-api-spike-0.0.1.tgz --offline
Packages: +4
dependencies:
+ @cc/dsh-designmap-api-spike 0.0.1
Done in 1.3s using pnpm v10.18.0
$ ls node_modules/.pnpm
@cc+dsh-designmap-api-spike@file+..+cc-dsh-designmap-api-spike-0.0.1.tgz  elkjs@0.12.1  yaml@2.9.1  zod@4.6.7
```

The transitive dependencies are installed and resolvable from the installed package
(its `.pnpm/…/node_modules` carries `elkjs`, `yaml`, `zod` symlinks), and **all five
spike scripts run from the installed tarball**:

```text
installed elk-layout  exit=0
installed elk-options exit=0
installed elk-browser exit=0
installed zod-strict  exit=0
installed yaml-roundtrip exit=0
```

The kit's install path is `pnpm add <kit>/plugins/*.tgz` from
`$DSH_HOME/profiles/web` (`install.sh` step 4), i.e. the same mechanism, so a new
`@cc/dsh-designmap` plugin **can declare `elkjs`, `zod`, `yaml` as real
`dependencies`** and be installed from a tarball. What this costs and risks:

- the machine needs the npm registry at install/update time (this run hit
  `ECONNRESET` retries and took 72 s on a cold store; the offline rerun took 1.3 s);
- exact pins must stay exact — a `^` range would let a later install change layout
  bytes and break INV-IDEMPOTENT;
- `elkjs` is licensed **EPL-2.0 OR GPL-3.0-or-later** (its `package.json`); it is a
  separate installed dependency, not vendored code, but the plugin's licence file
  should say so. `yaml` is ISC, `zod` is MIT.
- pnpm's isolated layout means a script must not assume
  `./node_modules/<pkg>/package.json`; use package resolution (this spike now does, see
  `version.mjs`).

Vendoring is not required and would add ~1.4 MB of generated ELK JS to the plugin
tarball; the trade is offline install convenience vs. registry dependency. The kit's
existing install path already needs the registry for every plugin install.

**Superseded 2026-11-16 — the trade was decided the other way, on measurement.** "The
kit's install path already needs the registry for every plugin install" was the wrong
premise: every other kit plugin is dependency-free, so `pnpm add <tarballs>` installs from
disk alone (`profile/pnpm-workspace.yaml` pins `autoInstallPeers: false`, so the
`@deepseek-ai/*` peers resolve from the profile's shared `node_modules` and are never
fetched). Measured on the live profile: with `zod`/`yaml`/`elkjs` declared, `dsh web`
spent **1m22s** in pnpm retrying `ECONNRESET` and, when the retries ran out, failed the
install *after* `pnpm remove` had already dropped all 24 plugins — the profile was left
with no plugin set. The host half (`src/` + the three packages) is now bundled into
`dist/` by `build-client.mjs`, which costs ~750 KB in the tarball and buys a 1.9s,
registry-free install. §5's requirement that the packages stay exactly pinned still holds:
they are pinned in `devDependencies`, and the bundle is built from those pins.

---

## 6. Constraints for M0

1. **Correct the ELK option ids**: `elk.layered.layering.strategy` and
   `elk.layered.crossingMinimization.strategy`; the spec's
   `layeringStrategy`/`crossingMinimizationStrategy` spellings are dropped silently.
2. **Interactive layout needs input positions**: pass the previous scene's node `x`/`y`
   as input node coordinates; `org.eclipse.elk.position` is a fixed-layout option
   (string `"x,y"` only; object form throws) and does nothing for layered.
3. **Never serialize the raw elk result**: project documented fields and drop `$H`, or
   two identical renders produce different bytes.
4. **Flatten relative coordinates**: ELK child coordinates are parent-relative; ports
   are node-relative. The scene contract is absolute — offset explicitly.
5. **No Web Worker for server-side layout**, but layout blocks the host thread
   (120 nodes ≈ 1.4 s; 25 nodes ≈ 64 ms). Decide worker_threads or a node cap before
   large views appear.
6. **Use `z.strictObject` for every model/op object**: plain `z.object` strips
   `x`/`y`/`fill` and would make INV-NO-GEO unenforced. Assert the rejection path
   `["nodes", N]` + keys in the M0 schema test.
7. **Emit YAML canonically** with pinned options (`lineWidth: 0`, 2-space indent) and
   an explicit key order; normalise block-scalar labels (`|` keeps a trailing newline,
   `|-` does not) before validation. Byte-identical applies are a property of
   core-emitted YAML only.
8. **Tools**: `designmap_*` names must stay `[A-Za-z0-9_-]{1,64}`; `defineTool` needs
   `parameters` + `output.schema`/`output.render` + `execute`; gate agent tools by
   `agentPreset` (0.2.0 pattern) and keep the panel command ungated.
9. **Panel transport**: `/designmap <json-op>` command via
   `remote.commands.execute(sessionId, line, [])` for render/open/export/overlay
   writes; `workspaceFiles` is read-only and no tool may be required by the panel.
10. **Dependencies**: elkjs/zod/yaml as exact-pinned real dependencies install from a
    tarball via the kit's pnpm path; keep pins exact and note the elkjs EPL-2.0/GPL
    licence.

## 7. Not verified

- **Spec §4 text.** The model document shape used in §3 is assembled from
  `docs/analysis/designmap-redesign.json` (FR-1, D-MODEL) and
  `docs/designmap/SCENE-CONTRACT.md`; the literal §4 section was not in this workspace.
  If §4 names different fields, re-run `yaml-roundtrip.mjs` with that shape.
- **Provider-side rejection of an invalid native tool name.** The 64-char
  `[A-Za-z0-9_-]` contract is quoted from `dsh-mcp-client`; `dsh-tools` does not
  enforce it, and no live model call was made to see a provider reject a dotted or
  over-long name. Treat the contract as a budget, not as an observed refusal.
- **Browser run.** elkjs was exercised in Node only. The browser statement rests on the
  installed `elk-api.js`/`main.js`/`elk.bundled.js` sources and the package README; no
  page was served and no real Web Worker was started.
- **Layout at scale.** Only 25 and 120 nodes were measured, on this machine, once;
  NFR-3's 1500 ms includes merge + lint, which do not exist yet.
- **Install into the live profile.** Deliberately not done: the dependency test ran in
  `/tmp` scratch profiles. The live `:3080` profile and its lockfile are untouched.
- **@xyflow/react** (the renderer's chunk-loading API, FR-10's fifth surface) is outside
  this task's four APIs; it was not tested here.
