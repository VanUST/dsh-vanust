// index.js
import { join as join4 } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/pages.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var MapRefusal = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MapRefusal";
    this.code = code;
  }
};
var PAGE_SUFFIX = ".excalidraw";
var SCENE_SOURCE = "https://github.com/iustimov/dsh-kit/tree/main/plugins/designmap";
var SLUG = /^[a-z0-9][a-z0-9-]*$/;
function pagesDir(designmapDir) {
  return join(designmapDir, "pages");
}
function emptyScene() {
  return {
    type: "excalidraw",
    version: 2,
    source: SCENE_SOURCE,
    elements: [],
    appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
    files: {}
  };
}
function assertSlug(slug) {
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    throw new MapRefusal("invalid_page", `${JSON.stringify(slug)} is not a page name: use lowercase letters, digits and '-'`);
  }
  return slug;
}
function pagePath(designmapDir, slug) {
  return join(pagesDir(designmapDir), `${assertSlug(slug)}${PAGE_SUFFIX}`);
}
function listPages(designmapDir) {
  const dir = pagesDir(designmapDir);
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(PAGE_SUFFIX)) continue;
    const page = file.slice(0, -PAGE_SUFFIX.length);
    if (!SLUG.test(page)) continue;
    let scene;
    try {
      scene = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      rows.push({ page, nodes: 0, edges: 0, modified: statSync(join(dir, file)).mtime.toISOString(), unreadable: true });
      continue;
    }
    const elements = Array.isArray(scene?.elements) ? scene.elements : [];
    const shapes = elements.filter((entry) => SHAPES.has(entry?.type)).length;
    const arrows = elements.filter((entry) => entry?.type === "arrow").length;
    rows.push({ page, nodes: shapes, edges: arrows, modified: statSync(join(dir, file)).mtime.toISOString() });
  }
  return rows.sort((left, right) => left.modified < right.modified ? 1 : left.modified > right.modified ? -1 : 0);
}
var SHAPES = /* @__PURE__ */ new Set(["rectangle", "ellipse", "diamond"]);
function readPage(designmapDir, slug) {
  const path = pagePath(designmapDir, slug);
  if (!existsSync(path)) {
    throw new MapRefusal("unknown_page", `no page "${slug}" in ${pagesDir(designmapDir)}`);
  }
  let scene;
  try {
    scene = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new MapRefusal("unreadable_page", `${path}: ${error.message}`);
  }
  if (scene === null || typeof scene !== "object" || !Array.isArray(scene.elements)) {
    return { ...emptyScene(), ...scene !== null && typeof scene === "object" ? scene : {}, elements: [] };
  }
  return scene;
}
function writePage(designmapDir, slug, scene) {
  const path = pagePath(designmapDir, slug);
  mkdirSync(pagesDir(designmapDir), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(scene, null, 2)}
`, "utf8");
  renameSync(temp, path);
  return path;
}
function createPage(designmapDir, slug) {
  const path = pagePath(designmapDir, slug);
  if (existsSync(path)) throw new MapRefusal("page_exists", `page "${slug}" already exists`);
  return writePage(designmapDir, slug, emptyScene());
}
function renamePage(designmapDir, from, to) {
  const source = pagePath(designmapDir, from);
  if (!existsSync(source)) throw new MapRefusal("unknown_page", `no page "${from}"`);
  const target = pagePath(designmapDir, to);
  if (existsSync(target)) throw new MapRefusal("page_exists", `page "${to}" already exists`);
  mkdirSync(pagesDir(designmapDir), { recursive: true });
  renameSync(source, target);
  return target;
}
function deletePage(designmapDir, slug) {
  const path = pagePath(designmapDir, slug);
  if (!existsSync(path)) throw new MapRefusal("unknown_page", `no page "${slug}"`);
  rmSync(path);
  return path;
}

// src/ops.mjs
import { join as join3 } from "node:path";

// src/elements.mjs
var SHAPE_TYPES = /* @__PURE__ */ new Set(["rectangle", "ellipse", "diamond"]);
var NODE_FONT_SIZE = 13;
var NODE_LINE_HEIGHT = 1.25;
var EDGE_FONT_SIZE = 11;
var EDGE_LINE_HEIGHT = 1.25;
var CHAR_WIDTH = 6.9;
var MIN_NODE_WIDTH = 140;
var MAX_NODE_WIDTH = 300;
var NODE_PADDING_X = 16;
var NODE_PADDING_Y = 14;
var LINE_HEIGHT_PX = NODE_FONT_SIZE * NODE_LINE_HEIGHT;
var NODE_GAP = 48;
var LAYER_GAP = 96;
var INK = "#1e1e1e";
var NODE_FILL = "#a5d8ff";
var EDGE_INK = "#495057";
function seedOf(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 2147483647;
}
function element(type, id, fields) {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: INK,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: seedOf(id),
    version: 1,
    versionNonce: seedOf(`nonce:${id}`),
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    ...fields
  };
}
function textWidth(text) {
  return Math.ceil(String(text ?? "").length * CHAR_WIDTH);
}
function wrapLabel(label, maxChars) {
  const words = String(label ?? "").split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line === "" ? word : `${line} ${word}`;
    if (next.length <= maxChars || line === "") line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}
function nodeSize(label) {
  const maxChars = Math.floor((MAX_NODE_WIDTH - NODE_PADDING_X * 2) / CHAR_WIDTH);
  const lines = wrapLabel(label, maxChars);
  const widest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const width = Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, Math.ceil(widest * CHAR_WIDTH) + NODE_PADDING_X * 2));
  const height = Math.max(56, Math.ceil(lines.length * LINE_HEIGHT_PX) + NODE_PADDING_Y * 2);
  return { width, height, lines };
}
function buildNode({ id, type = "rectangle", label = "", x = 0, y = 0, width, height }) {
  if (!SHAPE_TYPES.has(type)) type = "rectangle";
  const size = nodeSize(label);
  const w = Number.isFinite(width) && width > 0 ? width : size.width;
  const h = Number.isFinite(height) && height > 0 ? height : size.height;
  const textId = `${id}:label`;
  const text = String(label ?? "");
  const shape = element(type, id, {
    x,
    y,
    width: w,
    height: h,
    backgroundColor: NODE_FILL,
    roundness: type === "rectangle" ? { type: 3 } : null,
    boundElements: text === "" ? [] : [{ type: "text", id: textId }]
  });
  if (text === "") return { shape, text: null };
  const lines = wrapLabel(text, Math.max(8, Math.floor((w - NODE_PADDING_X * 2) / CHAR_WIDTH)));
  const textHeight = Math.ceil(lines.length * LINE_HEIGHT_PX);
  const bound = element("text", textId, {
    x: x + NODE_PADDING_X,
    y: y + Math.max(4, (h - textHeight) / 2),
    width: Math.max(24, w - NODE_PADDING_X * 2),
    height: textHeight,
    text: lines.join("\n"),
    originalText: text,
    fontSize: NODE_FONT_SIZE,
    fontFamily: 2,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: id,
    lineHeight: NODE_LINE_HEIGHT,
    strokeColor: INK
  });
  return { shape, text: bound };
}
function centre(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
function anchors(from, to) {
  const a = centre(from);
  const b = centre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx >= 0 ? from.x + from.width : from.x;
    const tx = dx >= 0 ? to.x : to.x + to.width;
    return { start: { x: sx, y: a.y }, end: { x: tx, y: b.y } };
  }
  const sy = dy >= 0 ? from.y + from.height : from.y;
  const ty = dy >= 0 ? to.y : to.y + to.height;
  return { start: { x: a.x, y: sy }, end: { x: b.x, y: ty } };
}
function buildEdge({ id, label = "", from, to, strokeStyle = "solid" }) {
  const { start, end } = anchors(from, to);
  const textId = `${id}:label`;
  const text = String(label ?? "");
  const points = [[0, 0], [Math.round(end.x - start.x), Math.round(end.y - start.y)]];
  const arrow = element("arrow", id, {
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    points,
    strokeColor: EDGE_INK,
    strokeWidth: 1.4,
    strokeStyle,
    startArrowhead: null,
    endArrowhead: "arrow",
    startBinding: { elementId: from.id, focus: 0, gap: 1 },
    endBinding: { elementId: to.id, focus: 0, gap: 1 },
    boundElements: text === "" ? [] : [{ type: "text", id: textId }]
  });
  if (text === "") return { arrow, text: null };
  const width = Math.max(28, textWidth(text) + 12);
  const bound = element("text", textId, {
    x: Math.round((start.x + end.x) / 2 - width / 2),
    y: Math.round((start.y + end.y) / 2 - 10),
    width,
    height: Math.ceil(EDGE_FONT_SIZE * EDGE_LINE_HEIGHT),
    text,
    originalText: text,
    fontSize: EDGE_FONT_SIZE,
    fontFamily: 2,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: id,
    lineHeight: EDGE_LINE_HEIGHT,
    strokeColor: EDGE_INK
  });
  return { arrow, text: bound };
}
function labelOf(elements, id) {
  const bound = elements.find((entry) => entry?.containerId === id && entry?.type === "text");
  return bound === void 0 ? "" : String(bound.originalText ?? bound.text ?? "");
}

// src/outline.mjs
var SHAPE_NAMES = { rectangle: "box", ellipse: "ellipse", diamond: "diamond" };
function shapesOf(elements) {
  return elements.filter((entry) => entry?.isDeleted !== true && SHAPES.has(entry?.type));
}
function arrowsOf(elements) {
  return elements.filter((entry) => entry?.isDeleted !== true && entry?.type === "arrow");
}
function outlineLines(scene, page) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  const shapes = shapesOf(elements);
  const arrows = arrowsOf(elements);
  const byId = new Map(shapes.map((shape) => [shape.id, labelOf(elements, shape.id) || shape.id]));
  const lines = [`page: ${page} \u2014 ${shapes.length} node(s), ${arrows.length} edge(s)`];
  for (const shape of shapes) {
    const label = labelOf(elements, shape.id);
    lines.push(`- [${SHAPE_NAMES[shape.type] ?? shape.type}] ${label === "" ? `(no label) ${shape.id}` : label}  ${shape.id}`);
  }
  for (const arrow of arrows) {
    const from = byId.get(arrow.startBinding?.elementId) ?? arrow.startBinding?.elementId ?? "?";
    const to = byId.get(arrow.endBinding?.elementId) ?? arrow.endBinding?.elementId ?? "?";
    const label = labelOf(elements, arrow.id);
    lines.push(`- ${from} -> ${to}${label === "" ? "" : `: ${label}`}  ${arrow.id}`);
  }
  return lines;
}
function overlaps(a, b) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right - left > 0 && bottom - top > 0;
}
function hintsOf(scene) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  const shapes = shapesOf(elements);
  const hints = [];
  for (let left = 0; left < shapes.length; left += 1) {
    for (let right = left + 1; right < shapes.length; right += 1) {
      const first = shapes[left];
      const second = shapes[right];
      if (![first.x, first.y, first.width, first.height, second.x, second.y, second.width, second.height].every(Number.isFinite)) continue;
      if (overlaps(first, second)) {
        hints.push({ kind: "node_overlap", elements: [first.id, second.id], message: `${first.id} overlaps ${second.id}` });
      }
    }
  }
  for (const entry of elements) {
    if (entry?.isDeleted === true) continue;
    if (![entry?.x, entry?.y].every(Number.isFinite) || entry.x < 0 || entry.y < 0) {
      hints.push({ kind: "off_canvas", elements: [entry?.id], message: `${entry?.id} starts outside the canvas` });
    }
  }
  for (const arrow of arrowsOf(elements)) {
    if (labelOf(elements, arrow.id) === "") {
      hints.push({ kind: "edge_without_label", elements: [arrow.id], message: `${arrow.id} has no label` });
    }
  }
  return hints;
}
function readOutline(scene, page) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  return {
    ok: true,
    page,
    format: "outline",
    nodes: shapesOf(elements).length,
    edges: arrowsOf(elements).length,
    outline: outlineLines(scene, page).join("\n"),
    hints: hintsOf(scene)
  };
}

// src/excalidraw-render.mjs
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { homedir } from "node:os";
import { dirname, join as join2, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// client/bundle-patch.js
var EXPORT_CLOSED = "loadScene:!1,saveToActiveFile:!1,export:!1";
var EXPORT_OPEN = "loadScene:!1,saveToActiveFile:!1,export:!0";
var FrameBundleMismatch = class extends Error {
  constructor(what) {
    super(what);
    this.name = "FrameBundleMismatch";
    this.code = "FRAME_BUNDLE_MISMATCH";
  }
};
function patchExportSwitch(text) {
  if (!text.includes(EXPORT_CLOSED)) {
    throw new FrameBundleMismatch(
      "client.frame.js is not the vendored Excalidraw bundle this exporter expects (no export switch found)"
    );
  }
  return text.replace(EXPORT_CLOSED, EXPORT_OPEN);
}

// src/excalidraw-render.mjs
var HERE = dirname(fileURLToPath(import.meta.url));
var PLUGIN_DIR = resolve(HERE, "..");
var FRAME_FILE = join2(PLUGIN_DIR, "client.frame.js");
var PADDING = 24;
var MIN_VIEWPORT = { width: 320, height: 200 };
var MAX_VIEWPORT = { width: 2400, height: 2400 };
var DEVICE_SCALE = 2;
function pageBounds(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const note = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const element2 of Array.isArray(elements) ? elements : []) {
    if (element2 === null || typeof element2 !== "object" || element2.isDeleted === true) continue;
    if (element2.type === "arrow") {
      note(element2.x, element2.y);
      for (const point of Array.isArray(element2.points) ? element2.points : []) note(element2.x + point[0], element2.y + point[1]);
      continue;
    }
    note(element2.x, element2.y);
    note(element2.x + (element2.width ?? 0), element2.y + (element2.height ?? 0));
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0, empty: true };
  const width = Math.ceil(maxX - minX);
  const height = Math.ceil(maxY - minY);
  return { x: Math.floor(minX), y: Math.floor(minY), width, height, empty: width <= 0 || height <= 0 };
}
function frameFor(bounds, { padding = PADDING } = {}) {
  const empty = bounds === null || typeof bounds !== "object" || bounds.empty === true || bounds.width <= 0 || bounds.height <= 0;
  if (empty) {
    return { bounds: { x: 0, y: 0, width: 0, height: 0, empty: true }, viewport: { ...MIN_VIEWPORT }, zoom: 1, scrollX: 0, scrollY: 0, empty: true };
  }
  const wanted = { width: bounds.width + padding * 2, height: bounds.height + padding * 2 };
  const viewport = {
    width: Math.min(MAX_VIEWPORT.width, Math.max(MIN_VIEWPORT.width, Math.ceil(wanted.width))),
    height: Math.min(MAX_VIEWPORT.height, Math.max(MIN_VIEWPORT.height, Math.ceil(wanted.height)))
  };
  const zoom = Math.max(0.05, Math.min(1.5, Math.min(viewport.width / wanted.width, viewport.height / wanted.height)));
  const centreX = bounds.x + bounds.width / 2;
  const centreY = bounds.y + bounds.height / 2;
  return {
    bounds,
    viewport,
    zoom,
    scrollX: viewport.width / (2 * zoom) - centreX,
    scrollY: viewport.height / (2 * zoom) - centreY,
    empty: false
  };
}
async function loadPlaywright() {
  try {
    return await import("playwright-core");
  } catch {
  }
  const candidates = [
    join2(PLUGIN_DIR, "..", "..", ".tools", "node_modules", "playwright-core", "index.mjs"),
    join2(homedir(), "dsh-kit", ".tools", "node_modules", "playwright-core", "index.mjs")
  ];
  for (const candidate of candidates) {
    if (!existsSync2(candidate)) continue;
    try {
      return await import(pathToFileURL(candidate).href);
    } catch {
    }
  }
  return null;
}
function chromiumBinary() {
  const override = process.env.DESIGNMAP_CHROMIUM;
  if (typeof override === "string" && override !== "" && existsSync2(override)) return override;
  const root = join2(homedir(), ".cache", "ms-playwright");
  if (!existsSync2(root)) return null;
  const candidates = [];
  for (const entry of readdirSync2(root)) {
    if (!entry.startsWith("chromium-")) continue;
    const binary = join2(root, entry, "chrome-linux64", "chrome");
    if (existsSync2(binary)) candidates.push({ binary, order: Number(entry.split("-")[1]) || 0 });
  }
  candidates.sort((left, right) => right.order - left.order);
  return candidates.length === 0 ? null : candidates[0].binary;
}
function patchedFrame() {
  const text = readFileSync2(FRAME_FILE, "utf8");
  try {
    return patchExportSwitch(text);
  } catch (error) {
    if (error instanceof FrameBundleMismatch) {
      throw new MapRefusal("renderer_unavailable", `${FRAME_FILE} is not the vendored Excalidraw frame this exporter expects: ${error.message}`);
    }
    throw error;
  }
}
async function renderWithExcalidraw(elements, outDir, page, { timeoutMs = 9e4 } = {}) {
  if (!Array.isArray(elements)) {
    throw new MapRefusal("renderer_unavailable", "a render needs the page elements");
  }
  const playwright = await loadPlaywright();
  if (playwright === null) {
    throw new MapRefusal("renderer_unavailable", "playwright-core is not installed (looked beside the plugin and in <kit>/.tools/node_modules)");
  }
  const executablePath = chromiumBinary();
  if (executablePath === null) {
    throw new MapRefusal("renderer_unavailable", "no Chromium binary in ~/.cache/ms-playwright (set DESIGNMAP_CHROMIUM)");
  }
  if (!existsSync2(FRAME_FILE)) {
    throw new MapRefusal("renderer_unavailable", `the vendored Excalidraw bundle is missing: ${FRAME_FILE}`);
  }
  const bundle = patchedFrame();
  let browser;
  try {
    browser = await playwright.chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  } catch (error) {
    throw new MapRefusal("renderer_unavailable", `Chromium did not launch: ${error?.message ?? error}`);
  }
  try {
    const framed = frameFor(pageBounds(elements));
    const context = await browser.newContext({ viewport: framed.viewport, deviceScaleFactor: DEVICE_SCALE, acceptDownloads: true });
    const tab = await context.newPage();
    await tab.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0;background:#ffffff}</style></head><body><div id="root"></div></body></html>');
    await tab.addScriptTag({ content: bundle });
    await tab.waitForFunction(() => document.querySelectorAll("canvas").length > 0, null, { timeout: timeoutMs });
    await tab.evaluate((scene) => {
      window.postMessage({ source: "design-map-panel", type: "load", scene }, "*");
    }, {
      elements,
      appState: {
        viewBackgroundColor: "#ffffff",
        gridSize: null,
        zoom: { value: framed.zoom },
        scrollX: framed.scrollX,
        scrollY: framed.scrollY
      }
    });
    await tab.waitForTimeout(1800);
    mkdirSync2(outDir, { recursive: true });
    const pngPath = join2(outDir, `${page}.png`);
    const canvas = tab.locator(".excalidraw canvas").first();
    const box = await canvas.boundingBox();
    if (box === null) throw new MapRefusal("renderer_unavailable", "Excalidraw rendered no canvas to capture");
    await canvas.screenshot({ path: pngPath });
    const png = {
      path: pngPath,
      bytes: statSync2(pngPath).size,
      width: Math.round(box.width * DEVICE_SCALE),
      height: Math.round(box.height * DEVICE_SCALE)
    };
    let svg = { path: null, bytes: 0, reason: null };
    try {
      await tab.click('[data-testid="main-menu-trigger"]', { timeout: 1e4 });
      await tab.waitForTimeout(400);
      await tab.locator(".dropdown-menu-container").getByText("Save to...", { exact: true }).first().click({ timeout: 1e4 });
      await tab.waitForTimeout(900);
      const svgButton = tab.locator('[role="dialog"] button, .Modal button, .ImageExportModal button').filter({ hasText: /^SVG$/ }).first();
      if (await svgButton.count() === 0) {
        svg.reason = "Excalidraw's export dialog showed no SVG control";
      } else {
        const downloadPromise = tab.waitForEvent("download", { timeout: 2e4 }).catch(() => null);
        await svgButton.click();
        const download = await downloadPromise;
        if (download === null) {
          svg.reason = "Excalidraw's export dialog produced no download";
        } else {
          const svgPath = join2(outDir, `${page}.svg`);
          await download.saveAs(svgPath);
          svg = { path: svgPath, bytes: statSync2(svgPath).size, reason: null };
        }
      }
    } catch (error) {
      svg.reason = `Excalidraw's export dialog failed: ${error?.message ?? error}`;
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
      renderer: "excalidraw"
    };
  } finally {
    await browser.close().catch(() => {
    });
  }
}

