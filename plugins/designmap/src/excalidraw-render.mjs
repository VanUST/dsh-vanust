/**
 * The one renderer: Excalidraw itself, in headless Chromium.
 *
 * WHY. The owner's decision (D-EXCALIDRAW-RENDERS) is that the drawing is produced by
 * Excalidraw and nothing else: a writer of ours drifts from the canvas in font, arrowheads and
 * text wrapping, and a second renderer is a second truth. This module boots the SAME vendored
 * bundle the panel ships (client.frame.js), feeds it the page's elements, and asks Excalidraw
 * for the picture.
 *
 * THE EXPORT IS EXCALIDRAW'S. The bundle exposes no export function to its host (its imperative
 * API has no exportToBlob/exportToSvg in this build), so the two artifacts are taken from the
 * editor itself:
 *   - PNG: a screenshot of Excalidraw's own canvas element, after the page is laid out;
 *   - SVG: Excalidraw's own "Export image" dialog, whose SVG button saves Excalidraw's SVG.
 * The vendored glue disables that dialog (UIOptions.canvasActions.export: false), so the copy
 * of the bundle this module injects is the SAME bytes with that one switch turned on - the
 * file in the repository is not touched, and nothing here draws a shape by hand.
 *
 * NO BROWSER, NO PICTURE. When playwright-core, a Chromium binary or the bundle is missing the
 * call refuses with `renderer_unavailable` and the reason; it never falls back to a writer of
 * ours, because that is the thing this module replaced.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FrameBundleMismatch, patchExportSwitch } from '../client/bundle-patch.js'
import { MapRefusal } from './pages.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_DIR = resolve(HERE, '..')
export const FRAME_FILE = join(PLUGIN_DIR, 'client.frame.js')
const PADDING = 24
const MIN_VIEWPORT = { width: 320, height: 200 }
const MAX_VIEWPORT = { width: 2400, height: 2400 }
export const DEVICE_SCALE = 2

/**
 * The page's own bounds: the extent of everything that will be drawn.
 *
 * WHY IT IS COMPUTED HERE. The capture used to be a fixed viewport, so a page taller than it
 * was cut off (the imported system page is ~1160 px against a 700 px capture). A bound text is
 * its own element with its own x/y/width/height, and an arrow's points are relative to its x/y,
 * so both must be folded in or the picture clips a label or an arrowhead. Deleted elements are
 * not drawn and are not part of the picture.
 *
 * @returns `{ x, y, width, height, empty }`.
 */
export function pageBounds(elements) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const note = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const element of Array.isArray(elements) ? elements : []) {
    if (element === null || typeof element !== 'object' || element.isDeleted === true) continue
    if (element.type === 'arrow') {
      note(element.x, element.y)
      for (const point of Array.isArray(element.points) ? element.points : []) note(element.x + point[0], element.y + point[1])
      continue
    }
    note(element.x, element.y)
    note(element.x + (element.width ?? 0), element.y + (element.height ?? 0))
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0, empty: true }
  const width = Math.ceil(maxX - minX)
  const height = Math.ceil(maxY - minY)
  return { x: Math.floor(minX), y: Math.floor(minY), width, height, empty: width <= 0 || height <= 0 }
}

/**
 * The view Excalidraw must be in for the whole page to be inside the capture.
 *
 * Excalidraw maps a scene point to the screen as `(point + scroll) * zoom`, so a framed page is
 * a zoom that fits `bounds + padding` into the viewport and a scroll that centres it. The
 * viewport is the page's own size plus padding (clamped), which keeps the picture tight instead
 * of padding a small page into a 1000x700 box.
 *
 * @returns `{ bounds, viewport, zoom, scrollX, scrollY, empty }`.
 */
