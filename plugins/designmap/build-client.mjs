#!/usr/bin/env node
/**
 * Build both halves of @cc/dsh-designmap.
 *
 *   node build-client.mjs                # both halves
 *   node build-client.mjs --host-only    # dist/ only (no shell bundle on this machine)
 *   node build-client.mjs --client-only  # client.js + static harness only
 *
 * Output — host half (shipped, ESM):
 *   dist/index.mjs      Cordis plugin entry (`main` / `exports["."]`) with `src/` and the
 *                       pinned zod, yaml and elkjs INLINED
 *   dist/core.mjs       the library surface (`exports["./core"]`)
 *   dist/schema.mjs     `exports["./schema"]`
 *   dist/workspace.mjs  `exports["./workspace"]`
 *   dist/chunk-*.mjs    code shared between the four entries (esbuild splitting, so zod,
 *                       yaml and elkjs appear once, not four times)
 *
 * Output — client half:
 *   client.js                          harness client-module bundle (committed)
 *   harness/seed.js                    static-harness stand-in for the shell seed table
 *   harness/vendor/dsh-client-modules.client.js  byte copy of the installed real loader
 *
 * WHY THE HOST HALF IS BUNDLED
 *   The kit installs plugin tarballs with `pnpm add` on every boot that finds a changed
 *   set, and `profile/pnpm-workspace.yaml` pins `autoInstallPeers: false` — so a plugin
 *   with real `dependencies` is the only thing in the kit that makes a boot talk to the
 *   npm registry. Measured 2026-11-16: with `zod`/`yaml`/`elkjs` declared, `dsh web`
 *   spent 1m22s in pnpm (ECONNRESET retries) and, when the retries ran out, failed the
 *   install AFTER `pnpm remove` had already dropped all 24 plugins - leaving the profile
 *   with no plugin set at all. Bundling keeps the kit's invariant: a boot installs from
 *   tarballs on disk and needs no network.
 *
 * The wrapper is the load-bearing part of the client half: esbuild emits a CJS body whose
 * `require("react")` must resolve against the DSH module table at materialization, so the
 * body lives inside the factory the loader hands its own `require` to.
 *
 * The other load-bearing part is the `createRequire` banner on the host half: `yaml` and
 * `elkjs` are CJS and reach `require("process")` at module scope. Bundled into ESM that
 * call compiles to esbuild's `__require` shim, whose fallback throws `Dynamic require of
 * "process" is not supported` — the bundle would import fine and die on the first YAML
 * parse. A real `require` in module scope makes the shim call through instead.
 */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = '@cc/dsh-designmap'
const DSH_MODULES_CLIENT =
  '/home/iustimov/.npm/node/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js'
const EXTERNAL = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime']

/**
 * Host-half entries. Each one becomes a file under `dist/`, and `package.json`
 * `exports` names the same four, so the shipped package has no path a consumer can
 * follow into unbundled `src/`.
 */
const HOST_ENTRIES = [
  { in: join(HERE, 'index.js'), out: 'index' },
  { in: join(HERE, 'src', 'index.mjs'), out: 'core' },
  { in: join(HERE, 'src', 'schema.mjs'), out: 'schema' },
  { in: join(HERE, 'src', 'workspace.mjs'), out: 'workspace' },
]

/**
 * What stays a bare import in `dist/`: the two packages the harness itself provides to
 * every plugin (declared in `peerDependencies`, resolved from the profile's shared
 * `node_modules`). `web-worker` is elkjs's optional worker backend: it is required inside
 * a try/catch and the plugin never passes `workerUrl`, so leaving it unresolved keeps the
 * inline `elk-worker.min.js` path, which is the one a synchronous layout uses.
 */
