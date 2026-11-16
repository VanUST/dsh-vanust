# designmap renderer spike — @xyflow/react inside the DSH client-module format

Fetch-first API proof for the designmap M1 renderer. No feature code: this spike renders a
3-node / 2-labelled-edge scene from `src/scene.json`, proves controlled drag deltas, fit and
pan/zoom in a real browser, and runs on the **real** `@deepseek-ai/dsh-client-modules` loader.

Findings: [`docs/designmap/API-TESTS-RENDER.md`](../../docs/designmap/API-TESTS-RENDER.md).

## Run

```bash
cd scripts/designmap-render-spike
npm install                    # @xyflow/react 12.12.1, react 18.3.1, esbuild 0.25.12
node build.mjs                 # writes public/ (gitignored)
node serve.mjs                 # http://127.0.0.1:4319/
```

`node serve.mjs` prints every request; no CDN is used. `/bare.html` is the negative control:
the same panel built with `@xyflow/react` external, which the loader must refuse.

## Shape

```
src/panel.jsx   factory body: React + @xyflow/react, scene → nodes/edges, test bridge
src/seed.js     stand-in for the shell's static table (react/react-dom/jsx-runtime)
src/scene.json  3 nodes, 2 labelled edges, contract-shaped (x/y/w/h, points, labelAt)
build.mjs       esbuild → CJS body wrapped in window.__ModuleLoader__.load({id,factory})
serve.mjs       static server
public/         generated: seed.js, bundle/client[.bare].js, vendor/dsh-client-modules.client.js
```

The real loader (`public/vendor/dsh-client-modules.client.js`) is copied from the installed
dsh by `build.mjs`; its sha256 is recorded in `public/build-manifest.json`.

`window.__SPIKE_TEST__` is the browser test bridge: `getNodes`, `getEdges`, `getDeltas`,
`getPatches`, `getViewport`, `getFit`, `getNodeRects`, `getPaneRect`.
