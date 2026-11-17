import { createRequire as __designmapCreateRequire } from 'node:module';const require = __designmapCreateRequire(import.meta.url);
import {
  EDGE_LABEL_FONT_SIZE,
  EDGE_LABEL_LINE_HEIGHT,
  applyToWorkspace,
  boxesWithinGap,
  createLogger,
  findFreeSpot,
  isHexColour,
  labelBoxOf,
  paletteFor,
  renderAll,
  renderView,
  selectView,
  wrapEdgeLabel
} from "./chunk-APSIGH2O.mjs";
import {
  canonicalModel,
  createWorkspace,
  sha256,
  toJson
} from "./chunk-45OXK2TV.mjs";
import {
  DIRECTIONS,
  DesignmapRefusal,
  EDGE_KINDS,
  NODE_TYPES,
  REFUSALS,
  VIEW_LEVELS
} from "./chunk-MQWKWIN2.mjs";

// index.js
import { join as join3 } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/host.mjs
import { appendFileSync, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { basename, dirname as dirname2, isAbsolute as isAbsolute2, join as join2, relative as relative2, resolve as resolve2 } from "node:path";

// src/manifest.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
var MANIFEST_FILE = "manifest.json";
var MANIFEST_SCHEMA_VERSION = 1;
var SEED_SCENE_FILE = "design.excalidraw";
function hashFile(path) {
  if (!existsSync(path)) return null;
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}
function resolveSource(repoRoot, source) {
  if (typeof source !== "string" || source === "") return null;
  const absolute = resolve(repoRoot, source);
  const rel = relative(repoRoot, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return absolute;
}
function sourceHashes(model, repoRoot) {
  const hashes = {};
  for (const node of model.nodes) {
    if (node.source === null || node.source === void 0) continue;
    const absolute = resolveSource(repoRoot, node.source);
    hashes[node.id] = absolute === null ? null : hashFile(absolute);
  }
  return hashes;
}
function modelContentHash(model) {
  return sha256(toJson(canonicalModel(model)));
}
function seedRevision(repoRoot) {
  const path = join(repoRoot, SEED_SCENE_FILE);
  if (!existsSync(path)) return 0;
  try {
    const rev = JSON.parse(readFileSync(path, "utf8"))?.designMap?.rev;
    return Number.isSafeInteger(rev) && rev >= 0 ? rev : 0;
  } catch {
    return 0;
  }
}
function nextRevision({ previous, modelHash, changed = false, seed = () => 0 }) {
  const previousRev = Number.isSafeInteger(previous?.rev) && previous.rev >= 0 ? previous.rev : null;
  if (previousRev === null) return seed() + (changed ? 1 : 0);
  if (typeof previous?.modelHash === "string" && previous.modelHash !== "") {
    return previous.modelHash === modelHash ? previousRev : previousRev + 1;
  }
  return previousRev + (changed ? 1 : 0);
}
function buildManifest({ model, repoRoot, commit, generatedAt, previous = null, changed = false }) {
  const modelHash = modelContentHash(model);
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    // The retired scene is read ONLY when there is no revision to continue: an ordinary
    // apply must not touch it at all.
    rev: nextRevision({ previous, modelHash, changed, seed: () => seedRevision(repoRoot) }),
    commit: commit ?? null,
    generatedAt,
    modelHash,
    sourceHashes: sourceHashes(model, repoRoot)
  };
}
function readManifest(designmapDir) {
  const path = join(designmapDir, MANIFEST_FILE);
  if (!existsSync(path)) return { manifest: null, text: null, path, missing: true };
  const text = readFileSync(path, "utf8");
  try {
    const manifest = JSON.parse(text);
    return { manifest, text, path, missing: false };
  } catch (error) {
    return { manifest: null, text, path, missing: false, malformed: error.message };
  }
}
function sameManifestContent(left, right) {
  if (left === null || right === null) return left === right;
  const strip = (manifest) => JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    rev: manifest.rev ?? 0,
    commit: manifest.commit ?? null,
    modelHash: manifest.modelHash ?? null,
    sourceHashes: Object.fromEntries(Object.entries(manifest.sourceHashes ?? {}).sort(([a], [b]) => a < b ? -1 : 1))
  });
  return strip(left) === strip(right);
}
function writeManifest(designmapDir, manifest) {
  const path = join(designmapDir, MANIFEST_FILE);
  const text = `${JSON.stringify(manifest, null, 2)}
`;
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (existing === text) return { path, written: false };
  try {
    const current = existing === null ? null : JSON.parse(existing);
    if (sameManifestContent(current, manifest)) return { path, written: false };
  } catch {
  }
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, text, "utf8");
  renameSync(temporary, path);
  return { path, written: true };
}