export function frameFor(bounds, { padding = PADDING } = {}) {
  const empty = bounds === null || typeof bounds !== 'object' || bounds.empty === true || bounds.width <= 0 || bounds.height <= 0
  if (empty) {
    return { bounds: { x: 0, y: 0, width: 0, height: 0, empty: true }, viewport: { ...MIN_VIEWPORT }, zoom: 1, scrollX: 0, scrollY: 0, empty: true }
  }
  const wanted = { width: bounds.width + padding * 2, height: bounds.height + padding * 2 }
  const viewport = {
    width: Math.min(MAX_VIEWPORT.width, Math.max(MIN_VIEWPORT.width, Math.ceil(wanted.width))),
    height: Math.min(MAX_VIEWPORT.height, Math.max(MIN_VIEWPORT.height, Math.ceil(wanted.height))),
  }
  const zoom = Math.max(0.05, Math.min(1.5, Math.min(viewport.width / wanted.width, viewport.height / wanted.height)))
  const centreX = bounds.x + bounds.width / 2
  const centreY = bounds.y + bounds.height / 2
  return {
    bounds,
    viewport,
    zoom,
    scrollX: viewport.width / (2 * zoom) - centreX,
    scrollY: viewport.height / (2 * zoom) - centreY,
    empty: false,
  }
}

/** playwright-core: the plugin's own dependency if it has one, else the kit's .tools copy. */
async function loadPlaywright() {
  try {
    return await import('playwright-core')
  } catch {
    // Not installed beside the plugin: the kit provisions it for its drivers.
  }
  const candidates = [
    join(PLUGIN_DIR, '..', '..', '.tools', 'node_modules', 'playwright-core', 'index.mjs'),
    join(homedir(), 'dsh-kit', '.tools', 'node_modules', 'playwright-core', 'index.mjs'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      return await import(pathToFileURL(candidate).href)
    } catch {
      // Try the next location rather than reporting a false "no playwright".
    }
  }
  return null
}

/** The Chromium binary: an explicit override, else the newest the kit's cache holds. */
export function chromiumBinary() {
  const override = process.env.DESIGNMAP_CHROMIUM
  if (typeof override === 'string' && override !== '' && existsSync(override)) return override
  const root = join(homedir(), '.cache', 'ms-playwright')
  if (!existsSync(root)) return null
  const candidates = []
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium-')) continue
    const binary = join(root, entry, 'chrome-linux64', 'chrome')
    if (existsSync(binary)) candidates.push({ binary, order: Number(entry.split('-')[1]) || 0 })
  }
  candidates.sort((left, right) => right.order - left.order)
  return candidates.length === 0 ? null : candidates[0].binary
}

/** The vendored bundle with Excalidraw's export dialog switched on (in memory only). */
function patchedFrame() {
  const text = readFileSync(FRAME_FILE, 'utf8')
  try {
    return patchExportSwitch(text)
  } catch (error) {
    if (error instanceof FrameBundleMismatch) {
      throw new MapRefusal('renderer_unavailable', `${FRAME_FILE} is not the vendored Excalidraw frame this exporter expects: ${error.message}`)
    }
    throw error
  }
}

/**
 * Render one page's elements to <outDir>/<page>.png and .svg.
 *
 * @returns `{ png, svg, width, height, elements, renderer }` - absolute paths and byte sizes,
 *   the canvas size, the element count, and the renderer name (always "excalidraw").
 *   `svg` carries `{ path, bytes, reason }` so a failed SVG export is named, not hidden.
 */
