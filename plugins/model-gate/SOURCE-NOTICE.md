# `@deepseek-ai/dsh-model-gate` — kit-built plugin

## Read this before editing

**This plugin has NO upstream source in the public harness repository.** That is a
measured fact, not an assumption, and it is why this directory is not a read-only
snapshot of somebody else's tree.

Measured on 2026-09-30:

```
git ls-remote --tags https://github.com/deepseek-ai/deepseek-harness.git
  refs/tags/dsh-v0.1.5-rc.1  183f08e9c6dde7e36cd2318eaee70b0da08fb35e
  refs/tags/dsh-v0.2.0-rc.2  639ed015397290b3745d163aafe02ffee4aa3f84

raw …/183f08e9…/packages/host/model-gate/package.json    -> 404
raw …/183f08e9…/packages/host/webserver/package.json     -> 200  (control: the path scheme works)
raw …/dsh-v0.1.5-rc.1/packages/host/model-gate/package.json -> 404

A full clone at dsh-v0.2.0-rc.2 contains no file, directory or reference named
model-gate anywhere under packages/.
```

So the package is **owned by this kit**, not vendored from the harness. `src/index.ts`
is its authoring source and the kit is responsible for it.

## How the shipped artifact is produced

The plugin is compiled against the harness API, so it is built *inside* a harness
checkout at the tag this kit pins — the checkout supplies the toolchain and the
`@deepseek-ai/dsh-llm` / `@deepseek-ai/cordis` types the plugin compiles against.

```bash
# 1. A harness checkout at the pinned tag (the clone is not part of this kit)
git clone --depth 1 --branch dsh-v0.2.0-rc.2 \
  https://github.com/deepseek-ai/deepseek-harness.git ~/deepseek-harness
cd ~/deepseek-harness && corepack pnpm install

# 2. Recreate the package the upstream tree does not carry
mkdir -p packages/host/model-gate/src
cp <kit>/plugins/model-gate/src/index.ts   packages/host/model-gate/src/index.ts
cp <kit>/plugins/model-gate/tsconfig.json  packages/host/model-gate/tsconfig.json
cp <kit>/plugins/model-gate/README.md      packages/host/model-gate/README.md
cp <kit>/plugins/model-gate/package.json   packages/host/model-gate/package.json
#    …and add { "path": "./packages/host/model-gate" } to tsconfig.host.json references

# 3. Build. The root tsdown config imports a built artifact from the typert
#    generator, so that package must be compiled first, and package.json must be
#    written WITHOUT a byte-order mark (tsdown's workspace scan JSON.parses it).
corepack pnpm install --no-frozen-lockfile
node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b packages/host/model-gate
node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b packages/typert/generator
corepack pnpm exec tsdown --env.DSH_BUILD_FACE host --filter '@deepseek-ai/dsh-model-gate'

# 4. Pack into the kit
cd packages/host/model-gate
corepack pnpm pack --out <kit>/plugins/model-gate-<version>.tgz
```

`scripts/rebuild-plugins.sh` performs steps 1 and 3 for a kit whose `HARNESS_DIR`
already points at such a checkout.

| Fact | Value |
|---|---|
| Upstream repository | `https://github.com/deepseek-ai/deepseek-harness.git` |
| Upstream package path | none — the package does not exist upstream |
| Built against | tag `dsh-v0.2.0-rc.2` (commit `639ed015397290b3745d163aafe02ffee4aa3f84`) |
| Package version | `0.2.0-rc.2` |
| License | MIT (Copyright (c) 2026 DeepSeek); see the repository `NOTICE` |

## What is included

`src/index.ts` (the authoring source), `lib/index.js` and `lib/types/index.d.ts` (the
built output the tarball ships), `package.json`, `tsconfig.json` and `README.md`.
Excluded: `node_modules/` and `lib/tsconfig.tsbuildinfo` (a build cache).

Including `lib/` makes this a complete package rather than a shell: `main` and `types`
resolve, so it can be imported and packed with no build step. The `package.json`
dependencies use the harness workspace protocol (`workspace:^`), which resolves only
inside a harness checkout — `npm install` here will not resolve them, by design.

## Why `src/index.ts` did not change for 0.2.0

The port required no code change. The API it uses is unchanged in 0.2.0-rc.2:

```
packages/llm/llm/src/index.ts:96    export class LlmError extends HarnessError
packages/llm/llm/src/index.ts:75    'llm/stream'(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>)
packages/llm/llm/src/invariant.ts:88  ctx.on('llm/stream', (_o, next) => …, { global: true, prepend: true })
```

`GenerateOptions.model` is still a `string`, `LlmError` still takes `(message, code)`,
and that third line registers the hook exactly as this plugin does. The 0.2.0 rebuild
reproduced `lib/index.js` **byte-for-byte**. What actually changed is the peer range
that 0.2.0's startup enforcement now checks (`^0.2.0-rc.2`, not `^0.1.5-rc.1`).

## Refreshing for a new harness tag

1. Clone the harness at the tag the kit's installers pin, and `pnpm install`.
2. Recreate `packages/host/model-gate` as above; recompile `src/` against the new API
   and fix any type errors — a compile failure here is the signal that the port is no
   longer a no-op.
3. `tsc -b` the package and the typert generator, `tsdown` with the filter, pack.
4. Update the `Built against` row above and this kit's harness pin.