// src/git.mjs
import { execFileSync } from "node:child_process";
var COMMIT = /^[0-9a-f]{7,40}$/u;
var GitError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "GitError";
    this.code = "git_unavailable";
    this.cause = cause;
  }
};
function isCommit(value) {
  return typeof value === "string" && COMMIT.test(value);
}
function createGit({ cwd, run }) {
  const execute = run ?? ((args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const call = (args) => {
    try {
      return String(execute(args)).trim();
    } catch (error) {
      throw new GitError(`git ${args.join(" ")} failed: ${error?.message ?? error}`, error);
    }
  };
  return {
    cwd,
    head() {
      const value = call(["rev-parse", "HEAD"]);
      return isCommit(value) ? value : null;
    },
    /** Commits HEAD is ahead of `commit`; null when the manifest commit is unknown. */
    commitBehind(commit) {
      if (!isCommit(commit)) return null;
      try {
        const value = call(["rev-list", "--count", `${commit}..HEAD`]);
        return Number.parseInt(value, 10);
      } catch {
        return null;
      }
    },
    /**
     * Changes since `commit`: committed diffs, working-tree edits AND untracked files
     * (`git diff` alone hides untracked, which is exactly the new-file case scan must
     * propose).
     */
    diffNameStatus(commit) {
      const revision = isCommit(commit) ? commit : "HEAD";
      const text = call(["diff", "--name-status", revision, "--"]);
      const entries = text === "" ? [] : text.split("\n").map((line) => {
        const parts = line.split("	");
        return { status: parts[0], path: parts[1], from: parts[2] ?? null };
      }).filter((entry) => entry.path !== void 0);
      const known = new Set(entries.map((entry) => entry.path));
      const untracked = call(["ls-files", "--others", "--exclude-standard"]);
      if (untracked !== "") {
        for (const path of untracked.split("\n")) {
          if (path !== "" && !known.has(path)) entries.push({ status: "A", path, from: null });
        }
      }
      return entries;
    }
  };
}

// src/host.mjs
import { spawnSync } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";

// src/svg.mjs
function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function num(value) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";
}
function textLines(label, x, y, lineHeight = 16) {
  const lines = String(label ?? "").split("\n");
  const start = y - (lines.length - 1) * lineHeight / 2;
  return lines.map((line, index) => `<tspan x="${x}" y="${num(start + index * lineHeight)}">${escapeXml(line)}</tspan>`).join("");
}
function sceneToSvg(scene, { colours = /* @__PURE__ */ new Map() } = {}) {
  const { canvas } = scene;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${num(canvas.width)}" height="${num(canvas.height)}" viewBox="${num(canvas.x)} ${num(canvas.y)} ${num(canvas.width)} ${num(canvas.height)}" role="img" aria-label="${escapeXml(scene.title || scene.viewId)}">`);
  parts.push('<defs><marker id="designmap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/></marker></defs>');
  parts.push(`<rect class="canvas" x="${num(canvas.x)}" y="${num(canvas.y)}" width="${num(canvas.width)}" height="${num(canvas.height)}" fill="#ffffff"/>`);
  if (scene.title !== "") {
    parts.push(`<text class="title" x="${num(canvas.x + 12)}" y="${num(canvas.y + 24)}" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="600" fill="#0f172a">${escapeXml(scene.title)}</text>`);
  }
  for (const group of scene.groups) {
    parts.push(`<g class="group" data-group-id="${escapeXml(group.id)}">`);
    parts.push(`<rect x="${num(group.x)}" y="${num(group.y)}" width="${num(group.w)}" height="${num(group.h)}" rx="8" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>`);
    if (group.label !== "") {
      parts.push(`<text x="${num(group.x + 10)}" y="${num(group.y + 20)}" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" fill="#475569">${escapeXml(group.label)}</text>`);
    }
    parts.push("</g>");
  }
  for (const edge of scene.edges) {
    if (edge.points.length < 2) continue;
    const points = edge.points.map((point) => `${num(point.x)},${num(point.y)}`).join(" ");
    parts.push(`<g class="edge" data-edge-id="${escapeXml(edge.id)}" data-kind="${escapeXml(edge.kind)}">`);
    parts.push(`<polyline points="${points}" fill="none" stroke="#475569" stroke-width="1.6" marker-end="url(#designmap-arrow)"/>`);
    if (edge.label !== "") {
      const box = labelBoxOf(edge);
      const lines = Array.isArray(edge.labelLines) && edge.labelLines.length > 0 ? edge.labelLines : wrapEdgeLabel(edge.label);
      const centreX = box.x + box.w / 2;
      const startY = box.y + box.h / 2 - (lines.length - 1) * EDGE_LABEL_LINE_HEIGHT / 2;
      parts.push(`<g class="edge-label" data-edge-id="${escapeXml(edge.id)}">`);
      parts.push(`<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="4" fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>`);
      parts.push(`<text x="${num(centreX)}" y="${num(startY)}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, system-ui, sans-serif" font-size="${EDGE_LABEL_FONT_SIZE}" fill="#334155">${lines.map((line, index) => `<tspan x="${num(centreX)}" y="${num(startY + index * EDGE_LABEL_LINE_HEIGHT)}">${escapeXml(line)}</tspan>`).join("")}</text>`);
      parts.push("</g>");
    }
    parts.push("</g>");
  }
  for (const node of scene.nodes) {
    const palette = paletteFor(node.type);
    const overlay = colours.get(node.id) ?? {};
    const fill = overlay.fill ?? palette.fill;
    const stroke = overlay.stroke ?? palette.stroke;
    const centreX = node.x + node.w / 2;
    const centreY = node.y + node.h / 2;
    parts.push(`<g class="node" data-node-id="${escapeXml(node.id)}" data-type="${escapeXml(node.type)}">`);
    parts.push(`<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.w)}" height="${num(node.h)}" rx="6" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="1.5"/>`);
    parts.push(`<text x="${num(centreX)}" y="${num(centreY)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" fill="#0f172a">${textLines(node.label, centreX, centreY)}</text>`);
    parts.push("</g>");
  }
  parts.push("</svg>");
  return `${parts.join("\n")}
`;
}

// src/host.mjs
var LOG_FILE = "events.jsonl";
var MAX_ANNOTATIONS = 200;
var ANNOTATION_TYPES = /* @__PURE__ */ new Set(["rectangle", "ellipse", "diamond", "arrow", "line", "text", "freedraw"]);
var DEFAULT_SCAN_ROOTS = ["src"];
var DEFAULT_SCAN_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".py", ".go", ".sql"];
var TYPE_RULES = [
  [/(^|\/)(db|database|datastore|storage|schema)\//u, "datastore"],
  [/(^|\/)(queue|kafka|bus|topic)\//u, "queue"],
  [/(^|\/)(worker|workers|job|jobs|consumer)\//u, "worker"],
  [/(^|\/)(ui|web|client|frontend|components?)\//u, "frontend"],
  [/(^|\/)(external|vendor|third_party|stub)\//u, "external"]
];
function createFileLogger(designmapDir) {
  if (!existsSync2(designmapDir)) return { logger: createLogger(), path: null };
  const dir = join2(designmapDir, "logs");
  mkdirSync2(dir, { recursive: true });
  const path = join2(dir, LOG_FILE);
  const logger = createLogger((line) => appendFileSync(path, line));
  return { logger, path };
}
function proposalFor(path) {
  const withoutExtension = path.replace(/\.[^./]+$/u, "");
  const id = withoutExtension.replace(/[^A-Za-z0-9_.-]+/gu, ".").replace(/\.+/gu, ".").replace(/^[.-]+/u, "");
  const stem = basename(withoutExtension);
  const label = stem.split(/[-_.]+/u).filter(Boolean).map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ") || id;
  const type = TYPE_RULES.find(([pattern]) => pattern.test(path))?.[1] ?? "service";
  return { kind: "node", action: "upsert", value: { id, type, label, group: null, source: path } };
}
function extensionOf(path) {
  const match = /\.[^./]+$/u.exec(path);
  return match === null ? "" : match[0];
}
function nodeIdsBySource(model) {
  const map = /* @__PURE__ */ new Map();
  for (const node of model.nodes) {
    if (node.source === null || node.source === void 0) continue;
    const list = map.get(node.source) ?? [];
    list.push(node.id);
    map.set(node.source, list);
  }
  return map;
}
var PNG_CONVERTERS = Object.freeze(["rsvg-convert", "convert", "magick"]);
function resolveExecutable(command, pathEnv = process.env.PATH ?? "") {
  if (command.includes("/") || isAbsolute2(command)) return existsSync2(command) ? command : null;
  for (const directory of pathEnv.split(":")) {
    if (directory === "") continue;
    const candidate = join2(directory, command);
    if (existsSync2(candidate)) return candidate;
  }
  return null;
}
function findPngConverter({ env = process.env } = {}) {
  const configured = env.DESIGNMAP_PNG_CONVERTER;
  if (typeof configured === "string" && configured !== "") {
    const resolved = resolveExecutable(configured, env.PATH);
    return resolved === null ? { missing: configured } : { command: resolved, configured: true };
  }
  for (const candidate of PNG_CONVERTERS) {
    const resolved = resolveExecutable(candidate, env.PATH);
    if (resolved !== null) return { command: resolved, configured: false };
  }
  return null;
}
function createHostService({ designmapDir, repoRoot, git, clock = () => /* @__PURE__ */ new Date(), logger } = {}) {
  const dir = resolve2(designmapDir);
  const root = resolve2(repoRoot ?? dirname2(dir));
  const workspace = createWorkspace(dir);
  const gitRunner = git ?? createGit({ cwd: root });
  const now = () => clock().toISOString();
  const log = (event, fields) => logger?.log(event, fields);
  const head = () => {
    try {
      return gitRunner.head();
    } catch (error) {
      if (error instanceof GitError) return null;
      throw error;
    }
  };
  const status = () => {
    const model = workspace.readModel().model;
    const warnings = [];
    const read = readManifest(dir);
    const headCommit = head();
    const staleNodes = [];
    let commit = null;
    let commitBehind = null;
    let missingManifest = false;
    if (read.manifest === null) {
      missingManifest = true;
      warnings.push(read.malformed === void 0 ? "manifest_missing" : `manifest_malformed: ${read.malformed}`);
      for (const node of model.nodes) {
        if (node.source === null || node.source === void 0) continue;
        staleNodes.push({ id: node.id, source: node.source, reason: "no_manifest" });
      }
    } else {
      commit = isCommit(read.manifest.commit ?? "") ? read.manifest.commit : null;
      if (commit === null) warnings.push("manifest_commit_invalid");
      commitBehind = commit === null ? null : gitRunner.commitBehind(commit);
      if (commit !== null && commitBehind === null) warnings.push("manifest_commit_unknown");
      const expected = read.manifest.sourceHashes ?? {};
      for (const node of model.nodes) {
        if (node.source === null || node.source === void 0) continue;
        const absolute = resolveSource(root, node.source);
        const current = absolute === null ? null : hashFile(absolute);
        if (!(node.id in expected)) {
          staleNodes.push({ id: node.id, source: node.source, reason: "not_in_manifest" });
        } else if (expected[node.id] !== current) {
          staleNodes.push({ id: node.id, source: node.source, reason: current === null ? "source_missing" : "source_changed" });
        }
      }
    }
    const stale = missingManifest || commitBehind !== null && commitBehind > 0 || staleNodes.length > 0 || warnings.includes("manifest_commit_unknown") || warnings.includes("manifest_commit_invalid");
    return {
      ok: true,
      stale,
      missingManifest,
      commit,
      head: headCommit,
      commitBehind,
      staleNodeIds: staleNodes.map((entry) => entry.id),
      staleNodes,
      warnings
    };
  };
  const scan = ({ roots = DEFAULT_SCAN_ROOTS, extensions = DEFAULT_SCAN_EXTENSIONS } = {}) => {
    const model = workspace.readModel().model;
    const read = readManifest(dir);
    const headCommit = head();
    const base = read.manifest?.commit ?? headCommit;
    const warnings = [];
    let changes = [];
    try {
      changes = gitRunner.diffNameStatus(base);
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      warnings.push("git_unavailable");
    }
    const bySource = nodeIdsBySource(model);
    const edgesByNode = /* @__PURE__ */ new Map();
    for (const edge of model.edges) {
      for (const id of [edge.from, edge.to]) {
        const list = edgesByNode.get(id) ?? [];
        if (!list.includes(edge.id)) list.push(edge.id);
        edgesByNode.set(id, list);
      }
    }
    const changedFiles = [];
    const proposedOps = [];
    const affected = /* @__PURE__ */ new Set();
    const unrepresented = [];
    const blocked = [];
    for (const change of changes) {
      const statusCode = String(change.status ?? "")[0];
      const path = change.path;
      const nodeIds = [...bySource.get(path) ?? [], ...change.from === null ? [] : bySource.get(change.from) ?? []];
      changedFiles.push({ path, status: statusCode, nodeIds: [...new Set(nodeIds)] });
      if (statusCode === "D") {
        for (const nodeId of bySource.get(path) ?? []) {
          const edges = edgesByNode.get(nodeId) ?? [];
          if (edges.length > 0) blocked.push({ nodeId, reason: "node_has_edges", edges });
          else proposedOps.push({ kind: "node", action: "remove", id: nodeId });
        }
        continue;
      }
      if (statusCode === "A" || statusCode === "R" || statusCode === "C") {
        const referenced = bySource.has(path);
        const watched = roots.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
        if (!referenced && watched && extensions.includes(extensionOf(path))) proposedOps.push(proposalFor(path));
        else if (!referenced) unrepresented.push({ path, status: statusCode });
        else for (const nodeId of bySource.get(path) ?? []) affected.add(nodeId);
        continue;
      }
      for (const nodeId of bySource.get(path) ?? []) affected.add(nodeId);
    }
    return {
      ok: true,
      head: headCommit,
      manifestCommit: read.manifest?.commit ?? null,
      base,
      changedFiles,
      proposedOps,
      affectedNodes: [...affected].sort(),
      unrepresented,
      blocked,
      warnings
    };
  };
  const apply2 = (ops, { logger: inner } = {}) => {
    const resolved = Array.isArray(ops) ? ops : ops?.ops;
    if (!Array.isArray(resolved)) {
      throw new DesignmapRefusal(REFUSALS.invalidOps, "apply needs an array of ops", { ops });
    }
    const result = applyToWorkspace(workspace, resolved, { logger: inner ?? logger });
    const model = workspace.readModel().model;
    const headCommit = head();
    const previous = readManifest(dir).manifest;
    const manifest = buildManifest({ model, repoRoot: root, commit: headCommit, generatedAt: now(), previous, changed: result.written.model });
    const written = writeManifest(dir, manifest);
    return {
      ok: true,
      applied: result.applied,
      skipped: result.skipped,
      ops: result.ops,
      diff: result.diff,
      written: { model: result.written.model, views: result.written.views, manifest: written.written },
      manifest: { rev: manifest.rev, commit: manifest.commit, generatedAt: manifest.generatedAt, nodes: Object.keys(manifest.sourceHashes).length }
    };
  };
  const envelopeFor = (result, staleReport) => ({
    ok: true,
    viewId: result.viewId,
    scenePath: relative2(root, workspace.scenePath(result.viewId)) || workspace.scenePath(result.viewId),
    sceneHash: result.sceneHash,
    bytes: result.bytes,
    scene: result.scene,
    stale: {
      stale: staleReport.stale,
      missingManifest: staleReport.missingManifest,
      commit: staleReport.commit,
      head: staleReport.head,
      commitBehind: staleReport.commitBehind,
      staleNodes: staleReport.staleNodes,
      warnings: staleReport.warnings
    },
    lint: result.lint,
    generatedAt: now(),
    commit: staleReport.head
  });
  const panelViews = async ({ viewId } = {}) => {
    const staleReport = status();
    const viewsDoc = workspace.readViews().views;
    if (viewId !== void 0 && !viewsDoc.views.some((view) => view.id === viewId)) {
      throw new DesignmapRefusal(REFUSALS.unknownView, `unknown view "${String(viewId)}"`, { viewId });
    }
    const model = workspace.readModel().model;
    const overlays = workspace.readOverlays().overlays;
    const ids = viewId === void 0 ? viewsDoc.views.map((view) => view.id) : [viewId];
    const rows = [];
    for (const id of ids) {
      const view = viewsDoc.views.find((candidate) => candidate.id === id);
      const result = await renderView({
        model,
        views: viewsDoc,
        overlays,
        viewId: id,
        staleNodeIds: staleReport.staleNodeIds,
        logger
      });
      rows.push({
        view: { viewId: id, title: view.title ?? "", level: view.level, parentGroupId: view.parent ?? null },
        scene: result.scene,
        meta: {
          generatedAt: now(),
          commit: staleReport.head,
          sceneHash: result.sceneHash,
          scenePath: relative2(root, workspace.scenePath(id)) || workspace.scenePath(id),
          stale: {
            stale: staleReport.stale,
            commitBehind: staleReport.commitBehind,
            staleNodes: staleReport.staleNodeIds
          },
          lint: result.lint
        }
      });
    }
    const index = workspace.readIndex().index;
    const indexRows = Array.isArray(index?.views) ? index.views : [];
    const rootRow = indexRows.find((row) => row.parent === null && row.level === "context") ?? indexRows.find((row) => row.parent === null) ?? null;
    const rootId = rows.find((row) => row.view.viewId === rootRow?.viewId)?.view.viewId ?? rows.find((row) => row.view.level === "context")?.view.viewId ?? rows[0]?.view.viewId ?? null;
    const annotations = workspace.readAnnotations().elements;
    logger?.log("panel.views", { views: rows.length, viewId: viewId ?? null });
    return {
      ok: true,
      views: rows,
      rootId,
      overlays: { rows: overlays, path: "designmap/overlays.json" },
      annotations,
      stale: {
        stale: staleReport.stale,
        commitBehind: staleReport.commitBehind,
        staleNodes: staleReport.staleNodes
      },
      generatedAt: now(),
      commit: staleReport.head
    };
  };
  const OVERLAY_GAP = 8;
  const viewForNode = (model, viewsDoc, nodeId, viewId) => {
    if (viewId !== void 0) return viewsDoc.views.find((view) => view.id === viewId) ?? null;
    return viewsDoc.views.find((view) => selectView(model, view).nodes.some((node) => node.id === nodeId)) ?? null;
  };
  const autoPlace = async ({ nodeId, x, y, viewId, overlays }) => {
    const model = workspace.readModel().model;
    const viewsDoc = workspace.readViews().views;
    const view = viewForNode(model, viewsDoc, nodeId, viewId);
    if (view === null) return null;
    const result = await renderView({
      model,
      views: viewsDoc,
      overlays,
      viewId: view.id,
      staleNodeIds: [],
      logger
    });
    const self = result.scene.nodes.find((node) => node.id === nodeId);
    if (self === void 0) return null;
    const requested = { x: x ?? self.x, y: y ?? self.y, w: self.w, h: self.h };
    const obstacles = result.scene.nodes.filter((node) => node.id !== nodeId).map((node) => ({ x: node.x, y: node.y, w: node.w, h: node.h }));
    const collides = obstacles.some((obstacle) => boxesWithinGap(requested, obstacle, OVERLAY_GAP));
    if (!collides) return { x: requested.x, y: requested.y, moved: false, from: requested };
    const placed = findFreeSpot({ box: requested, obstacles, gap: OVERLAY_GAP });
    if (placed === null) return { x: requested.x, y: requested.y, moved: false, from: requested, unresolved: true };
    return { ...placed, moved: placed.x !== requested.x || placed.y !== requested.y, from: requested };
  };
  const label = ({ kind = "node", id, label: next } = {}) => {
    if (kind !== "node" && kind !== "edge") {
      throw new DesignmapRefusal("invalid_label_target", `label target must be node or edge, got "${String(kind)}"`, { kind });
    }
    if (typeof id !== "string" || id === "") {
      throw new DesignmapRefusal("invalid_label_target", "label needs a node or edge id", { kind, id });
    }
    if (typeof next !== "string") {
      throw new DesignmapRefusal("invalid_label", "label must be a string", { kind, id, type: typeof next });
    }
    const text = next.trim();
    if (text === "") {
      const code = kind === "edge" ? REFUSALS.missingEdgeLabel : "invalid_label";
      throw new DesignmapRefusal(code, `${kind} "${id}" cannot have an empty label`, { kind, id });
    }
    if (text.length > 200) {
      throw new DesignmapRefusal("invalid_label", `label for "${id}" is longer than 200 characters`, { kind, id, length: text.length });
    }
    const model = workspace.readModel().model;
    let row;
    if (kind === "node") {
      const node = model.nodes.find((candidate) => candidate.id === id);
      if (node === void 0) throw new DesignmapRefusal("unknown_node", `unknown node "${id}"`, { id });
      row = { ...node, label: text };
    } else {
      const edge = model.edges.find((candidate) => candidate.id === id);
      if (edge === void 0) throw new DesignmapRefusal("unknown_edge", `unknown edge "${id}"`, { id });
      row = { ...edge, label: text };
    }
    const result = apply2([{ kind, action: "upsert", value: row }]);
    logger?.log("label.write", { kind, id, length: text.length });
    return { ok: true, kind, id, label: text, applied: result.applied, written: result.written, manifest: result.manifest, diff: result.diff };
  };
  const render = async ({ viewId, logger: inner, write = true } = {}) => {
    const staleReport = status();
    const viewsDoc = workspace.readViews().views;
    if (viewId !== void 0) {
      const view = viewsDoc.views.find((candidate) => candidate.id === viewId);
      if (view === void 0) {
        throw new DesignmapRefusal(REFUSALS.unknownView, `unknown view "${viewId}"`, {
          viewId,
          available: viewsDoc.views.map((candidate) => candidate.id)
        });
      }
    }
    if (!write) {
      if (viewId !== void 0) {
        const result = await renderView({
          model: workspace.readModel().model,
          views: viewsDoc,
          overlays: workspace.readOverlays().overlays,
          viewId,
          staleNodeIds: staleReport.staleNodeIds,
          logger: inner ?? logger
        });
        return envelopeFor(result, staleReport);
      }
      const views = [];
      for (const view of viewsDoc.views) {
        const result = await renderView({
          model: workspace.readModel().model,
          views: viewsDoc,
          overlays: workspace.readOverlays().overlays,
          viewId: view.id,
          staleNodeIds: staleReport.staleNodeIds,
          logger: inner ?? logger
        });
        views.push(envelopeFor(result, staleReport));
      }
      return { ok: true, views, stale: { stale: staleReport.stale, staleNodes: staleReport.staleNodes, commitBehind: staleReport.commitBehind, missingManifest: staleReport.missingManifest, warnings: staleReport.warnings }, generatedAt: now(), commit: staleReport.head };
    }
    const bundle = await renderAll({ workspace, logger: inner ?? logger, staleNodeIds: staleReport.staleNodeIds });
    const envelopes = [];
    for (const row of bundle.rendered) envelopes.push(envelopeFor(row, staleReport));
    const index = {
      ok: true,
      indexPath: relative2(root, workspace.paths.index) || workspace.paths.index,
      indexHash: bundle.indexHash,
      views: envelopes,
      stale: { stale: staleReport.stale, staleNodes: staleReport.staleNodes, commitBehind: staleReport.commitBehind, missingManifest: staleReport.missingManifest, warnings: staleReport.warnings },
      generatedAt: now(),
      commit: staleReport.head
    };
    return viewId === void 0 ? index : envelopes.find((envelope) => envelope.viewId === viewId);
  };
  const lint = async ({ viewId } = {}) => {
    const staleReport = status();
    const model = workspace.readModel().model;
    const viewsDoc = workspace.readViews().views;
    const overlays = workspace.readOverlays().overlays;
    const ids = viewId === void 0 ? viewsDoc.views.map((view) => view.id) : [viewId];
    const results = [];
    for (const id of ids) {
      try {
        const result = await renderView({ model, views: viewsDoc, overlays, viewId: id, staleNodeIds: staleReport.staleNodeIds, logger });
        results.push({ viewId: id, ok: true, lint: result.lint });
      } catch (error) {
        if (!(error instanceof DesignmapRefusal)) throw error;
        const findings = error.details?.findings ?? [];
        results.push({ viewId: id, ok: true, lint: { ok: false, findings, counts: countSeverities(findings), rules: [...new Set(findings.map((entry) => entry.rule))].sort(), refusal: error.code } });
      }
    }
    return { ok: true, views: results, stale: { stale: staleReport.stale, staleNodes: staleReport.staleNodes } };
  };
  const open = ({ nodeId } = {}) => {
    const model = workspace.readModel().model;
    const node = model.nodes.find((candidate) => candidate.id === nodeId);
    if (node === void 0) {
      throw new DesignmapRefusal("unknown_node", `unknown node "${nodeId}"`, { nodeId, nodes: model.nodes.map((candidate) => candidate.id) });
    }
    if (node.source === null || node.source === void 0) {
      return { ok: false, code: "missing_source", nodeId, message: `node "${nodeId}" has no source` };
    }
    const absolute = resolveSource(root, node.source);
    const exists = absolute !== null && hashFile(absolute) !== null;
    if (!exists) return { ok: false, code: "source_missing", nodeId, source: node.source, message: `source "${node.source}" does not exist` };
    return { ok: true, nodeId, source: node.source, absolute, line: null };
  };
  const annotate = (payload = {}) => {
    const elements = payload.elements;
    if (!Array.isArray(elements)) {
      throw new DesignmapRefusal("invalid_annotation", "annotate needs an elements array", { type: typeof elements });
    }
    if (elements.length > MAX_ANNOTATIONS) {
      throw new DesignmapRefusal("annotation_limit", `annotate accepts at most ${MAX_ANNOTATIONS} elements`, { count: elements.length, max: MAX_ANNOTATIONS });
    }
    const cleaned = elements.map((element, index) => {
      if (element === null || typeof element !== "object" || Array.isArray(element)) {
        throw new DesignmapRefusal("invalid_annotation", `annotation ${index} is not an object`, { index });
      }
      if (!ANNOTATION_TYPES.has(element.type)) {
        throw new DesignmapRefusal("invalid_annotation", `annotation ${index} has unsupported type "${String(element.type)}"`, { index, type: element.type });
      }
      for (const axis of ["x", "y", "width", "height"]) {
        if (!Number.isFinite(element[axis])) {
          throw new DesignmapRefusal("invalid_annotation", `annotation ${index} ${axis} must be a finite number`, { index, field: axis });
        }
      }
      if (element.customData?.designmap !== void 0) {
        throw new DesignmapRefusal("annotation_forbidden_fields", `annotation ${index} carries designmap customData`, { index });
      }
      if (Array.isArray(element.points) && (element.points.length > 4096 || element.points.some((point) => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)))) {
        throw new DesignmapRefusal("invalid_annotation", `annotation ${index} has invalid points`, { index });
      }
      const copy = structuredClone(element);
      delete copy.customData;
      delete copy.link;
      delete copy.isDeleted;
      delete copy.locked;
      if (typeof copy.containerId === "string" && copy.containerId.startsWith("dm:")) delete copy.containerId;
      return copy;
    });
    const written = workspace.writeAnnotations(cleaned);
    logger?.log("annotate.write", { elements: cleaned.length, bytes: Buffer.byteLength(written.text) });
    return { ok: true, elements: cleaned.length, bytes: Buffer.byteLength(written.text), annotationsPath: relative2(root, written.path) || written.path, hash: written.hash };
  };
  const overlay = async (payload = {}) => {
    const model = workspace.readModel().model;
    const viewsDoc = workspace.readViews().views;
    const read = workspace.readOverlays();
    const current = read.overlays !== null && typeof read.overlays === "object" && !Array.isArray(read.overlays) ? structuredClone(read.overlays) : {};
    const action = payload.action ?? "upsert";
    const nodeIds = new Set(model.nodes.map((node) => node.id));
    const payloadKeys = ["action", "nodeId", "viewId", "row", "x", "y", "fill", "stroke"];
    const unknown = Object.keys(payload).filter((key) => !payloadKeys.includes(key));
    if (unknown.length > 0) {
      throw new DesignmapRefusal("model_fields_forbidden", `overlay cannot write model fields (${unknown.join(", ")})`, { fields: unknown });
    }
    const validateRow = (row, nodeId) => {
      const kept = {};
      for (const key of Object.keys(row)) {
        if (!["x", "y", "fill", "stroke"].includes(key)) {
          throw new DesignmapRefusal("model_fields_forbidden", `overlay row cannot write "${key}" on "${nodeId}"`, { nodeId, field: key });
        }
      }
      for (const axis of ["x", "y"]) {
        const value = row[axis];
        if (value === void 0) continue;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new DesignmapRefusal("invalid_coordinate", `overlay ${axis} must be a finite number`, { axis, value });
        }
        if (value < 0) throw new DesignmapRefusal("negative_coordinate", `overlay ${axis} must not be negative`, { axis, value });
        kept[axis] = Math.round(value * 100) / 100;
      }
      for (const colour of ["fill", "stroke"]) {
        const value = row[colour];
        if (value === void 0) continue;
        if (!isHexColour(value)) {
          throw new DesignmapRefusal("invalid_colour", `overlay ${colour} "${String(value)}" is not a hex colour`, { colour, value });
        }
        kept[colour] = value;
      }
      return kept;
    };
    if (action === "upsert") {
      const nodeId = payload.nodeId;
      if (typeof nodeId !== "string" || !nodeIds.has(nodeId)) {
        throw new DesignmapRefusal("unknown_node", `unknown node "${String(nodeId)}"`, { nodeId, nodes: [...nodeIds] });
      }
      const kept = validateRow({ x: payload.x, y: payload.y, fill: payload.fill, stroke: payload.stroke }, nodeId);
      if (Object.keys(kept).length === 0) {
        throw new DesignmapRefusal("invalid_overlay", "overlay upsert needs at least one of x/y/fill/stroke", { nodeId });
      }
      let placement = null;
      if (kept.x !== void 0 || kept.y !== void 0) {
        placement = await autoPlace({ nodeId, x: kept.x, y: kept.y, viewId: payload.viewId, overlays: current });
        if (placement !== null && placement.moved) {
          kept.x = placement.x;
          kept.y = placement.y;
        }
      }
      const before = current[nodeId] ?? null;
      current[nodeId] = { ...current[nodeId] ?? {}, ...kept };
      const written = workspace.writeOverlays(current);
      logger?.log("overlay.write", { action, nodeId, keys: Object.keys(kept).sort(), rows: Object.keys(current).length, autoPlaced: placement?.moved === true });
      return {
        ok: true,
        action,
        nodeId,
        keys: Object.keys(kept).sort(),
        row: current[nodeId],
        before,
        adjusted: placement?.moved === true ? { x: kept.x, y: kept.y, from: placement.from } : null,
        finding: placement?.unresolved === true ? { code: "overlap_unresolved", severity: "warning", nodeId, message: `no free position found for "${nodeId}"; the overlap stays and the scene lint reports it` } : placement?.moved === true ? { code: "overlap_adjusted", severity: "info", nodeId, from: placement.from, to: { x: kept.x, y: kept.y }, message: `"${nodeId}" was placed ${Math.round(placement.x - placement.from.x)},${Math.round(placement.y - placement.from.y)} px aside to keep it clear of the other nodes` } : null,
        rows: Object.keys(current).length,
        overlaysPath: relative2(root, written.path) || written.path
      };
    }
    if (action === "replace") {
      const nodeId = payload.nodeId;
      if (typeof nodeId !== "string" || !nodeIds.has(nodeId)) {
        throw new DesignmapRefusal("unknown_node", `unknown node "${String(nodeId)}"`, { nodeId });
      }
      const row = payload.row ?? null;
      if (row !== null) {
        if (typeof row !== "object" || Array.isArray(row)) {
          throw new DesignmapRefusal("invalid_overlay", "overlay replace row must be an object or null", { nodeId });
        }
        const kept = validateRow(row, nodeId);
        if (Object.keys(kept).length === 0) delete current[nodeId];
        else current[nodeId] = kept;
      } else {
        delete current[nodeId];
      }
      const written = workspace.writeOverlays(current);
      logger?.log("overlay.write", { action, nodeId, keys: Object.keys(current[nodeId] ?? {}).sort(), rows: Object.keys(current).length });
      return { ok: true, action, nodeId, keys: Object.keys(current[nodeId] ?? {}).sort(), rows: Object.keys(current).length, overlaysPath: relative2(root, written.path) || written.path };
    }
    if (action === "resetNode") {
      const nodeId = payload.nodeId;
      if (typeof nodeId !== "string" || !nodeIds.has(nodeId)) {
        throw new DesignmapRefusal("unknown_node", `unknown node "${String(nodeId)}"`, { nodeId });
      }
      delete current[nodeId];
      const written = workspace.writeOverlays(current);
      logger?.log("overlay.write", { action, nodeId, rows: Object.keys(current).length });
      return { ok: true, action, nodeId, rows: Object.keys(current).length, overlaysPath: relative2(root, written.path) || written.path };
    }
    if (action === "resetView") {
      const view = viewsDoc.views.find((candidate) => candidate.id === payload.viewId);
      if (view === void 0) {
        throw new DesignmapRefusal(REFUSALS.unknownView, `unknown view "${payload.viewId}"`, { viewId: payload.viewId });
      }
      const selected = selectView(model, view);
      let removed = 0;
      for (const node of selected.nodes) {
        if (node.id in current) {
          delete current[node.id];
          removed += 1;
        }
      }
      const written = workspace.writeOverlays(current);
      logger?.log("overlay.write", { action, viewId: view.id, removed, rows: Object.keys(current).length });
      return { ok: true, action, viewId: view.id, removed, rows: Object.keys(current).length, overlaysPath: relative2(root, written.path) || written.path };
    }
    throw new DesignmapRefusal("invalid_overlay", `unknown overlay action "${String(action)}" (upsert | replace | resetNode | resetView)`, { action });
  };
  const exportSvg = async ({ viewId } = {}) => {
    const staleReport = status();
    const viewsDoc = workspace.readViews().views;
    const id = viewId ?? viewsDoc.views[0]?.id;
    if (id === void 0) {
      throw new DesignmapRefusal(REFUSALS.unknownView, "no views to export", { viewId });
    }
    const result = await renderView({
      model: workspace.readModel().model,
      views: viewsDoc,
      overlays: workspace.readOverlays().overlays,
      viewId: id,
      staleNodeIds: staleReport.staleNodeIds,
      logger
    });
    const svg = sceneToSvg(result.scene, { colours: result.merge.colours });
    const path = join2(workspace.paths.out, `${id}.svg`);
    mkdirSync2(dirname2(path), { recursive: true });
    writeFileSync2(path, svg, "utf8");
    return {
      ok: true,
      viewId: id,
      svgPath: relative2(root, path) || path,
      bytes: Buffer.byteLength(svg),
      hash: sha256(svg),
      sceneHash: result.sceneHash,
      nodes: result.scene.nodes.length,
      edges: result.scene.edges.length,
      labels: result.scene.nodes.map((node) => node.label),
      colours: [...result.merge.colours.keys()],
      written: true
    };
  };
  const exportView = async ({ viewId, format = "svg" } = {}) => {
    const svgResult = await exportSvg({ viewId });
    if (format === "svg") return { ...svgResult, format: "svg" };
    if (format !== "png") {
      throw new DesignmapRefusal("invalid_export_format", `unknown export format "${String(format)}" (svg | png)`, { format });
    }
    const converter = findPngConverter();
    if (converter === null || converter.missing !== void 0) {
      throw new DesignmapRefusal("png_converter_missing", "PNG export needs rsvg-convert, ImageMagick convert or magick on PATH (or DESIGNMAP_PNG_CONVERTER)", {
        svgPath: svgResult.svgPath,
        configured: converter?.missing ?? null,
        candidates: PNG_CONVERTERS
      });
    }
    const svgAbsolute = join2(root, svgResult.svgPath);
    const pngAbsolute = join2(workspace.paths.out, `${svgResult.viewId}.png`);
    const args = converter.command.endsWith("rsvg-convert") ? ["-o", pngAbsolute, svgAbsolute] : [svgAbsolute, pngAbsolute];
    const run = spawnSync(converter.command, args, { encoding: "utf8" });
    if (run.error !== void 0 || run.status !== 0) {
      throw new DesignmapRefusal("png_export_failed", `PNG conversion failed (${converter.command})`, {
        svgPath: svgResult.svgPath,
        status: run.status,
        stderr: String(run.stderr ?? run.error?.message ?? "").slice(0, 2e3)
      });
    }
    const bytes = readFileSync2(pngAbsolute);
    return {
      ...svgResult,
      format: "png",
      svgPath: svgResult.svgPath,
      pngPath: relative2(root, pngAbsolute) || pngAbsolute,
      pngBytes: statSync(pngAbsolute).size,
      pngHash: `sha256:${createHash2("sha256").update(bytes).digest("hex")}`,
      converter: converter.command
    };
  };
  return {
    paths: { designmapDir: dir, repoRoot: root, logs: join2(dir, "logs"), manifest: join2(dir, "manifest.json") },
    workspace,
    status,
    scan,
    apply: apply2,
    overlay,
    label,
    views: panelViews,
    annotate,
    render,
    lint,
    open,
    exportSvg,
    exportView,
    readManifest: () => readManifest(dir),
    sourceHashes: () => sourceHashes(workspace.readModel().model, root)
  };
}
function countSeverities(findings) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const entry of findings) counts[entry.severity] += 1;
  return counts;
}

// src/tools.mjs
var string = (description) => ({ type: "string", description });
var VALUE_PROPERTIES = {
  id: { type: "string", description: "Immutable semantic id." },
  type: { type: "string", enum: NODE_TYPES, description: "Node type (node ops)." },
  label: { type: "string", description: "Node label or edge label." },
  group: { oneOf: [{ type: "string" }, { type: "null" }], description: "Node group id or null (node ops)." },
  source: { oneOf: [{ type: "string" }, { type: "null" }], description: "Repo-relative source path or null (node ops)." },
  from: { type: "string", description: "Edge source node id (edge ops)." },
  to: { type: "string", description: "Edge target node id (edge ops)." },
  kind: { type: "string", enum: EDGE_KINDS, description: "Edge kind (edge ops)." },
  title: { type: "string", description: "View title (view ops)." },
  level: { type: "string", enum: VIEW_LEVELS, description: "View level (view ops)." },
  direction: { type: "string", enum: DIRECTIONS, description: "View direction (view ops)." },
  include: { type: "array", items: { type: "string" }, description: "View include globs (view ops)." },
  parent: { oneOf: [{ type: "string" }, { type: "null" }], description: "View parent group id or null (view ops)." }
};
var OPS_PARAM = {
  type: "array",
  required: true,
  description: "Semantic ops; applied atomically and idempotently. Coordinates and colours are refused by this schema (no x/y/fill property).",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["node", "edge", "group", "view"], required: true, description: "Which collection the op addresses." },
      action: { type: "string", enum: ["upsert", "remove"], required: true, description: "Upsert a value, or remove by id." },
      id: { type: "string", description: "Id for a remove op." },
      value: { type: "object", additionalProperties: false, properties: VALUE_PROPERTIES, description: "Semantic row for an upsert op." }
    }
  }
};
var jsonOutput = {
  schema: { type: "json" },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
};
var TOOL_SPECS = [
  {
    name: "designmap_apply",
    method: "apply",
    description: "Apply semantic designmap ops (upsert/remove node, edge, group, view) and update the manifest. Fields are semantic only: id/type/label/group/source and edge from/to/kind/label. Coordinates and colours are refused by the schema. The whole batch is validated before writing; a dangling reference refuses the batch and leaves the files unchanged. Re-applying the same batch returns applied=0/skipped=N and writes nothing.",
    parameters: { ops: OPS_PARAM },
    call: (service, args) => service.apply(args.ops)
  },
  {
    name: "designmap_render",
    method: "render",
    description: "Render views to designmap/out/<viewId>.scene.json and designmap/out/index.json. Every scene carries the stale flags from the manifest vs HEAD check, the lint report and the scene hash. Omit viewId to render all views (the result then carries the index and one envelope per view).",
    parameters: { viewId: string("Render only this view id; omit to render every view.") },
    call: (service, args) => service.render({ viewId: args.viewId })
  },
  {
    name: "designmap_lint",
    method: "lint",
    description: "Lint one view or all views without writing anything: view size, missing edge labels, orphan nodes, dangling references, duplicate ids, long labels, overlaps after the overlay merge, stale nodes, colours outside the palette. Error findings mean render would refuse.",
    parameters: { viewId: string("Lint only this view id; omit to lint every view.") },
    call: (service, args) => service.lint({ viewId: args.viewId })
  },
  {
    name: "designmap_status",
    method: "status",
    description: "Compare designmap/manifest.json with HEAD and the files on disk. Returns stale, commit, head, commitBehind, staleNodes (with the reason per node) and warnings. A missing manifest is stale=true with a warning; it is not an error.",
    parameters: {},
    call: (service) => service.status()
  },
  {
    name: "designmap_scan",
    method: "scan",
    description: "Read git changes since the manifest commit and propose semantic ops for the model: new watched source files become upsert-node proposals, deleted files with an edge-free node become remove-node proposals, modified files are listed as affected nodes (their meaning is a human/agent decision). Never writes the model.",
    parameters: {
      roots: { type: "array", items: { type: "string" }, description: 'Source roots to watch for new files. Default ["src"].' },
      extensions: { type: "array", items: { type: "string" }, description: 'File extensions to propose nodes for. Default [".ts",".tsx",".js",".mjs",".py",".go",".sql"].' }
    },
    call: (service, args) => service.scan({ roots: args.roots, extensions: args.extensions })
  },
  {
    name: "designmap_open",
    method: "open",
    description: "Resolve the source file of one semantic node (repo-relative and absolute) so the caller can open it. A node without source or a missing file is a structured refusal value, not a crash.",
    parameters: { nodeId: { type: "string", required: true, description: "Semantic node id to open." } },
    call: (service, args) => service.open({ nodeId: args.nodeId })
  },
  {
    name: "designmap_export",
    method: "export",
    description: 'Export the current state of a view, including the overlay positions and colours already merged into the scene. format "svg" (default) writes designmap/out/<viewId>.svg; format "png" writes the same scene as PNG when rsvg-convert, ImageMagick convert or magick is available, and refuses with png_converter_missing otherwise (no rasteriser dependency is shipped). Returns the path(s), hash, size, labels and which nodes carry overlay colours.',
    parameters: {
      viewId: string("View to export; omit for the first view."),
      format: { type: "string", enum: ["svg", "png"], description: "Export format. Default svg; png is optional and needs an external converter." }
    },
    call: (service, args) => service.exportView({ viewId: args.viewId, format: args.format ?? "svg" })
  }
];
function createHostTools({ defineTool: defineTool2, hostFor }) {
  return TOOL_SPECS.map((spec) => defineTool2({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: jsonOutput,
    async execute(args, exec) {
      const { service, logger } = hostFor(exec);
      logger?.log("tool.enter", { tool: spec.name, arguments: args });
      const started = performance.now();
      try {
        const value = await spec.call(service, args ?? {});
        logger?.log("tool.exit", {
          tool: spec.name,
          ok: value?.ok !== false,
          code: value?.ok === false ? value.code ?? null : null,
          ms: Math.round((performance.now() - started) * 100) / 100
        });
        return value;
      } catch (error) {
        const payload = error instanceof DesignmapRefusal ? { ok: false, code: error.code, message: error.message, details: error.details } : { ok: false, code: error?.code ?? "internal_error", message: String(error?.message ?? error) };
        logger?.log("tool.exit", {
          tool: spec.name,
          ok: false,
          code: payload.code,
          ms: Math.round((performance.now() - started) * 100) / 100
        });
        return payload;
      }
    }
  }));
}
function agentCwd(agent) {
  const cwd = agent?.session?.header?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd();
}