// src/tidy.mjs
var ORIGIN_X = 40;
var ORIGIN_Y = 40;
function ranksOf(elements) {
  const shapes = shapesOf(elements);
  const ids = new Set(shapes.map((shape) => shape.id));
  const edges = [];
  for (const arrow of arrowsOf(elements)) {
    const from = arrow.startBinding?.elementId;
    const to = arrow.endBinding?.elementId;
    if (ids.has(from) && ids.has(to) && from !== to) edges.push([from, to]);
  }
  const rank = new Map([...ids].map((id) => [id, 0]));
  for (let pass = 0; pass < ids.size; pass += 1) {
    let changed = false;
    for (const [from, to] of edges) {
      const next = Math.min(rank.get(from) + 1, ids.size - 1);
      if (rank.get(to) < next) {
        rank.set(to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
}
function overlapPairs(shapes) {
  let pairs = 0;
  for (let left = 0; left < shapes.length; left += 1) {
    for (let right = left + 1; right < shapes.length; right += 1) {
      const a = shapes[left];
      const b = shapes[right];
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (w > 0 && h > 0) pairs += 1;
    }
  }
  return pairs;
}
function tidyElements(elements, { originX = ORIGIN_X, originY = ORIGIN_Y } = {}) {
  const list = Array.isArray(elements) ? elements : [];
  const shapes = shapesOf(list);
  const rank = ranksOf(list);
  const layers = /* @__PURE__ */ new Map();
  for (const shape of shapes) {
    const level = rank.get(shape.id) ?? 0;
    if (!layers.has(level)) layers.set(level, []);
    layers.get(level).push(shape);
  }
  const placed = /* @__PURE__ */ new Map();
  let cursorX = originX;
  let moved = 0;
  for (const level of [...layers.keys()].sort((left, right) => left - right)) {
    const column = layers.get(level).slice().sort((left, right) => {
      const a = labelOf(list, left.id) || left.id;
      const b = labelOf(list, right.id) || right.id;
      return a.localeCompare(b) || left.id.localeCompare(right.id);
    });
    const boxes = column.map((shape) => buildNode({ id: shape.id, type: shape.type, label: labelOf(list, shape.id) }).shape);
    const columnWidth = boxes.reduce((max, box) => Math.max(max, box.width), 0);
    let cursorY = originY;
    for (let index = 0; index < column.length; index += 1) {
      const box = boxes[index];
      const x = Math.round(cursorX + (columnWidth - box.width) / 2);
      const y = Math.round(cursorY);
      if (Math.round(column[index].x) !== x || Math.round(column[index].y) !== y) moved += 1;
      placed.set(column[index].id, { id: column[index].id, x, y, width: box.width, height: box.height });
      cursorY += box.height + NODE_GAP;
    }
    cursorX += columnWidth + LAYER_GAP;
  }
  const moved_ = list.map((element2) => {
    if (element2 === null || typeof element2 !== "object") return element2;
    const own = placed.get(element2.id);
    if (own !== void 0) return { ...element2, x: own.x, y: own.y };
    if (typeof element2.containerId === "string") {
      const container = placed.get(element2.containerId);
      const original = list.find((entry) => entry?.id === element2.containerId);
      if (container !== void 0 && original !== void 0) {
        return { ...element2, x: Math.round(container.x + (element2.x - original.x)), y: Math.round(container.y + (element2.y - original.y)) };
      }
    }
    return element2;
  });
  const byId = new Map(moved_.map((element2) => [element2?.id, element2]));
  const arrows = moved_.map((element2) => {
    if (element2?.type !== "arrow") return element2;
    const from = element2.startBinding?.elementId;
    const to = element2.endBinding?.elementId;
    const source = byId.get(from);
    const target = byId.get(to);
    if (source === void 0 || target === void 0 || !placed.has(from) || !placed.has(to)) return element2;
    const edge = buildEdge({ id: element2.id, label: labelOf(list, element2.id), from: source, to: target, strokeStyle: element2.strokeStyle });
    return { ...element2, x: edge.arrow.x, y: edge.arrow.y, points: edge.arrow.points, width: edge.arrow.width, height: edge.arrow.height };
  });
  return {
    elements: arrows,
    moved,
    overlapsBefore: overlapPairs(shapes),
    overlapsAfter: overlapPairs(shapesOf(arrows))
  };
}

// src/ops.mjs
var OPS = /* @__PURE__ */ new Set([
  "node.add",
  "node.move",
  "node.resize",
  "node.label",
  "edge.add",
  "edge.label",
  "element.delete",
  "page.create",
  "page.rename",
  "page.delete",
  "tidy"
]);
function nextId(elements, prefix) {
  let index = 1;
  while (elements.some((entry) => entry.id === `${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}
function shapeOf(elements, id) {
  const shape = elements.find((entry) => entry?.id === id && SHAPES.has(entry?.type) && entry.isDeleted !== true);
  if (shape === void 0) throw new MapRefusal("unknown_node", `no node "${id}" on this page`);
  return shape;
}
function arrowOf(elements, id) {
  const arrow = elements.find((entry) => entry?.id === id && entry.type === "arrow" && entry.isDeleted !== true);
  if (arrow === void 0) throw new MapRefusal("unknown_node", `no edge "${id}" on this page`);
  return arrow;
}
function removeElement(elements, id) {
  const kept = elements.filter((entry) => entry?.id !== id && entry?.containerId !== id);
  return kept.filter((entry) => entry?.type !== "arrow" || entry.startBinding?.elementId !== id && entry.endBinding?.elementId !== id);
}
function nextSpot(elements) {
  let bottom = 0;
  for (const entry of elements) {
    if (!SHAPES.has(entry?.type)) continue;
    bottom = Math.max(bottom, (entry.y ?? 0) + (entry.height ?? 0));
  }
  return { x: 40, y: bottom + 48 };
}
function replaceLabel(elements, id, label, { width, height, x, y } = {}) {
  const kept = elements.filter((entry) => !(entry?.type === "text" && entry.containerId === id));
  const anchor = kept.find((entry) => entry.id === id);
  const built = buildNode({
    id,
    type: anchor?.type ?? "rectangle",
    label,
    x: x ?? anchor?.x ?? 0,
    y: y ?? anchor?.y ?? 0,
    width: width ?? anchor?.width,
    height: height ?? anchor?.height
  });
  const index = kept.findIndex((entry) => entry.id === id);
  kept[index] = built.shape;
  if (built.text !== null) kept.push(built.text);
  return kept;
}
function applyOp(designmapDir, op) {
  const kind = typeof op?.op === "string" ? op.op : "";
  if (!OPS.has(kind)) {
    throw new MapRefusal("unknown_op", `"${kind}" is not one of ${[...OPS].join(", ")}`);
  }
  if (kind === "page.create") {
    createPage(designmapDir, op.page);
    return { ok: true, page: op.page, action: kind, nodes: 0, edges: 0, hints: [] };
  }
  if (kind === "page.rename") {
    renamePage(designmapDir, op.page, op.to);
    return { ok: true, page: op.to, action: kind, from: op.page, nodes: 0, edges: 0, hints: [] };
  }
  if (kind === "page.delete") {
    deletePage(designmapDir, op.page);
    return { ok: true, page: op.page, action: kind, deleted: true, nodes: 0, edges: 0, hints: [] };
  }
  const scene = readPage(designmapDir, op.page);
  let elements = Array.isArray(scene.elements) ? scene.elements.slice() : [];
  let id = typeof op.id === "string" ? op.id : void 0;
  let notes = [];
  if (kind === "node.add") {
    id = id ?? nextId(elements, "n");
    const spot = Number.isFinite(op.x) && Number.isFinite(op.y) ? { x: op.x, y: op.y } : nextSpot(elements);
    const node = buildNode({ id, type: op.kind ?? op.shape ?? "rectangle", label: op.label ?? "", x: spot.x, y: spot.y });
    elements.push(node.shape);
    if (node.text !== null) elements.push(node.text);
  } else if (kind === "node.move") {
    const shape = shapeOf(elements, id);
    const x = Number.isFinite(op.x) ? op.x : shape.x;
    const y = Number.isFinite(op.y) ? op.y : shape.y;
    const dx = x - shape.x;
    const dy = y - shape.y;
    elements = elements.map((entry) => entry.id === id || entry.containerId === id ? { ...entry, x: entry.x + dx, y: entry.y + dy } : entry);
    for (const arrow of elements.filter((entry) => entry.type === "arrow" && (entry.startBinding?.elementId === id || entry.endBinding?.elementId === id))) {
      const index = elements.findIndex((entry) => entry.id === arrow.id);
      elements[index] = { ...arrow, x: arrow.x + dx * 0.5, y: arrow.y + dy * 0.5 };
    }
  } else if (kind === "node.resize") {
    const shape = shapeOf(elements, id);
    const width = Number.isFinite(op.width) && op.width > 0 ? op.width : shape.width;
    const height = Number.isFinite(op.height) && op.height > 0 ? op.height : shape.height;
    elements = replaceLabel(elements, id, labelOf(elements, id), { width, height });
  } else if (kind === "node.label") {
    shapeOf(elements, id);
    elements = replaceLabel(elements, id, String(op.label ?? ""));
  } else if (kind === "edge.add") {
    id = id ?? nextId(elements, "e");
    const from = shapeOf(elements, op.from);
    const to = shapeOf(elements, op.to);
    const edge = buildEdge({ id, label: op.label ?? "", from, to });
    elements.push(edge.arrow);
    if (edge.text !== null) elements.push(edge.text);
  } else if (kind === "edge.label") {
    const arrow = arrowOf(elements, id);
    elements = elements.filter((entry) => !(entry?.type === "text" && entry.containerId === arrow.id));
    const from = elements.find((entry) => entry.id === arrow.startBinding?.elementId);
    const to = elements.find((entry) => entry.id === arrow.endBinding?.elementId);
    const index = elements.findIndex((entry) => entry.id === arrow.id);
    if (from === void 0 || to === void 0) {
      notes.push("edge label skipped: the arrow has no bound endpoint");
      elements[index] = { ...arrow, boundElements: [] };
    } else {
      const edge = buildEdge({ id: arrow.id, label: String(op.label ?? ""), from, to, strokeStyle: arrow.strokeStyle });
      elements[index] = edge.arrow;
      if (edge.text !== null) elements.push(edge.text);
    }
  } else if (kind === "element.delete") {
    elements.length = 0;
    elements.push(...removeElement(Array.isArray(scene.elements) ? scene.elements : [], id));
  } else if (kind === "tidy") {
    const result = tidyElements(Array.isArray(scene.elements) ? scene.elements : []);
    elements = result.elements;
    notes = notes.concat([`overlaps ${result.overlapsBefore} -> ${result.overlapsAfter}`, `${result.moved} shape(s) moved`]);
  }
  scene.elements = elements;
  writePage(designmapDir, op.page, scene);
  const shapes = elements.filter((entry) => SHAPES.has(entry?.type)).length;
  const arrows = elements.filter((entry) => entry?.type === "arrow").length;
  return { ok: true, page: op.page, action: kind, id, nodes: shapes, edges: arrows, hints: hintsOf(scene), notes };
}
async function renderPage(designmapDir, page) {
  const scene = readPage(designmapDir, page);
  const outDir = join3(designmapDir, "out");
  const rendered = await renderWithExcalidraw(Array.isArray(scene.elements) ? scene.elements : [], outDir, page);
  return { ok: true, page, ...rendered };
}

// src/command.mjs
var OPS2 = ["pages", "page", "save", "tidy-page", "render-page"];
function createCommandHandler({ hostFor }) {
  return async function handler(invocation) {
    const { designmapDir } = hostFor({ agent: invocation.agent });
    let op;
    try {
      op = JSON.parse(invocation.rawInput);
    } catch {
      return { kind: "error", text: "designmap: expected a JSON operation" };
    }
    if (op === null || typeof op !== "object" || !OPS2.includes(op.op)) {
      return { kind: "error", text: `designmap: unknown op (${OPS2.join(" | ")})` };
    }
    try {
      let value;
      switch (op.op) {
        case "pages":
          value = { ok: true, pages: listPages(designmapDir) };
          break;
        case "page":
          value = { ok: true, page: op.page, scene: readPage(designmapDir, op.page) };
          break;
        case "save": {
          if (op.scene === null || typeof op.scene !== "object" || !Array.isArray(op.scene.elements)) {
            return { kind: "error", text: "designmap: invalid_scene: save needs a scene with an elements array" };
          }
          const previous = readPage(designmapDir, op.page);
          const next = {
            ...previous,
            ...op.scene,
            type: "excalidraw",
            version: previous.version ?? op.scene.version ?? 2,
            source: previous.source ?? op.scene.source,
            appState: op.scene.appState ?? previous.appState ?? {},
            files: op.scene.files ?? previous.files ?? {},
            elements: op.scene.elements
          };
          writePage(designmapDir, op.page, next);
          value = { ok: true, page: op.page, elements: next.elements.length, previousElements: previous.elements.length, savedAt: (/* @__PURE__ */ new Date()).toISOString() };
          break;
        }
        case "tidy-page":
          value = applyOp(designmapDir, { op: "tidy", page: op.page });
          break;
        case "render-page":
          value = await renderPage(designmapDir, op.page);
          break;
        default:
          return { kind: "error", text: `designmap: unknown op (${OPS2.join(" | ")})` };
      }
      return { kind: "success", text: JSON.stringify(value) };
    } catch (error) {
      if (error instanceof MapRefusal || typeof error?.code === "string") {
        return { kind: "error", text: `designmap: ${error.code}: ${error.message}` };
      }
      return { kind: "error", text: `designmap: internal_error: ${String(error?.message ?? error)}` };
    }
  };
}

// src/page-tools.mjs
var string = (description, required = false) => ({ type: "string", description, ...required ? { required: true } : {} });
var number = (description) => ({ type: "number", description });
var jsonOutput = {
  schema: { type: "json" },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
};
var PAGE_TOOL_SPECS = [
  {
    name: "map_list",
    description: "List the design-map pages: one Excalidraw file per page under designmap/pages/, with node and edge counts and the last-modified time. Read-only.",
    parameters: {},
    call: ({ designmapDir }) => ({ ok: true, pages: listPages(designmapDir) })
  },
  {
    name: "map_read",
    description: 'Read one page. Default format is a compact outline ("- [box] Checkout API", "- Checkout API -> Orders DB: reads"); pass format "json" for the exact scene. Always returns hints (node_overlap, off_canvas, edge_without_label) and never refuses a crowded page.',
    parameters: {
      page: string("Page name (the file name without .excalidraw).", true),
      format: { type: "string", enum: ["outline", "json"], description: "outline (default) or json for exact positions." }
    },
    call: ({ designmapDir }, args) => {
      const read = readOutline(readPage(designmapDir, args.page), args.page);
      if (args.format === "json") {
        const scene = readPage(designmapDir, args.page);
        return { ...read, format: "json", elements: scene.elements, appState: scene.appState ?? {}, hints: hintsOf(scene) };
      }
      return read;
    }
  },
  {
    name: "map_edit",
    description: "Change one page with a single op: node.add, node.move, node.resize, node.label, edge.add, edge.label, element.delete, page.create, page.rename, page.delete, tidy. You pass a label and a place, never a seed, a version, a binding or a point: the tool builds a shape with its bound text and an arrow with real bindings. An unknown page or node is refused by name; a crowded page is not.",
    parameters: {
      page: string("Page name; for page.create the page to create, for page.rename the current name.", true),
      op: { type: "string", enum: [...OPS], required: true, description: "The op to apply." },
      id: string("Element id returned by map_read (node ops, edge.label, element.delete). Omitted on node.add/edge.add: a new id is returned."),
      label: string("Node or edge label."),
      x: number("Node x in page coordinates (node.add, node.move)."),
      y: number("Node y in page coordinates (node.add, node.move)."),
      width: number("Node width (node.resize)."),
      height: number("Node height (node.resize)."),
      from: string("Source node id (edge.add)."),
      to: string("Target node id (edge.add), or the new page name (page.rename)."),
      kind: { type: "string", enum: ["rectangle", "ellipse", "diamond"], description: "Shape of a new node (node.add). Default rectangle." }
    },
    call: ({ designmapDir }, args) => applyOp(designmapDir, { ...args, newPage: args.to_page ?? args.newPage })
  },
  {
    name: "map_render",
    description: "Render one page with Excalidraw itself in a headless browser: designmap/out/<page>.png (readable with read_image) and designmap/out/<page>.svg (Excalidraw's own export), for a deck, a document or the state panel. Returns both paths, their byte sizes and the element count; refuses renderer_unavailable when no browser is present.",
    parameters: { page: string("Page name to render.", true) },
    call: ({ designmapDir }, args) => renderPage(designmapDir, args.page)
  }
];
function createPageTools({ defineTool: defineTool2, pageHostFor }) {
  return PAGE_TOOL_SPECS.map((spec) => defineTool2({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: jsonOutput,
    async execute(args, exec) {
      const host = pageHostFor(exec);
      try {
        return await spec.call(host, args ?? {});
      } catch (error) {
        if (error?.name === "MapRefusal" || typeof error?.code === "string") {
          return { ok: false, code: error.code ?? "internal_error", message: String(error?.message ?? error) };
        }
        return { ok: false, code: "internal_error", message: String(error?.message ?? error) };
      }
    }
  }));
}

// index.js
var name = "designmap";
var inject = ["tools", "commands"];
var DEFAULT_PRESETS = ["orchestrator"];
function agentCwd(agent) {
  const cwd = agent?.session?.header?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd();
}
function presetOf(ctx, agent) {
  try {
    const resolved = ctx.get?.("toolFamilies")?.presetFor?.(agent?.session);
    if (typeof resolved === "string" && resolved.trim() !== "") return resolved;
  } catch {
  }
  try {
    const projected = ctx.get?.("agentPresets")?.presetForSession?.(agent?.session);
    if (typeof projected === "string" && projected.trim() !== "") return projected;
  } catch {
  }
  try {
    const header = agent?.session?.header?.agentPreset;
    return typeof header === "string" && header !== "" ? header : void 0;
  } catch {
    return void 0;
  }
}
function installPresetGate(ctx, { allowed, tools = [], toolsFor, onInstalled }) {
  const installed = /* @__PURE__ */ new Map();
  const resolve2 = (agent) => {
    try {
      return presetOf(ctx, agent);
    } catch {
      return void 0;
    }
  };
  const sync = (agent, presetOverride) => {
    if (agent === void 0 || agent === null) return;
    try {
      const preset = typeof presetOverride === "string" && presetOverride !== "" ? presetOverride : resolve2(agent);
      const current = installed.get(agent);
      if (current !== void 0 && current.preset === preset) return;
      if (current !== void 0) {
        for (const dispose of current.disposers) {
          try {
            dispose();
          } catch {
          }
        }
        installed.delete(agent);
      }
      if (typeof preset !== "string" || !allowed(preset)) return;
      const selected = typeof toolsFor === "function" ? toolsFor(preset) : tools;
      const disposers = selected.map((tool) => agent.ctx.tools.register(tool)).filter((dispose) => typeof dispose === "function");
      installed.set(agent, { preset, disposers });
      onInstalled?.(agent, preset);
    } catch {
    }
  };
  ctx.on("agent/created", ({ agent }) => sync(agent));
  if (typeof ctx.root?.on === "function") {
    ctx.root.on("session/event", (session, event) => {
      if (event?.type !== "agent-preset/selected") return;
      let live;
      try {
        live = ctx.get?.("agents")?.get?.(session?.id);
      } catch {
        live = void 0;
      }
      if (live !== void 0 && live !== null) sync(live, event?.data?.agentPreset);
    });
  }
  ctx.on("agent/pre-step", (payload, next) => {
    sync(payload?.agent);
    return next();
  }, { prepend: true });
  return sync;
}
function apply(ctx, config = {}) {
  const dirName = typeof config.dir === "string" && config.dir !== "" ? config.dir : "designmap";
  const presets = Array.isArray(config.presets) && config.presets.length > 0 ? config.presets : DEFAULT_PRESETS;
  const pageHostFor = (exec) => ({ designmapDir: join4(agentCwd(exec.agent), dirName) });
  const pageTools = createPageTools({ defineTool, pageHostFor });
  installPresetGate(ctx, {
    tools: pageTools,
    allowed: (preset) => presets.includes(preset)
  });
  ctx.commands.register({
    name: "designmap",
    description: "Read or change one design-map page (pages | page | save | tidy-page | render-page). Used by the Project state -> Map editor and by the human.",
    recordInput: false,
    handler: createCommandHandler({ hostFor: (invocation) => pageHostFor(invocation) })
  });
}
export {
  apply,
  inject,
  name
};
