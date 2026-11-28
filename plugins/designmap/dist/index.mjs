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
var MIN_NODE_HEIGHT = 56;
var MAX_NODE_WIDTH = 300;
var NODE_PADDING_X = 16;
var LINE_HEIGHT_PX = NODE_FONT_SIZE * NODE_LINE_HEIGHT;
var NODE_GAP = 48;
var LAYER_GAP = 96;
var BOUND_TEXT_PADDING = 5;
var ELLIPSE_INSCRIBED = Math.SQRT2;
var INK = "#1e1e1e";
var NODE_FILL = "#a5d8ff";
var EDGE_INK = "#495057";
var NODE_COLORS = {
  blue: "#a5d8ff",
  green: "#b2f2bb",
  red: "#ffc9c9",
  yellow: "#ffec99",
  violet: "#d0bfff",
  grey: "#e9ecef",
  white: "#ffffff",
  none: "transparent"
};
function colorOf(name2, fallback = NODE_FILL) {
  if (typeof name2 !== "string" || name2 === "") return fallback;
  return NODE_COLORS[name2.toLowerCase()] ?? fallback;
}
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
    index: null,
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
function innerTextWidth(type, width) {
  if (type === "ellipse") return Math.max(8, Math.round(width / 2 * ELLIPSE_INSCRIBED) - BOUND_TEXT_PADDING * 2);
  if (type === "diamond") return Math.max(8, Math.round(width / 2) - BOUND_TEXT_PADDING * 2);
  return Math.max(8, Math.round(width) - BOUND_TEXT_PADDING * 2);
}
function innerTextHeight(type, height) {
  if (type === "ellipse") return Math.max(8, Math.round(height / 2 * ELLIPSE_INSCRIBED) - BOUND_TEXT_PADDING * 2);
  if (type === "diamond") return Math.max(8, Math.round(height / 2) - BOUND_TEXT_PADDING * 2);
  return Math.max(8, Math.round(height) - BOUND_TEXT_PADDING * 2);
}
function sizedToText(textWanted, textHeightWanted, type) {
  const wanted = Math.ceil(textWanted + BOUND_TEXT_PADDING * 2);
  const wantedHeight = Math.ceil(textHeightWanted + BOUND_TEXT_PADDING * 2);
  if (type === "ellipse") {
    return { width: Math.ceil(wanted * ELLIPSE_INSCRIBED), height: Math.ceil(wantedHeight * ELLIPSE_INSCRIBED) };
  }
  if (type === "diamond") return { width: wanted * 2, height: wantedHeight * 2 };
  return { width: wanted, height: wantedHeight };
}
function nodeSize(label, type = "rectangle") {
  const maxChars = Math.floor((MAX_NODE_WIDTH - NODE_PADDING_X * 2) / CHAR_WIDTH);
  const lines = wrapLabel(label, maxChars);
  const widest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const textWanted = Math.max(widest * CHAR_WIDTH, MIN_NODE_WIDTH - NODE_PADDING_X * 2);
  const textHeightWanted = lines.length * LINE_HEIGHT_PX;
  const box = sizedToText(textWanted, textHeightWanted, type);
  return {
    width: Math.max(type === "rectangle" ? MIN_NODE_WIDTH : MIN_NODE_WIDTH + 20, box.width),
    height: Math.max(type === "rectangle" ? MIN_NODE_HEIGHT : MIN_NODE_HEIGHT + 12, box.height),
    lines
  };
}
function buildNode({ id, type = "rectangle", label = "", x = 0, y = 0, width, height, color }) {
  if (!SHAPE_TYPES.has(type)) type = "rectangle";
  const size = nodeSize(label, type);
  const w = Number.isFinite(width) && width > 0 ? width : size.width;
  const h = Number.isFinite(height) && height > 0 ? height : size.height;
  const textId = `${id}:label`;
  const text = String(label ?? "");
  const shape = element(type, id, {
    x,
    y,
    width: w,
    height: h,
    backgroundColor: colorOf(color),
    roundness: type === "rectangle" ? { type: 3 } : null,
    boundElements: text === "" ? [] : [{ type: "text", id: textId }]
  });
  if (text === "") return { shape, text: null };
  const maxWidth = innerTextWidth(type, w);
  const lines = wrapLabel(text, Math.max(8, Math.floor(maxWidth / CHAR_WIDTH)));
  const textHeight = Math.ceil(lines.length * LINE_HEIGHT_PX);
  const textBoxWidth = Math.max(24, Math.min(maxWidth, Math.ceil(Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH)));
  const bound = element("text", textId, {
    x: x + Math.round((w - textBoxWidth) / 2),
    y: y + Math.round((h - textHeight) / 2),
    width: textBoxWidth,
    height: textHeight,
    text: lines.join("\n"),
    originalText: text,
    fontSize: NODE_FONT_SIZE,
    fontFamily: 2,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: id,
    autoResize: false,
    lineHeight: NODE_LINE_HEIGHT,
    strokeColor: INK
  });
  return { shape, text: bound };
}
function buildNote({ id, text = "", x = 0, y = 0, fontSize = 16, color }) {
  const value = String(text ?? "");
  const lines = value.split("\n");
  const width = Math.max(24, textWidth(lines.reduce((longest, line) => line.length > longest.length ? line : longest, "")));
  const height = Math.max(20, Math.ceil(lines.length * fontSize * 1.25));
  return element("text", id, {
    x,
    y,
    width,
    height,
    text: value,
    originalText: value,
    fontSize,
    fontFamily: 2,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    strokeColor: colorOf(color, INK)
  });
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
function buildEdge({ id, label = "", from, to, strokeStyle = "solid", startArrowhead = null, endArrowhead = "arrow" }) {
  const { start, end } = anchors(from, to);
  const textId = `${id}:label`;
  const text = String(label ?? "");
  const points = [[0, 0], [Math.round(end.x - start.x), Math.round(end.y - start.y)]];
  const labelMaxWidth = Math.max(Math.round(0.7 * Math.abs(end.x - start.x)), EDGE_FONT_SIZE * 11);
  const lines = wrapLabel(text, Math.max(8, Math.floor(labelMaxWidth / CHAR_WIDTH)));
  const rendered = lines.join("\n");
  const arrow = element("arrow", id, {
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    points,
    lastCommittedPoint: null,
    elbowed: false,
    strokeColor: EDGE_INK,
    strokeWidth: 1.4,
    strokeStyle,
    startArrowhead,
    endArrowhead,
    startBinding: { elementId: from.id, focus: 0, gap: 1 },
    endBinding: { elementId: to.id, focus: 0, gap: 1 },
    boundElements: text === "" ? [] : [{ type: "text", id: textId }]
  });
  if (text === "") return { arrow, text: null, labelMaxWidth };
  const widest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const width = Math.max(24, Math.min(labelMaxWidth, Math.ceil(widest * CHAR_WIDTH) + 4));
  const height = Math.ceil(lines.length * EDGE_FONT_SIZE * EDGE_LINE_HEIGHT);
  const bound = element("text", textId, {
    x: Math.round((start.x + end.x) / 2 - width / 2),
    y: Math.round((start.y + end.y) / 2 - height / 2),
    width,
    height,
    text: rendered,
    originalText: text,
    fontSize: EDGE_FONT_SIZE,
    fontFamily: 2,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: id,
    autoResize: false,
    lineHeight: EDGE_LINE_HEIGHT,
    strokeColor: EDGE_INK
  });
  return { arrow, text: bound, labelMaxWidth };
}
function labelOf(elements, id) {
  const bound = elements.find((entry) => entry?.containerId === id && entry?.type === "text");
  return bound === void 0 ? "" : String(bound.originalText ?? bound.text ?? "");
}

// src/lint.mjs
var NODE_FONT = 13;
var LINE_NODE = NODE_FONT * NODE_LINE_HEIGHT;
var CLEARANCE = 24;
var OVERLAP_EPSILON = 0.5;
var SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
var PENALTY = { high: 18, medium: 8, low: 3 };
var SEVERITIES = Object.keys(SEVERITY_RANK);
var finite = (value) => typeof value === "number" && Number.isFinite(value);
function isShape(element2) {
  return element2 !== null && typeof element2 === "object" && element2.isDeleted !== true && SHAPES.has(element2.type);
}
function isArrow(element2) {
  return element2 !== null && typeof element2 === "object" && element2.isDeleted !== true && element2.type === "arrow";
}
function isFreeText(element2) {
  return element2 !== null && typeof element2 === "object" && element2.isDeleted !== true && element2.type === "text" && typeof element2.containerId !== "string";
}
function drawn(elements) {
  return (Array.isArray(elements) ? elements : []).filter((element2) => element2 !== null && typeof element2 === "object" && element2.isDeleted !== true);
}
function boxOf(element2) {
  if (element2 === null || typeof element2 !== "object") return null;
  if (element2.type === "arrow") {
    const points = Array.isArray(element2.points) ? element2.points : [];
    if (!finite(element2.x) || !finite(element2.y) || points.length === 0) return null;
    const xs = points.map((point) => element2.x + (finite(point?.[0]) ? point[0] : 0));
    const ys = points.map((point) => element2.y + (finite(point?.[1]) ? point[1] : 0));
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }
  if (![element2.x, element2.y, element2.width, element2.height].every(finite)) return null;
  return { x: element2.x, y: element2.y, width: element2.width, height: element2.height };
}
function rectSegments(rect) {
  const { x, y, width: w, height: h } = rect;
  return [
    [[x, y], [x + w, y]],
    [[x + w, y], [x + w, y + h]],
    [[x + w, y + h], [x, y + h]],
    [[x, y + h], [x, y]]
  ];
}
function pointInRect(point, rect) {
  return point[0] >= rect.x && point[0] <= rect.x + rect.width && point[1] >= rect.y && point[1] <= rect.y + rect.height;
}
function segmentsCross(a, b) {
  const [[ax, ay], [ax2, ay2]] = a;
  const [[bx, by], [bx2, by2]] = b;
  const orient = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const o1 = orient(ax, ay, ax2, ay2, bx, by);
  const o2 = orient(ax, ay, ax2, ay2, bx2, by2);
  const o3 = orient(bx, by, bx2, by2, ax, ay);
  const o4 = orient(bx, by, bx2, by2, ax2, ay2);
  const eps = 0.01;
  const opposite = (left, right) => left > eps && right < -eps || left < -eps && right > eps;
  if (opposite(o1, o2) && opposite(o3, o4)) return true;
  const onSegment = (px, py, qx, qy, rx, ry) => Math.abs(orient(px, py, qx, qy, rx, ry)) <= eps && rx >= Math.min(px, qx) - eps && rx <= Math.max(px, qx) + eps && ry >= Math.min(py, qy) - eps && ry <= Math.max(py, qy) + eps;
  if (Math.abs(o1) <= eps && onSegment(ax, ay, ax2, ay2, bx, by)) return true;
  if (Math.abs(o2) <= eps && onSegment(ax, ay, ax2, ay2, bx2, by2)) return true;
  if (Math.abs(o3) <= eps && onSegment(bx, by, bx2, by2, ax, ay)) return true;
  return Math.abs(o4) <= eps && onSegment(bx, by, bx2, by2, ax2, ay2);
}
function segmentHitsRect(segment, rect) {
  if (pointInRect(segment[0], rect) || pointInRect(segment[1], rect)) return true;
  return rectSegments(rect).some((edge) => segmentsCross(segment, edge));
}
function overlaps(a, b) {
  if (a === null || b === null) return null;
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > OVERLAP_EPSILON && height > OVERLAP_EPSILON ? { width, height, area: width * height } : null;
}
function arrowSegments(arrow) {
  if (arrow === null || arrow.type !== "arrow" || !finite(arrow.x) || !finite(arrow.y)) return [];
  const points = Array.isArray(arrow.points) ? arrow.points : [];
  const absolute = points.map((point) => [arrow.x + (finite(point?.[0]) ? point[0] : 0), arrow.y + (finite(point?.[1]) ? point[1] : 0)]);
  const segments = [];
  for (let index = 1; index < absolute.length; index += 1) segments.push([absolute[index - 1], absolute[index]]);
  return segments;
}
function labelBox(elements, element2) {
  const bound = elements.find((entry) => entry?.containerId === element2?.id && entry?.type === "text" && entry.isDeleted !== true);
  return bound === void 0 ? null : boxOf(bound);
}
function freeSpotFor(shape, shapes) {
  const width = Math.max(40, shape.width ?? 140);
  const height = Math.max(32, shape.height ?? 56);
  const others = shapes.filter((entry) => entry.id !== shape.id);
  for (let row = 0; row < 40; row += 1) {
    for (let column = 0; column < 12; column += 1) {
      const candidate = { x: 40 + column * 240, y: 40 + row * 128, width, height };
      if (!others.some((other) => overlaps(boxOf(other), candidate) !== null)) return { x: candidate.x, y: candidate.y };
    }
  }
  return { x: 40, y: 40 };
}
function layoutBounds(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element2 of drawn(elements)) {
    const box = boxOf(element2);
    if (box === null) continue;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0, empty: true };
  return { x: Math.floor(minX), y: Math.floor(minY), width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY), empty: false };
}
function finding(code, severity, elements, measure, message, repair = null) {
  return { code, severity, elements: elements.filter((value) => typeof value === "string" && value !== ""), measure, message, repair };
}
function shapeLabelFit(element2, label, box) {
  const maxWidth = innerTextWidth(element2.type, box.width);
  const maxHeight = innerTextHeight(element2.type, box.height);
  const longestWord = label.split(/\s+/).reduce((longest, word) => word.length > longest.length ? word : longest, "");
  const widestLine = Math.ceil(longestWord.length * 6.9);
  const maxChars = Math.max(4, Math.floor(maxWidth / 6.9));
  const lines = wrapLabel(label, maxChars);
  const neededHeight = Math.ceil(lines.length * LINE_NODE);
  return { maxWidth, maxHeight, widestLine, neededHeight, tooWide: widestLine > maxWidth + 1, tooTall: neededHeight > maxHeight + 1 };
}
function findingsOf(elements) {
  const list = drawn(elements);
  const shapes = list.filter(isShape);
  const arrows = list.filter(isArrow);
  const shapeById = new Map(shapes.map((shape) => [shape.id, shape]));
  const out = [];
  for (const shape of shapes) {
    const box = boxOf(shape);
    const label = labelOf(list, shape.id);
    if (label === "") {
      out.push(finding(
        "node_without_label",
        "low",
        [shape.id],
        { nodes: shapes.length },
        `${shape.id} has no label: a reader cannot tell what this box is.`,
        { op: "node.label", id: shape.id, label: "<name>" }
      ));
    } else if (box !== null) {
      const fit = shapeLabelFit(shape, label, box);
      const wanted = nodeSize(label, shape.type);
      if (fit.tooWide) {
        out.push(finding(
          "label_overflow",
          "high",
          [shape.id],
          { axis: "width", box: Math.round(box.width), needed: wanted.width },
          `${shape.id} is too narrow for its label: the longest word needs about ${fit.widestLine} px, the shape gives ${Math.round(fit.maxWidth)} px.`,
          { op: "node.resize", id: shape.id, width: wanted.width }
        ));
      }
      if (fit.tooTall) {
        out.push(finding(
          "label_overflow",
          "high",
          [shape.id],
          { axis: "height", box: Math.round(box.height), needed: wanted.height },
          `${shape.id} is too short for its wrapped label: it needs about ${fit.neededHeight} px of text height, the shape gives ${Math.round(fit.maxHeight)} px.`,
          { op: "node.resize", id: shape.id, height: wanted.height }
        ));
      }
    }
    if (box !== null && (box.x < 0 || box.y < 0)) {
      out.push(finding(
        "off_canvas",
        "low",
        [shape.id],
        { x: Math.round(box.x), y: Math.round(box.y) },
        `${shape.id} starts at a negative coordinate (${Math.round(box.x)}, ${Math.round(box.y)}); the picture begins off the page origin.`,
        { op: "node.move", id: shape.id, x: 40, y: 40 }
      ));
    }
  }
  for (let left = 0; left < shapes.length; left += 1) {
    for (let right = left + 1; right < shapes.length; right += 1) {
      const a = shapes[left];
      const b = shapes[right];
      const boxA = boxOf(a);
      const boxB = boxOf(b);
      if (boxA === null || boxB === null) continue;
      const overlap = overlaps(boxA, boxB);
      if (overlap !== null) {
        const spot = freeSpotFor(boxB, shapes);
        out.push(finding(
          "node_overlap",
          "high",
          [a.id, b.id],
          { overlapWidth: Math.round(overlap.width), overlapHeight: Math.round(overlap.height), area: Math.round(overlap.area) },
          `${a.id} and ${b.id} overlap by ${Math.round(overlap.width)}x${Math.round(overlap.height)} px.`,
          { op: "node.move", id: b.id, x: spot.x, y: spot.y }
        ));
      } else {
        const gapX = Math.max(boxA.x, boxB.x) - Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
        const gapY = Math.max(boxA.y, boxB.y) - Math.min(boxA.y + boxA.height, boxB.y + boxB.height);
        if (gapX >= 0 && gapY >= 0 && gapX < CLEARANCE && gapY < CLEARANCE) {
          out.push(finding(
            "node_too_close",
            "medium",
            [a.id, b.id],
            { gapX: Math.round(gapX), gapY: Math.round(gapY), clearance: CLEARANCE },
            `${a.id} and ${b.id} are only ${Math.round(Math.min(gapX, gapY))} px apart; ${CLEARANCE} px keeps the boxes readable.`,
            { op: "layout", direction: "LR" }
          ));
        }
      }
    }
  }
  const duplicateGroups = /* @__PURE__ */ new Map();
  for (const shape of shapes) {
    const label = labelOf(list, shape.id);
    if (label === "") continue;
    if (!duplicateGroups.has(label)) duplicateGroups.set(label, []);
    duplicateGroups.get(label).push(shape.id);
  }
  for (const [label, ids] of duplicateGroups) {
    if (ids.length < 2) continue;
    out.push(finding(
      "duplicate_label",
      "low",
      ids,
      { label, count: ids.length },
      `${ids.length} boxes carry the label "${label}"; a reader cannot tell them apart.`,
      { op: "node.label", id: ids[0], label: `${label} (${ids[0]})` }
    ));
  }
  if (shapes.length > 1) {
    const connected = /* @__PURE__ */ new Set();
    for (const arrow of arrows) {
      if (shapeById.has(arrow.startBinding?.elementId)) connected.add(arrow.startBinding.elementId);
      if (shapeById.has(arrow.endBinding?.elementId)) connected.add(arrow.endBinding.elementId);
    }
    for (const shape of shapes) {
      if (connected.has(shape.id)) continue;
      out.push(finding(
        "isolated_node",
        "low",
        [shape.id],
        { nodes: shapes.length },
        `${shape.id} has no arrow: it is drawn but not connected to the scheme.`,
        { op: "edge.add", from: shape.id, to: "<node>", label: "<verb>" }
      ));
    }
  }
  for (const arrow of arrows) {
    const start = arrow.startBinding?.elementId;
    const end = arrow.endBinding?.elementId;
    if (typeof start !== "string" || typeof end !== "string" || !shapeById.has(start) || !shapeById.has(end)) {
      out.push(finding(
        "edge_unbound",
        "high",
        [arrow.id],
        { start: start ?? null, end: end ?? null },
        `${arrow.id} is not attached to two boxes, so it will not follow them when they move.`,
        { op: "edge.add", from: start ?? "<node>", to: end ?? "<node>", label: labelOf(list, arrow.id) }
      ));
    } else if (start === end) {
      out.push(finding(
        "edge_self",
        "low",
        [arrow.id],
        { node: start },
        `${arrow.id} points from ${start} back to itself.`,
        { op: "element.delete", id: arrow.id }
      ));
    }
    if (labelOf(list, arrow.id) === "") {
      out.push(finding(
        "edge_without_label",
        "low",
        [arrow.id],
        {},
        `${arrow.id} has no label: the reader cannot tell what flows along it.`,
        { op: "edge.label", id: arrow.id, label: "<verb>" }
      ));
    }
    const segments = arrowSegments(arrow);
    for (const segment of segments) {
      for (const shape of shapes) {
        if (shape.id === start || shape.id === end) continue;
        const box = boxOf(shape);
        if (box !== null && segmentHitsRect(segment, box)) {
          out.push(finding(
            "edge_crosses_node",
            "medium",
            [arrow.id, shape.id],
            { at: { x: Math.round(segment[0][0]), y: Math.round(segment[0][1]) } },
            `${arrow.id} passes through the box ${shape.id}.`,
            { op: "layout", direction: "LR" }
          ));
        }
      }
    }
    const arrowLabel = labelBox(list, arrow);
    if (arrowLabel !== null) {
      for (const shape of shapes) {
        const box = boxOf(shape);
        if (box !== null && overlaps(arrowLabel, box) !== null) {
          out.push(finding(
            "edge_label_on_node",
            "high",
            [arrow.id, shape.id],
            { overlap: true },
            `The label of ${arrow.id} sits on the box ${shape.id}.`,
            { op: "layout", direction: "LR" }
          ));
        }
      }
    }
  }
  for (let left = 0; left < arrows.length; left += 1) {
    for (let right = left + 1; right < arrows.length; right += 1) {
      const a = arrows[left];
      const b = arrows[right];
      const endpointsOf = (arrow) => [arrow.startBinding?.elementId, arrow.endBinding?.elementId].filter((id) => typeof id === "string");
      const shared = endpointsOf(a).filter((id) => endpointsOf(b).includes(id));
      if (shared.length > 0) continue;
      const crossed = arrowSegments(a).some((one) => arrowSegments(b).some((two) => segmentsCross(one, two)));
      if (crossed) {
        out.push(finding(
          "edge_crossing",
          "medium",
          [a.id, b.id],
          { pair: [a.id, b.id] },
          `${a.id} and ${b.id} cross each other.`,
          { op: "layout", direction: "LR" }
        ));
      }
    }
  }
  const bounds = layoutBounds(elements);
  if (!bounds.empty && bounds.height > bounds.width * 2.5 && shapes.length > 2) {
    out.push(finding(
      "page_too_tall",
      "medium",
      [],
      { width: bounds.width, height: bounds.height, ratio: Math.round(bounds.height / bounds.width * 10) / 10 },
      `The page is ${bounds.width}x${bounds.height} px - a vertical column. A left-to-right flow reads better.`,
      { op: "layout", direction: "LR" }
    ));
  }
  return out.slice().sort((left, right) => {
    const bySeverity = (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9);
    if (bySeverity !== 0) return bySeverity;
    if (left.code !== right.code) return left.code < right.code ? -1 : 1;
    return left.elements.join(",").localeCompare(right.elements.join(","));
  });
}
function analyzeScene(scene) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  const findings = findingsOf(elements);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const entry of findings) counts[entry.severity] = (counts[entry.severity] ?? 0) + 1;
  const score = Math.max(0, 100 - findings.reduce((total, entry) => total + (PENALTY[entry.severity] ?? 0), 0));
  const shapes = elements.filter(isShape).length;
  const arrows = elements.filter(isArrow).length;
  const verdict = findings.length === 0 ? shapes === 0 ? "empty" : "clean" : score >= 85 ? "readable" : score >= 60 ? "crowded" : "broken";
  return { score, verdict, findings, counts: { ...counts, total: findings.length }, nodes: shapes, edges: arrows, bounds: layoutBounds(elements) };
}