export async function renderWithExcalidraw(elements, outDir, page, { timeoutMs = 90000 } = {}) {
  if (!Array.isArray(elements)) {
    throw new MapRefusal('renderer_unavailable', 'a render needs the page elements')
  }
  const playwright = await loadPlaywright()
  if (playwright === null) {
    throw new MapRefusal('renderer_unavailable', 'playwright-core is not installed (looked beside the plugin and in <kit>/.tools/node_modules)')
  }
  const executablePath = chromiumBinary()
  if (executablePath === null) {
    throw new MapRefusal('renderer_unavailable', 'no Chromium binary in ~/.cache/ms-playwright (set DESIGNMAP_CHROMIUM)')
  }
  if (!existsSync(FRAME_FILE)) {
    throw new MapRefusal('renderer_unavailable', `the vendored Excalidraw bundle is missing: ${FRAME_FILE}`)
  }
  const bundle = patchedFrame()
  let browser
  try {
    browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  } catch (error) {
    throw new MapRefusal('renderer_unavailable', `Chromium did not launch: ${error?.message ?? error}`)
  }
  try {
    const framed = frameFor(pageBounds(elements))
    const context = await browser.newContext({ viewport: framed.viewport, deviceScaleFactor: DEVICE_SCALE, acceptDownloads: true })
    const tab = await context.newPage()
    await tab.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0;background:#ffffff}</style></head><body><div id="root"></div></body></html>')
    await tab.addScriptTag({ content: bundle })
    await tab.waitForFunction(() => document.querySelectorAll('canvas').length > 0, null, { timeout: timeoutMs })
    // The SAME knobs the panel would set: zoom and scroll are what frame the page.
    await tab.evaluate((scene) => {
      window.postMessage({ source: 'design-map-panel', type: 'load', scene }, '*')
    }, {
      elements,
      appState: {
        viewBackgroundColor: '#ffffff',
        gridSize: null,
        zoom: { value: framed.zoom },
        scrollX: framed.scrollX,
        scrollY: framed.scrollY,
      },
    })
    await tab.waitForTimeout(1800)

    mkdirSync(outDir, { recursive: true })
    const pngPath = join(outDir, `${page}.png`)
    const canvas = tab.locator('.excalidraw canvas').first()
    const box = await canvas.boundingBox()
    if (box === null) throw new MapRefusal('renderer_unavailable', 'Excalidraw rendered no canvas to capture')
    await canvas.screenshot({ path: pngPath })
    const png = {
      path: pngPath,
      bytes: statSync(pngPath).size,
      width: Math.round(box.width * DEVICE_SCALE),
      height: Math.round(box.height * DEVICE_SCALE),
    }

    // Excalidraw's own SVG: its "Export image" dialog, whose SVG button saves the file the
    // editor itself produces. A dialog that does not yield a download is reported, never
    // replaced by a writer of ours.
    let svg = { path: null, bytes: 0, reason: null }
    try {
      await tab.click('[data-testid="main-menu-trigger"]', { timeout: 10000 })
      await tab.waitForTimeout(400)
      await tab.locator('.dropdown-menu-container').getByText('Save to...', { exact: true }).first().click({ timeout: 10000 })
      await tab.waitForTimeout(900)
      const svgButton = tab.locator('[role="dialog"] button, .Modal button, .ImageExportModal button').filter({ hasText: /^SVG$/ }).first()
      if ((await svgButton.count()) === 0) {
        svg.reason = 'Excalidraw\'s export dialog showed no SVG control'
      } else {
        const downloadPromise = tab.waitForEvent('download', { timeout: 20000 }).catch(() => null)
        await svgButton.click()
        const download = await downloadPromise
        if (download === null) {
          svg.reason = 'Excalidraw\'s export dialog produced no download'
        } else {
          const svgPath = join(outDir, `${page}.svg`)
          await download.saveAs(svgPath)
          svg = { path: svgPath, bytes: statSync(svgPath).size, reason: null }
        }
      }
    } catch (error) {
      svg.reason = `Excalidraw\'s export dialog failed: ${error?.message ?? error}`
    }

    return {
      png,
      svg,
      width: png.width,
      height: png.height,
      image: { width: png.width, height: png.height, devicePixelRatio: DEVICE_SCALE },
      bounds: framed.bounds,
      page: { bounds: framed.bounds, viewport: framed.viewport, zoom: framed.zoom },
      empty: framed.empty,
      elements: elements.length,
      renderer: 'excalidraw',
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