const HOST_EXTERNAL = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', 'web-worker']

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`

async function buildSeed() {
  const result = await build({
    entryPoints: [join(HERE, 'harness/seed-src.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    write: false,
    minify: false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const text = result.outputFiles[0].text
  await writeFile(join(HERE, 'harness/seed.js'), text)
  return Buffer.byteLength(text)
}

async function buildClient() {
  const result = await build({
    entryPoints: [join(HERE, 'client/entry.jsx')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: ['chrome120'],
    external: EXTERNAL,
    loader: { '.css': 'text', '.js': 'jsx', '.jsx': 'jsx' },
    jsx: 'automatic',
    jsxImportSource: 'react',
    write: false,
    minify: false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const body = result.outputFiles[0].text
  const wrapped = `/* ${PKG} client bundle — generated by build-client.mjs; do not edit. */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PKG)},
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  },
});
`
  await writeFile(join(HERE, 'client.js'), wrapped)
  return { body: Buffer.byteLength(body), wrapped: Buffer.byteLength(wrapped) }
}

/**
 * Bundle the host half into `dist/`.
 *
 * `splitting` is what keeps the three vendored packages to one copy: `index`, `core`,
 * `schema` and `workspace` all reach zod (and two of them reach yaml and elkjs), so
 * without it each entry would carry its own 1.6 MB copy of the ELK engine. The chunk
 * filenames carry a content hash, so a stale chunk from an earlier build cannot be
 * picked up by a path that is now unused — and `dist/` is wiped first anyway.
 */
async function buildHost() {
  const outdir = join(HERE, 'dist')
  await rm(outdir, { recursive: true, force: true })
  const result = await build({
    entryPoints: HOST_ENTRIES,
    outdir,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    external: HOST_EXTERNAL,
    chunkNames: 'chunk-[hash]',
    outExtension: { '.js': '.mjs' },
    banner: {
      js: "import { createRequire as __designmapCreateRequire } from 'node:module';const require = __designmapCreateRequire(import.meta.url);",
    },
    write: false,
    minify: false,
    legalComments: 'none',
  })
  const files = []
  for (const file of result.outputFiles) {
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, file.text)
    files.push([relative(HERE, file.path), Buffer.byteLength(file.text)])
  }
  files.sort(([left], [right]) => left.localeCompare(right))
  return { files, bytes: files.reduce((total, [, size]) => total + size, 0) }
}

async function main() {
  const modes = process.argv.slice(2)
  const wantHost = !modes.includes('--client-only')
  const wantClient = !modes.includes('--host-only')

  let host
  if (wantHost) {
    host = await buildHost()
    console.log('dist/ host bundle', kb(host.bytes))
    for (const [name, size] of host.files) console.log(' ', name, kb(size))
  }

  if (!wantClient) return

  await mkdir(join(HERE, 'harness/vendor'), { recursive: true })

  const client = await buildClient()
  const seed = await buildSeed()

  const loaderSource = await readFile(DSH_MODULES_CLIENT)
  await copyFile(DSH_MODULES_CLIENT, join(HERE, 'harness/vendor/dsh-client-modules.client.js'))
  const loaderHash = createHash('sha256').update(loaderSource).digest('hex')

  const manifest = {
    builtAt: new Date().toISOString(),
    esbuild: (await import('esbuild/package.json', { with: { type: 'json' } })).default.version,
    xyflow: (await import('@xyflow/react/package.json', { with: { type: 'json' } })).default.version,
    react: (await import('react/package.json', { with: { type: 'json' } })).default.version,
    external: EXTERNAL,
    hostExternal: HOST_EXTERNAL,
    sizes: { clientCjs: client.body, clientBundle: client.wrapped, seedBundle: seed, ...(host ? { hostBundle: host.bytes } : {}) },
    hostFiles: host?.files ?? null,
    vendoredLoader: { sha256: loaderHash, bytes: loaderSource.byteLength },
  }
  await writeFile(join(HERE, 'harness/build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log('esbuild', manifest.esbuild, '· @xyflow/react', manifest.xyflow, '· react', manifest.react)
  console.log('client.js', kb(client.wrapped), '(CJS body', kb(client.body) + ')')
  console.log('seed.js', kb(seed))
  console.log('loader', kb(loaderSource.byteLength), 'sha256', loaderHash.slice(0, 16) + '…')
}

await main()