// src/outline.mjs
var SHAPE_NAMES = { rectangle: "box", ellipse: "ellipse", diamond: "diamond" };
var MAX_GEOMETRY_ROWS = 120;
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
  const byId2 = new Map(shapes.map((shape) => [shape.id, labelOf(elements, shape.id) || shape.id]));
  const lines = [`page: ${page} \u2014 ${shapes.length} node(s), ${arrows.length} edge(s)`];
  for (const shape of shapes) {
    const label = labelOf(elements, shape.id);
    lines.push(`- [${SHAPE_NAMES[shape.type] ?? shape.type}] ${label === "" ? `(no label) ${shape.id}` : label}  ${shape.id}`);
  }
  for (const arrow of arrows) {
    const from = byId2.get(arrow.startBinding?.elementId) ?? arrow.startBinding?.elementId ?? "?";
    const to = byId2.get(arrow.endBinding?.elementId) ?? arrow.endBinding?.elementId ?? "?";
    const label = labelOf(elements, arrow.id);
    lines.push(`- ${from} -> ${to}${label === "" ? "" : `: ${label}`}  ${arrow.id}`);
  }
  const freeText = elements.filter((entry) => isFreeText(entry));
  for (const note of freeText) {
    const value = String(note.text ?? "").replace(/\n/g, " / ");
    lines.push(`- [note] ${value}  ${note.id}`);
  }
  if (shapes.length > 0) {
    lines.push("", "geometry (id x,y w x h):");
    for (const shape of shapes.slice(0, MAX_GEOMETRY_ROWS)) {
      lines.push(`- ${shape.id} ${Math.round(shape.x)},${Math.round(shape.y)} ${Math.round(shape.width)}x${Math.round(shape.height)}`);
    }
    if (shapes.length > MAX_GEOMETRY_ROWS) lines.push(`- \u2026 ${shapes.length - MAX_GEOMETRY_ROWS} more node(s)`);
    const bounds = layoutBounds(elements);
    lines.push(`page bounds: ${bounds.width}x${bounds.height} at ${bounds.x},${bounds.y}`);
  }
  const analysis = analyzeScene(scene);
  if (elements.length === 0) return lines;
  if (analysis.findings.length > 0) {
    lines.push("", `readability: ${analysis.score}/100 ${analysis.verdict} \u2014 ${analysis.findings.length} finding(s), see map_lint for repairs:`);
    for (const entry of analysis.findings.slice(0, 8)) {
      lines.push(`- [${entry.severity}] ${entry.code}${entry.elements.length === 0 ? "" : ` ${entry.elements.join(", ")}`}: ${entry.message}`);
    }
    if (analysis.findings.length > 8) lines.push(`- \u2026 ${analysis.findings.length - 8} more; call map_lint`);
  } else {
    lines.push("", `readability: ${analysis.score}/100 ${analysis.verdict}`);
  }
  return lines;
}
function hintsOf(scene) {
  return findingsOf(Array.isArray(scene?.elements) ? scene.elements : []).map((entry) => ({
    kind: entry.code,
    severity: entry.severity,
    elements: entry.elements,
    message: entry.message,
    repair: entry.repair
  }));
}
function geometryOf(elements, limit = MAX_GEOMETRY_ROWS) {
  return shapesOf(elements).slice(0, limit).map((shape) => {
    const label = labelOf(elements, shape.id);
    return {
      id: shape.id,
      kind: shape.type,
      x: Math.round(shape.x),
      y: Math.round(shape.y),
      width: Math.round(shape.width),
      height: Math.round(shape.height),
      ...label === "" ? {} : { label }
    };
  });
}
function readOutline(scene, page) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  const analysis = analyzeScene(scene);
  return {
    ok: true,
    page,
    format: "outline",
    nodes: shapesOf(elements).length,
    edges: elements.filter(isArrow).length,
    outline: outlineLines(scene, page).join("\n"),
    geometry: geometryOf(elements),
    readability: { score: analysis.score, verdict: analysis.verdict, counts: analysis.counts },
    hints: hintsOf(scene)
  };
}
function lintOutline(scene, page) {
  const analysis = analyzeScene(scene);
  return {
    ok: true,
    page,
    score: analysis.score,
    verdict: analysis.verdict,
    counts: analysis.counts,
    bounds: analysis.bounds,
    nodes: analysis.nodes,
    edges: analysis.edges,
    findings: analysis.findings
  };
}

