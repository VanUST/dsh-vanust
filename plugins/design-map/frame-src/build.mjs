/**
 * Build the vendored Excalidraw frame.
 *
 * INPUTS
 *   entry.js, plus the packages in this directory's devDependencies. When the
 *   dependencies live elsewhere, point the build at them:
 *     FRAME_NODE_MODULES=/path/to/node_modules \
 *     ESBUILD_MODULE=/path/to/node_modules/esbuild/lib/main.js node build.mjs
 *
 * OUTPUTS
 *   ../client.frame.js — one IIFE that injects Excalidraw's CSS (fonts inlined as
 *   data URLs) and mounts the editor. The panel fetches this file as a package-local
 *   chunk and puts it in an iframe srcdoc, so the frame needs no network and no CDN.
 *
 * WHY THE TWO STUBS
 *   Excalidraw's package statically maps ~50 locales and dynamically imports Mermaid
 *   for its import dialog. Bundling all of it costs ~6.5 MB; this workshop only needs
 *   English and never opens the Mermaid dialog, so both are replaced with minimal
 *   modules. That takes the frame from 8.4 MB to ~3 MB, still a real Excalidraw.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..', 'client.frame.js')
const nodePaths = process.env.FRAME_NODE_MODULES === undefined ? [] : [resolve(process.env.FRAME_NODE_MODULES)]
const esbuildModule = process.env.ESBUILD_MODULE ?? 'esbuild'
// esbuild's main entry is CommonJS; requiring it avoids a dynamic import of a
// variable path, which this kit's portability gate (rightly) refuses.
const { build } = createRequire(import.meta.url)(esbuildModule)

const stubs = {
  name: 'design-map-stubs',
  setup(builder) {
    // Mermaid import dialog: never opened by this editor.
    builder.onResolve({ filter: /^@excalidraw\/mermaid-to-excalidraw$/ }, () => ({ path: 'mermaid', namespace: 'stub' }))
    // Locales: keep English, drop the other ~49 translation bundles.
    builder.onResolve({ filter: /locales\/[^/]+\.js$/ }, (args) => {
      const name = args.path.split('/').pop()
      return name !== undefined && name.startsWith('en-') ? undefined : { path: args.path, namespace: 'locale-stub' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export async function parseMermaidToExcalidraw(){throw new Error("mermaid is not bundled in the design-map frame")}\nexport default { parseMermaidToExcalidraw }\n',
      loader: 'js',
    }))
    builder.onLoad({ filter: /.*/, namespace: 'locale-stub' }, () => ({ contents: 'export default {}\n', loader: 'js' }))
  },
}

const result = await build({
  entryPoints: [join(HERE, 'entry.js')],
  bundle: true,
  write: false,
  outdir: HERE,
  format: 'iife',
  minify: true,
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl' },
  nodePaths,
  plugins: [stubs],
  logLevel: 'warning',
})

const js = result.outputFiles.find((file) => file.path.endsWith('.js'))
const css = result.outputFiles.find((file) => file.path.endsWith('.css'))
if (js === undefined || css === undefined) throw new Error('esbuild produced no JS/CSS output')
// The style element must exist before Excalidraw mounts; the bundle is appended after it.
const wrapper = `(function(){var style=document.createElement('style');style.setAttribute('data-design-map','frame');style.textContent=${JSON.stringify(css.text)};document.head.appendChild(style);})();\n`
writeFileSync(OUT, `${wrapper}${js.text}\n`, 'utf8')
process.stdout.write(`design-map frame: ${(Buffer.byteLength(js.text) + Buffer.byteLength(css.text)) / 1e6} MB -> ${OUT}\n`)