// src/command.mjs
var OPS = ["status", "scan", "apply", "render", "lint", "open", "export", "overlay", "annotate", "views", "label"];
var OVERLAY_FIELDS = ["action", "nodeId", "viewId", "row", "x", "y", "fill", "stroke"];
function overlayPayload(op) {
  const payload = {};
  for (const field of OVERLAY_FIELDS) {
    if (op[field] !== void 0) payload[field] = op[field];
  }
  return payload;
}
function createCommandHandler({ hostFor }) {
  return async function handler(invocation) {
    const { service, logger } = hostFor({ agent: invocation.agent });
    let op;
    try {
      op = JSON.parse(invocation.rawInput);
    } catch {
      return { kind: "error", text: "designmap: expected a JSON operation" };
    }
    if (op === null || typeof op !== "object" || !OPS.includes(op.op)) {
      return { kind: "error", text: `designmap: unknown op (${OPS.join(" | ")})` };
    }
    logger?.log("tool.enter", { tool: "command", op: op.op });
    const started = performance.now();
    try {
      let value;
      switch (op.op) {
        case "status":
          value = service.status();
          break;
        case "scan":
          value = service.scan({ roots: op.roots, extensions: op.extensions });
          break;
        case "apply":
          value = service.apply(op.ops);
          break;
        case "render":
          value = await service.render({ viewId: op.viewId });
          break;
        case "lint":
          value = await service.lint({ viewId: op.viewId });
          break;
        case "open":
          value = service.open({ nodeId: op.nodeId });
          break;
        case "export":
          value = await service.exportView({ viewId: op.viewId, format: op.format });
          break;
        case "overlay":
          value = await service.overlay(overlayPayload(op));
          break;
        case "annotate":
          value = service.annotate({ elements: op.elements });
          break;
        case "views":
          value = await service.views({ viewId: op.viewId });
          break;
        case "label":
          value = service.label({ kind: op.kind, id: op.id, label: op.label });
          break;
        default:
          return { kind: "error", text: `designmap: unknown op (${OPS.join(" | ")})` };
      }
      return { kind: "success", text: JSON.stringify(value) };
    } catch (error) {
      if (error instanceof DesignmapRefusal) {
        return { kind: "error", text: `designmap: ${error.code}: ${error.message}` };
      }
      return { kind: "error", text: `designmap: internal_error: ${String(error?.message ?? error)}` };
    } finally {
      logger?.log("tool.exit", { tool: "command", op: op.op, ms: Math.round((performance.now() - started) * 100) / 100 });
    }
  };
}

// index.js
var name = "designmap";
var inject = ["tools", "commands"];
var DEFAULT_PRESETS = ["orchestrator"];
function apply(ctx, config = {}) {
  const dirName = typeof config.dir === "string" && config.dir !== "" ? config.dir : "designmap";
  const presets = Array.isArray(config.presets) && config.presets.length > 0 ? config.presets : DEFAULT_PRESETS;
  const hostFor = (exec) => {
    const cwd = agentCwd(exec.agent);
    const designmapDir = join3(cwd, dirName);
    const { logger, path } = createFileLogger(designmapDir);
    return {
      service: createHostService({ designmapDir, repoRoot: cwd, logger }),
      logger,
      logPath: path
    };
  };
  const tools = createHostTools({ defineTool, hostFor });
  ctx.on("agent/created", ({ agent }) => {
    if (!presets.includes(agent?.session?.header?.agentPreset)) return;
    for (const tool of tools) agent.ctx.tools.register(tool);
  });
  ctx.commands.register({
    name: "designmap",
    description: "Read or change the designmap living document (status | scan | apply | render | lint | open | export). Used by the Design map panel and by the human.",
    recordInput: false,
    handler: createCommandHandler({ hostFor })
  });
}
export {
  apply,
  inject,
  name
};