// src/tidy.mjs
var ORIGIN_X = 40;
var ORIGIN_Y = 40;
var LABEL_MARGIN = 24;
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
function layeredOrder(elements, rank) {
  const shapes = shapesOf(elements);
  const order = new Map(shapes.map((shape, index) => [shape.id, index]));
  const layers = /* @__PURE__ */ new Map();
  for (const shape of shapes) {
    const level = rank.get(shape.id) ?? 0;
    if (!layers.has(level)) layers.set(level, []);
    layers.get(level).push(shape);
  }
  const preds = /* @__PURE__ */ new Map();
  const succs = /* @__PURE__ */ new Map();
  for (const arrow of arrowsOf(elements)) {
    const from = arrow.startBinding?.elementId;
    const to = arrow.endBinding?.elementId;
    if (!order.has(from) || !order.has(to) || from === to) continue;
    if (!preds.has(to)) preds.set(to, []);
    if (!succs.has(from)) succs.set(from, []);
    preds.get(to).push(from);
    succs.get(from).push(to);
  }
  const levels = [...layers.keys()].sort((left, right) => left - right);
  const position = /* @__PURE__ */ new Map();
  for (const level of levels) {
    layers.get(level).forEach((shape, index) => position.set(shape.id, index));
  }
  const barycentre = (shape, neighbours) => {
    const ids = neighbours.get(shape.id) ?? [];
    const known = ids.filter((id) => position.has(id));
    if (known.length === 0) return null;
    return known.reduce((total, id) => total + position.get(id), 0) / known.length;
  };
  const sortLayer = (layer, neighbours) => {
    layer.sort((left, right) => {
      const a = barycentre(left, neighbours);
      const b = barycentre(right, neighbours);
      if (a === null && b === null) return order.get(left.id) - order.get(right.id);
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b || order.get(left.id) - order.get(right.id);
    });
    layer.forEach((shape, index) => position.set(shape.id, index));
  };
  for (let pass = 0; pass < 4; pass += 1) {
    for (let index = 1; index < levels.length; index += 1) sortLayer(layers.get(levels[index]), preds);
    for (let index = levels.length - 2; index >= 0; index -= 1) sortLayer(layers.get(levels[index]), succs);
  }
  return { levels, layers };
}
function labelWidthByLevel(elements, rank) {
  const widths = /* @__PURE__ */ new Map();
  for (const arrow of arrowsOf(elements)) {
    const from = arrow.startBinding?.elementId;
    const to = arrow.endBinding?.elementId;
    if (!rank.has(from) || !rank.has(to)) continue;
    const level = rank.get(from);
    const width = textWidth(labelOf(elements, arrow.id));
    widths.set(level, Math.max(widths.get(level) ?? 0, width));
  }
  return widths;
}
function layoutElements(elements, options = {}) {
  const list = Array.isArray(elements) ? elements : [];
  const direction = options.direction === "TB" ? "TB" : "LR";
  const nodeGap = Number.isFinite(options.nodeGap) && options.nodeGap > 0 ? Math.round(options.nodeGap) : NODE_GAP;
  const baseLayerGap = Number.isFinite(options.layerGap) && options.layerGap > 0 ? Math.round(options.layerGap) : LAYER_GAP;
  const originX = Number.isFinite(options.originX) ? Math.round(options.originX) : ORIGIN_X;
  const originY = Number.isFinite(options.originY) ? Math.round(options.originY) : ORIGIN_Y;
  const shapes = shapesOf(list);
  const rank = ranksOf(list);
  const { levels, layers } = layeredOrder(list, rank);
  const labelWidths = labelWidthByLevel(list, rank);
  const placed = /* @__PURE__ */ new Map();
  let moved = 0;
  if (direction === "LR") {
    let cursorX = originX;
    for (const level of levels) {
      const column = layers.get(level);
      const boxes = column.map((shape) => ({ shape, box: buildNode({ id: shape.id, type: shape.type, label: labelOf(list, shape.id) }).shape }));
      const columnWidth = boxes.reduce((max, entry) => Math.max(max, entry.box.width), 0);
      let cursorY = originY;
      for (const entry of boxes) {
        const x = Math.round(cursorX + (columnWidth - entry.box.width) / 2);
        const y = Math.round(cursorY);
        if (Math.round(entry.shape.x) !== x || Math.round(entry.shape.y) !== y) moved += 1;
        placed.set(entry.shape.id, { id: entry.shape.id, x, y, width: entry.box.width, height: entry.box.height });
        cursorY += entry.box.height + nodeGap;
      }
      cursorX += columnWidth + Math.max(baseLayerGap, (labelWidths.get(level) ?? 0) + LABEL_MARGIN);
    }
  } else {
    let cursorY = originY;
    for (const level of levels) {
      const row = layers.get(level);
      const boxes = row.map((shape) => ({ shape, box: buildNode({ id: shape.id, type: shape.type, label: labelOf(list, shape.id) }).shape }));
      const rowHeight = boxes.reduce((max, entry) => Math.max(max, entry.box.height), 0);
      let cursorX = originX;
      for (const entry of boxes) {
        const x = Math.round(cursorX);
        const y = Math.round(cursorY + (rowHeight - entry.box.height) / 2);
        if (Math.round(entry.shape.x) !== x || Math.round(entry.shape.y) !== y) moved += 1;
        placed.set(entry.shape.id, { id: entry.shape.id, x, y, width: entry.box.width, height: entry.box.height });
        cursorX += entry.box.width + nodeGap;
      }
      cursorY += rowHeight + Math.max(baseLayerGap, (labelWidths.get(level) ?? 0) + LABEL_MARGIN);
    }
  }
  const relocated = list.map((element2) => {
    if (element2 === null || typeof element2 !== "object") return element2;
    const own = placed.get(element2.id);
    if (own !== void 0) return { ...element2, x: own.x, y: own.y, width: own.width, height: own.height };
    if (typeof element2.containerId === "string" && element2.type === "text") {
      const container = placed.get(element2.containerId);
      if (container !== void 0) {
        const width = Number.isFinite(element2.width) ? element2.width : container.width;
        const height = Number.isFinite(element2.height) ? element2.height : 20;
        return { ...element2, x: Math.round(container.x + (container.width - width) / 2), y: Math.round(container.y + (container.height - height) / 2) };
      }
    }
    return element2;
  });
  const byId2 = new Map(relocated.map((element2) => [element2?.id, element2]));
  const arrows = relocated.map((element2) => {
    if (element2?.type !== "arrow") return element2;
    const from = element2.startBinding?.elementId;
    const to = element2.endBinding?.elementId;
    const source = byId2.get(from);
    const target = byId2.get(to);
    if (source === void 0 || target === void 0 || !placed.has(from) || !placed.has(to)) return element2;
    const edge = buildEdge({ id: element2.id, label: labelOf(list, element2.id), from: source, to: target, strokeStyle: element2.strokeStyle });
    return { ...element2, x: edge.arrow.x, y: edge.arrow.y, points: edge.arrow.points, width: edge.arrow.width, height: edge.arrow.height };
  });
  const arrowText = /* @__PURE__ */ new Map();
  for (const element2 of arrows) {
    if (element2?.type !== "arrow") continue;
    const from = byId2.get(element2.startBinding?.elementId);
    const to = byId2.get(element2.endBinding?.elementId);
    if (from === void 0 || to === void 0 || !placed.has(from.id) || !placed.has(to.id)) continue;
    const label = labelOf(list, element2.id);
    if (label === "") continue;
    const edge = buildEdge({ id: element2.id, label, from, to, strokeStyle: element2.strokeStyle });
    if (edge.text !== null) arrowText.set(edge.text.id, edge.text);
  }
  const settled = arrows.map((element2) => {
    const replacement = element2?.type === "text" && typeof element2.containerId === "string" ? arrowText.get(element2.id) : void 0;
    if (replacement === void 0) return element2;
    return { ...element2, x: replacement.x, y: replacement.y, width: replacement.width, height: replacement.height, text: replacement.text, originalText: replacement.originalText };
  });
  return {
    elements: settled,
    moved,
    overlapsBefore: overlapPairs(shapes),
    overlapsAfter: overlapPairs(shapesOf(settled)),
    direction,
    layers: levels.length
  };
}
function tidyElements(elements, { originX = ORIGIN_X, originY = ORIGIN_Y } = {}) {
  const result = layoutElements(elements, { direction: "LR", originX, originY });
  return {
    elements: result.elements,
    moved: result.moved,
    overlapsBefore: result.overlapsBefore,
    overlapsAfter: result.overlapsAfter
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
var EDITED_CHROME_SELECTOR = [
  ".App-toolbar-container",
  ".App-menu_top",
  ".App-menu_bottom",
  // The bottom bar is `.App-bottom-bar` in 0.18.1; its footer repeats the `App-toolbar` class,
  // but the bar is the positioned island that floats over the drawing.
  ".App-bottom-bar",
  ".dropdown-menu-button",
  ".sidebar-trigger",
  ".main-menu-trigger",
  ".layer-ui__wrapper__top-right",
  // The footer carries the undo/redo pair and the zoom controls; it is a floating white bar
  // OVER the bottom of the drawing and covered the last row of the picture until it was added
  // here (measured 2026-11-27: the clean render still showed the undo/redo bar).
  ".layer-ui__wrapper__footer",
  ".HintViewer",
  ".help-icon",
  ".zoom-button"
].join(",");
var CLEAN_STYLE_ID = "designmap-clean-render";
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
    await tab.evaluate(({ selector, id }) => {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `${selector}{display:none!important}`;
      document.head.append(style);
    }, { selector: EDITED_CHROME_SELECTOR, id: CLEAN_STYLE_ID });
    await tab.waitForTimeout(150);
    const canvas = tab.locator(".excalidraw canvas").first();
    const box = await canvas.boundingBox();
    if (box === null) throw new MapRefusal("renderer_unavailable", "Excalidraw rendered no canvas to capture");
    await canvas.screenshot({ path: pngPath });
    await tab.evaluate((id) => {
      const style = document.getElementById(id);
      if (style !== null) style.remove();
    }, CLEAN_STYLE_ID);
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
      renderer: "excalidraw",
      // Evidence for the caller that the capture is the drawing and not the editor: the same
      // selector list is applied to the DOM before the screenshot.
      chromeHidden: true
    };
  } finally {
    await browser.close().catch(() => {
    });
  }
}

// src/ops.mjs
var OPS = /* @__PURE__ */ new Set([
  "node.add",
  "node.move",
  "node.resize",
  "node.label",
  "node.style",
  "edge.add",
  "edge.label",
  "element.delete",
  "page.create",
  "page.rename",
  "page.delete",
  "tidy",
  "layout",
  "diagram",
  "note.add",
  "align"
]);
var GAP = 48;
var CELL_WIDTH = 340;
var CELL_HEIGHT = 160;
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
function overlapsRect(a, b, margin = 0) {
  return a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin;
}
function shapesOn(elements) {
  return elements.filter((entry) => entry?.isDeleted !== true && SHAPES.has(entry?.type));
}
function freeCell(elements, size) {
  const width = Math.max(80, size?.width ?? 140);
  const height = Math.max(40, size?.height ?? 56);
  const shapes = shapesOn(elements);
  for (let row = 0; row < 40; row += 1) {
    for (let column = 0; column < 10; column += 1) {
      const candidate = { x: 40 + column * CELL_WIDTH, y: 40 + row * CELL_HEIGHT, width, height };
      if (!shapes.some((shape) => overlapsRect(shape, candidate, 16))) return { x: candidate.x, y: candidate.y };
    }
  }
  return { x: 40, y: 40 };
}
function spotBeside(elements, anchor, size, below = false) {
  const shapes = shapesOn(elements);
  if (below) {
    let y = anchor.y + anchor.height + GAP;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = { x: anchor.x, y, width: size.width, height: size.height };
      if (!shapes.some((shape) => overlapsRect(shape, candidate, 16))) return { x: candidate.x, y: candidate.y };
      y += Math.round(size.height + GAP);
    }
    return { x: anchor.x, y: anchor.y + anchor.height + GAP };
  }
  let x = anchor.x + anchor.width + GAP;
  for (let attempt = 0; attempt < 120 && x < 2400; attempt += 1) {
    const candidate = { x, y: anchor.y, width: size.width, height: size.height };
    if (!shapes.some((shape) => overlapsRect(shape, candidate, 16))) return { x: candidate.x, y: candidate.y };
    x += 32;
  }
  return { x: anchor.x, y: anchor.y + anchor.height + GAP };
}
function byId(elements) {
  return new Map(elements.filter((entry) => entry !== null && typeof entry === "object").map((entry) => [entry.id, entry]));
}
function reanchorArrows(elements) {
  const map = byId(elements);
  return elements.map((element2) => {
    if (element2?.type !== "arrow") return element2;
    const from = map.get(element2.startBinding?.elementId);
    const to = map.get(element2.endBinding?.elementId);
    if (from === void 0 || to === void 0 || !SHAPES.has(from.type) || !SHAPES.has(to.type)) return element2;
    const built = buildEdge({ id: element2.id, label: labelOf(elements, element2.id), from, to, strokeStyle: element2.strokeStyle });
    return {
      ...element2,
      x: built.arrow.x,
      y: built.arrow.y,
      width: built.arrow.width,
      height: built.arrow.height,
      points: built.arrow.points,
      boundElements: built.arrow.boundElements
    };
  });
}
function moveShapes(elements, moves) {
  const map = byId(elements);
  const moved = elements.map((element2) => {
    const target = moves.get(element2?.id);
    if (target !== void 0) return { ...element2, x: target.x, y: target.y };
    if (element2?.type === "text" && typeof element2.containerId === "string") {
      const source = map.get(element2.containerId);
      const destination = moves.get(element2.containerId);
      if (source !== void 0 && destination !== void 0) {
        return { ...element2, x: Math.round(element2.x + destination.x - source.x), y: Math.round(element2.y + destination.y - source.y) };
      }
    }
    return element2;
  });
  return reanchorArrows(moved);
}
function replaceShape(elements, shape, { label, width, height, type, growOnly = false }) {
  const text = label ?? labelOf(elements, shape.id);
  const wanted = nodeSize(text, type ?? shape.type);
  const built = buildNode({
    id: shape.id,
    type: type ?? shape.type,
    label: text,
    x: shape.x,
    y: shape.y,
    width: growOnly ? Math.max(shape.width, wanted.width) : width,
    height: growOnly ? Math.max(shape.height, wanted.height) : height
  });
  const nextShape = { ...built.shape, backgroundColor: shape.backgroundColor, strokeColor: shape.strokeColor, strokeStyle: shape.strokeStyle };
  const kept = elements.filter((entry) => entry.id !== shape.id && entry?.containerId !== shape.id);
  kept.push(nextShape);
  if (built.text !== null) kept.push(built.text);
  return reanchorArrows(kept);
}
function bindArrow(elements, arrow, fromId, toId) {
  return elements.map((element2) => {
    if (element2?.id !== fromId && element2?.id !== toId) return element2;
    const bound = Array.isArray(element2.boundElements) ? element2.boundElements.filter((entry) => entry?.id !== arrow.id) : [];
    return { ...element2, boundElements: [...bound, { type: "arrow", id: arrow.id }] };
  });
}
function removeElement(elements, id) {
  const attached = /* @__PURE__ */ new Set([id]);
  for (const element2 of elements) {
    if (element2?.type === "arrow" && (element2.startBinding?.elementId === id || element2.endBinding?.elementId === id)) attached.add(element2.id);
    if (element2?.type === "text" && attached.has(element2.containerId)) attached.add(element2.id);
  }
  return elements.filter((entry) => !attached.has(entry?.id)).map((entry) => Array.isArray(entry?.boundElements) ? { ...entry, boundElements: entry.boundElements.filter((bind) => !attached.has(bind?.id)) } : entry);
}
function applyLayout(elements, options, notes) {
  const result = layoutElements(elements, options);
  notes.push(`${result.direction} layout: ${result.moved} shape(s) moved, overlaps ${result.overlapsBefore} -> ${result.overlapsAfter}, ${result.layers} layer(s)`);
  return result.elements;
}
function countsOf(elements) {
  return { nodes: shapesOn(elements).length, edges: elements.filter((entry) => entry?.type === "arrow" && entry.isDeleted !== true).length };
}
function verdictOf(scene) {
  const analysis = analyzeScene(scene);
  return { score: analysis.score, verdict: analysis.verdict, counts: analysis.counts };
}
function resolveRef(refs, value, what) {
  if (typeof value !== "string" || value.trim() === "") throw new MapRefusal("unknown_node", `${what} names no node`);
  const exact = refs.get(value);
  if (exact !== void 0) return exact;
  const folded = refs.get(value.trim().toLowerCase());
  if (folded !== void 0) return folded;
  throw new MapRefusal("unknown_node", `${what} "${value}" is not one of the diagram's nodes`);
}
function applyOp(designmapDir, op) {
  const kind = typeof op?.op === "string" ? op.op : "";
  if (!OPS.has(kind)) {
    throw new MapRefusal("unknown_op", `"${kind}" is not one of ${[...OPS].join(", ")}`);
  }
  if (kind === "page.create") {
    createPage(designmapDir, op.page);
    return { ok: true, page: op.page, action: kind, nodes: 0, edges: 0, hints: [], readability: { score: 100, verdict: "empty", counts: { high: 0, medium: 0, low: 0, total: 0 } } };
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
  let created = null;
  if (kind === "node.add") {
    id = id ?? nextId(elements, "n");
    const label = String(op.label ?? "");
    const type = op.kind ?? op.shape ?? "rectangle";
    const size = nodeSize(label, ["ellipse", "diamond"].includes(type) ? type : "rectangle");
    let spot;
    if (Number.isFinite(op.x) && Number.isFinite(op.y)) spot = { x: op.x, y: op.y };
    else if (typeof op.from === "string") spot = spotBeside(elements, shapeOf(elements, op.from), size, op.below === true);
    else spot = freeCell(elements, size);
    const node = buildNode({ id, type, label, x: spot.x, y: spot.y, color: op.color });
    elements.push(node.shape);
    if (node.text !== null) elements.push(node.text);
  } else if (kind === "node.move") {
    const shape = shapeOf(elements, id);
    const x = Number.isFinite(op.x) ? op.x : shape.x;
    const y = Number.isFinite(op.y) ? op.y : shape.y;
    elements = moveShapes(elements, /* @__PURE__ */ new Map([[id, { x, y }]]));
  } else if (kind === "node.resize") {
    const shape = shapeOf(elements, id);
    const width = Number.isFinite(op.width) && op.width > 0 ? op.width : shape.width;
    const height = Number.isFinite(op.height) && op.height > 0 ? op.height : shape.height;
    elements = replaceShape(elements, shape, { width, height });
  } else if (kind === "node.label") {
    elements = replaceShape(elements, shapeOf(elements, id), { label: String(op.label ?? ""), growOnly: true });
  } else if (kind === "node.style") {
    const shape = shapeOf(elements, id);
    const backgroundColor = typeof op.color === "string" && op.color.startsWith("#") ? op.color : colorOf(op.color, shape.backgroundColor);
    elements = elements.map((entry) => entry.id === id ? { ...entry, backgroundColor } : entry);
  } else if (kind === "edge.add") {
    id = id ?? nextId(elements, "e");
    const from = shapeOf(elements, op.from);
    const to = shapeOf(elements, op.to);
    const edge = buildEdge({ id, label: op.label ?? "", from, to, strokeStyle: op.style === "dashed" ? "dashed" : "solid" });
    elements = bindArrow(elements, edge.arrow, from.id, to.id);
    elements.push(edge.arrow);
    if (edge.text !== null) elements.push(edge.text);
  } else if (kind === "edge.label") {
    const arrow = arrowOf(elements, id);
    const from = elements.find((entry) => entry.id === arrow.startBinding?.elementId);
    const to = elements.find((entry) => entry.id === arrow.endBinding?.elementId);
    elements = elements.filter((entry) => !(entry?.type === "text" && entry.containerId === arrow.id));
    const index = elements.findIndex((entry) => entry.id === arrow.id);
    if (from === void 0 || to === void 0) {
      notes.push("edge label skipped: the arrow has no bound endpoint");
      if (index >= 0) elements[index] = { ...arrow, boundElements: [] };
    } else {
      const edge = buildEdge({ id: arrow.id, label: String(op.label ?? ""), from, to, strokeStyle: arrow.strokeStyle });
      if (index >= 0) elements[index] = edge.arrow;
      if (edge.text !== null) elements.push(edge.text);
    }
  } else if (kind === "element.delete") {
    const ids = Array.isArray(op.ids) ? op.ids : [id];
    for (const target of ids) {
      if (typeof target !== "string" || target === "") continue;
      elements = removeElement(elements, target);
    }
  } else if (kind === "note.add") {
    id = id ?? nextId(elements, "t");
    const text = String(op.text ?? op.label ?? "");
    const note = buildNote({ id, text, x: Number.isFinite(op.x) ? op.x : 40, y: Number.isFinite(op.y) ? op.y : 40, fontSize: op.fontSize, color: op.color });
    if (!Number.isFinite(op.x) && !Number.isFinite(op.y)) {
      const spot = freeCell(elements, note);
      note.x = spot.x;
      note.y = spot.y;
    }
    elements.push(note);
  } else if (kind === "tidy") {
    const result = tidyElements(elements);
    elements = result.elements;
    notes = notes.concat([`overlaps ${result.overlapsBefore} -> ${result.overlapsAfter}`, `${result.moved} shape(s) moved`]);
  } else if (kind === "layout") {
    elements = applyLayout(elements, {
      direction: op.direction === "TB" ? "TB" : "LR",
      nodeGap: op.nodeGap,
      layerGap: op.layerGap,
      originX: op.x,
      originY: op.y
    }, notes);
  } else if (kind === "diagram") {
    if (op.replace === true) elements = [];
    const specs = Array.isArray(op.nodes) ? op.nodes : [];
    if (specs.length === 0) throw new MapRefusal("invalid_diagram", "diagram needs at least one node");
    const refs = /* @__PURE__ */ new Map();
    const nodeIds = [];
    for (const spec of specs) {
      const nodeId = typeof spec?.id === "string" && spec.id !== "" ? spec.id : nextId(elements, "n");
      if (elements.some((entry) => entry?.id === nodeId)) throw new MapRefusal("duplicate_id", `node id "${nodeId}" already exists on this page`);
      const node = buildNode({ id: nodeId, type: spec?.kind ?? "rectangle", label: spec?.label ?? "", x: 0, y: 0, color: spec?.color });
      elements.push(node.shape);
      if (node.text !== null) elements.push(node.text);
      refs.set(nodeId, nodeId);
      const label = String(spec?.label ?? "").trim();
      if (label !== "") refs.set(label.toLowerCase(), nodeId);
      nodeIds.push(nodeId);
    }
    const edgeIds = [];
    for (const spec of Array.isArray(op.edges) ? op.edges : []) {
      const fromId = resolveRef(refs, spec?.from, "edge.from");
      const toId = resolveRef(refs, spec?.to, "edge.to");
      const edgeId = typeof spec?.id === "string" && spec.id !== "" ? spec.id : nextId(elements, "e");
      const from = shapeOf(elements, fromId);
      const to = shapeOf(elements, toId);
      const edge = buildEdge({ id: edgeId, label: spec?.label ?? "", from, to, strokeStyle: spec?.style === "dashed" ? "dashed" : "solid" });
      elements = bindArrow(elements, edge.arrow, fromId, toId);
      elements.push(edge.arrow);
      if (edge.text !== null) elements.push(edge.text);
      edgeIds.push(edgeId);
    }
    elements = applyLayout(elements, {
      direction: op.direction === "TB" ? "TB" : "LR",
      nodeGap: op.nodeGap,
      layerGap: op.layerGap,
      originX: Number.isFinite(op.x) ? op.x : void 0,
      originY: Number.isFinite(op.y) ? op.y : void 0
    }, notes);
    created = { nodes: nodeIds, edges: edgeIds };
    id = void 0;
  } else if (kind === "align") {
    const mode = typeof op.mode === "string" ? op.mode : "left";
    const shapes = Array.isArray(op.ids) && op.ids.length > 0 ? op.ids.map((target) => shapeOf(elements, target)) : shapesOn(elements);
    if (shapes.length < 2) throw new MapRefusal("too_few_nodes", "align needs at least two boxes");
    const moves = /* @__PURE__ */ new Map();
    if (mode === "left") {
      const x = Math.min(...shapes.map((shape) => shape.x));
      for (const shape of shapes) moves.set(shape.id, { x, y: shape.y });
    } else if (mode === "right") {
      const edge = Math.max(...shapes.map((shape) => shape.x + shape.width));
      for (const shape of shapes) moves.set(shape.id, { x: edge - shape.width, y: shape.y });
    } else if (mode === "top") {
      const y = Math.min(...shapes.map((shape) => shape.y));
      for (const shape of shapes) moves.set(shape.id, { x: shape.x, y });
    } else if (mode === "center-x") {
      const center = shapes.reduce((total, shape) => total + shape.x + shape.width / 2, 0) / shapes.length;
      for (const shape of shapes) moves.set(shape.id, { x: Math.round(center - shape.width / 2), y: shape.y });
    } else if (mode === "center-y") {
      const center = shapes.reduce((total, shape) => total + shape.y + shape.height / 2, 0) / shapes.length;
      for (const shape of shapes) moves.set(shape.id, { x: shape.x, y: Math.round(center - shape.height / 2) });
    } else if (mode === "distribute-x" || mode === "distribute-y") {
      const horizontal = mode === "distribute-x";
      const sorted = shapes.slice().sort((left, right) => horizontal ? left.x - right.x : left.y - right.y);
      const first = horizontal ? sorted[0].x : sorted[0].y;
      const last = horizontal ? sorted[sorted.length - 1].x : sorted[sorted.length - 1].y;
      const step = (last - first) / (sorted.length - 1);
      sorted.forEach((shape, index) => moves.set(shape.id, horizontal ? { x: Math.round(first + step * index), y: shape.y } : { x: shape.x, y: Math.round(first + step * index) }));
    } else {
      throw new MapRefusal("unknown_mode", `align mode "${mode}" is not one of left, right, top, center-x, center-y, distribute-x, distribute-y`);
    }
    elements = moveShapes(elements, moves);
  }
  scene.elements = elements;
  writePage(designmapDir, op.page, scene);
  const counts = countsOf(elements);
  return {
    ok: true,
    page: op.page,
    action: kind,
    ...id === void 0 ? {} : { id },
    ...counts,
    ...created === null ? {} : { created },
    hints: hintsOf(scene),
    readability: verdictOf(scene),
    notes
  };
}
async function renderPage(designmapDir, page) {
  const scene = readPage(designmapDir, page);
  const outDir = join3(designmapDir, "out");
  const rendered = await renderWithExcalidraw(Array.isArray(scene.elements) ? scene.elements : [], outDir, page);
  return { ok: true, page, ...rendered, readability: verdictOf(scene) };
}

// src/command.mjs
var OPS2 = ["pages", "page", "save", "tidy-page", "render-page", "lint", "edit"];
var REPAIR_OPS = /* @__PURE__ */ new Set(["node.move", "node.resize", "node.label", "node.style", "edge.label", "element.delete", "layout", "tidy", "align"]);
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
        // The panel's "Check" button: the same readability report map_lint returns, so the
        // human and the agent read the same findings about the same file.
        case "lint":
          value = lintOutline(readPage(designmapDir, op.page), op.page);
          break;
        // One repair from the panel's finding list: the operation a finding carries is the SAME
        // map_get/map_edit op the agent would send, validated against that op set.
        case "edit": {
          const operation = op.operation;
          if (operation === null || typeof operation !== "object" || typeof operation.op !== "string" || !OPS.has(operation.op) || !REPAIR_OPS.has(operation.op)) {
            return { kind: "error", text: "designmap: invalid_operation: edit needs an operation with a map op name" };
          }
          value = applyOp(designmapDir, operation);
          break;
        }
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
var boolean = (description) => ({ type: "boolean", description });
var enums = (values, description, required = false) => ({ type: "string", enum: values, description, ...required ? { required: true } : {} });
var objects = (properties, description) => ({ type: "array", description, items: { type: "object", properties, additionalProperties: false } });
var SHAPE_KINDS = ["rectangle", "ellipse", "diamond"];
var ALIGN_MODES = ["left", "right", "top", "center-x", "center-y", "distribute-x", "distribute-y"];
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
    description: 'Read one page before changing it. The default outline lists every node (`- [box] Checkout API  n1`), every edge (`- CLI -> API: asks  e1`), a compact geometry table (id x,y w x h), the page bounds and the readability verdict (`62/100 crowded`). `format:"json"` returns the exact scene. Read-only; never refuses a crowded page.',
    parameters: {
      page: string("Page name (the file name without .excalidraw).", true),
      format: enums(["outline", "json"], "outline (default) or json for exact positions.")
    },
    call: ({ designmapDir }, args) => {
      const scene = readPage(designmapDir, args.page);
      const read = readOutline(scene, args.page);
      if (args.format === "json") {
        return { ...read, format: "json", elements: scene.elements, appState: scene.appState ?? {}, hints: hintsOf(scene) };
      }
      return read;
    }
  },
  {
    name: "map_lint",
    description: "Check how readable one page is, before and after drawing it. Returns a score (100 clean; below 60 broken), a verdict, and every finding with the ids it measured, the measured value and a `repair` you can send to map_edit unchanged: node_overlap, label_overflow (the text does not fit the shape's inscribed area), edge_label_on_node, edge_crosses_node, edge_crossing, node_too_close, edge_unbound, edge_without_label, node_without_label, isolated_node, duplicate_label, page_too_tall, off_canvas. A low score is a report, never a refusal: a crowded page still opens and still saves.",
    parameters: {
      page: string("Page name to check.", true),
      severity: enums(["high", "medium", "low"], "Only findings of this severity or worse.")
    },
    call: ({ designmapDir }, args) => {
      const report = lintOutline(readPage(designmapDir, args.page), args.page);
      if (args.severity === void 0 || args.severity === "") return report;
      const rank = { high: 0, medium: 1, low: 2 };
      const limit = rank[args.severity] ?? 2;
      return { ...report, findings: report.findings.filter((entry) => (rank[entry.severity] ?? 3) <= limit) };
    }
  },
  {
    name: "map_edit",
    description: 'Draw or repair one page with ONE op. Draw a whole scheme with op "diagram" in one call: nodes [{id?, label, kind?, color?}] and edges [{from, to, label?, style?}] - "from"/"to" accept a node id or its label; then it lays the page out (direction "LR" default, "TB" for top-down) with the edge labels in the gaps. Example: {"op":"diagram","page":"system","nodes":[{"label":"CLI"},{"label":"Orchestrator"},{"label":"Taskboard"}],"edges":[{"from":"CLI","to":"Orchestrator","label":"asks"},{"from":"Orchestrator","to":"Taskboard","label":"writes"}]}. Repair with op "layout" (direction), "tidy" (left-to-right), "align" (mode), or single ops: node.add (label/kind/color; x/y omitted = a free spot in the flow; from = beside that node), node.move, node.resize, node.label, node.style, edge.add (from/to ids), edge.label, note.add (text), element.delete (id or ids), page.create, page.rename, page.delete. You pass labels and places, never seeds, versions or bindings. Only unknown_page, unknown_node and a bad diagram reference are refused.',
    parameters: {
      page: string("Page name; for page.create the page to create, for page.rename the current name.", true),
      op: { type: "string", enum: [...OPS], required: true, description: "The op to apply." },
      id: string("Element id returned by map_read (node ops, edge.label, element.delete). Omitted on node.add/edge.add/note.add: a new id is returned."),
      ids: { type: "array", items: { type: "string" }, description: "Several element ids (element.delete) or the shapes to align (align)." },
      label: string("Node or edge label (node.add, node.label, edge.add, edge.label)."),
      text: string("Note text (note.add)."),
      x: number("Page x for node.add, node.move, note.add, layout/diagram origin."),
      y: number("Page y for node.add, node.move, note.add, layout/diagram origin."),
      width: number("Node width (node.resize)."),
      height: number("Node height (node.resize)."),
      from: string("Source node id (edge.add), or the node to place the new one beside (node.add). In diagram edges, a node id or label."),
      to: string("Target node id (edge.add) or the new page name (page.rename). In diagram edges, a node id or label."),
      kind: enums(SHAPE_KINDS, "Shape of a new node (node.add, diagram nodes). Default rectangle."),
      color: string("Fill colour: a name (blue, green, red, yellow, violet, grey, white, none) or #rrggbb (node.add, node.style, diagram nodes)."),
      fontSize: number("Note font size (note.add), default 16."),
      style: enums(["solid", "dashed"], "Arrow line style (edge.add, diagram edges). Default solid."),
      mode: enums(ALIGN_MODES, "How to align the selected boxes (align)."),
      direction: enums(["LR", "TB"], "Layout direction for diagram/LR by default; TB stacks the layers top to bottom."),
      nodeGap: number("Gap between boxes inside a layer (layout, diagram). Default 48."),
      layerGap: number("Gap between layers (layout, diagram). Default 96, raised to fit the widest edge label."),
      below: boolean("Place a new node UNDER the node named by from instead of to its right (node.add)."),
      replace: boolean("diagram only: clear the page before drawing the new scheme."),
      nodes: objects({
        id: string("Optional node id."),
        label: string("Node label."),
        kind: enums(SHAPE_KINDS, "Shape."),
        color: string("Fill colour: a name (blue, green, red, yellow, violet, grey, white, none) or #rrggbb.")
      }, "diagram only: the nodes of the scheme, in reading order."),
      edges: objects({
        id: string("Optional edge id."),
        from: string("Source node id or label."),
        to: string("Target node id or label."),
        label: string("Edge label."),
        style: enums(["solid", "dashed"], "Line style.")
      }, "diagram only: the arrows of the scheme.")
    },
    call: ({ designmapDir }, args) => applyOp(designmapDir, { ...args, newPage: args.to_page ?? args.newPage })
  },
  {
    name: "map_render",
    description: "Render one page to a picture with Excalidraw itself in a headless browser: designmap/out/<page>.png (read it with read_image) and designmap/out/<page>.svg (Excalidraw's own export), framed to the page bounds with the editor toolbar and menu hidden - the picture shows the drawing only. Use it after map_lint to see what the human will see. Refuses renderer_unavailable when no browser is present.",
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
