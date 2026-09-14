/**
 * Project-context core: pure logic behind the dsh-context tools, with no harness import.
 *
 * Kept separate from the plugin registration so it can be tested without a running harness and so
 * the harness dependency appears in exactly one place. The split also keeps the contract honest: this
 * file answers questions about a project, and the plugin only exposes those answers as tools.
 *
 * Agents do not read documentation — they grep. That is not a flaw to correct but a trajectory to
 * use: an agent will reliably call a *tool*, because a tool is part of how it works, while it will
 * ignore a prose file about half the time and a documentation server almost always. This plugin
 * therefore exposes a project's declared structure, rules and work orders as three tools, so the
 * cheap path and the correct path are the same path.
 *
 * It is deliberately project-agnostic. Nothing here names a language, package manager or test
 * runner: the project describes itself in `.dsh/project.json`, and this plugin reads whatever it
 * finds. A Python project, a CMake project and a Unity project use the same three tools.
 *
 * The three questions it answers, and why each one is a question an agent actually has:
 *
 *   `context_module`  — which module owns this path, what does it export, what does it link to.
 *                       Replaces "let me grep around and guess the shape of this part of the repo".
 *   `context_rules`   — which rules bind this path, and what command fails if one is broken.
 *                       Replaces reading a long contract file and hoping the relevant part is found.
 *   `context_specs`   — what work is in flight, which paths it claims, and where scopes overlap.
 *                       Replaces the plan-less parallel work that has already caused two workers to
 *                       edit one package in this project.
 *
 * When a project has no manifest the tools say so plainly and name the file to create, rather than
 * returning empty results that look like success.
 *
 * The project is located from the **session's workspace**, not the process directory: the harness is
 * normally launched from a home or app directory, so searching upward from `process.cwd()` finds no
 * manifest at all. `sessionRoot` extracts the workspace the call belongs to; `rootFor` in the plugin
 * passes it to `findProjectRoot`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Manifest path, relative to the project root. */
const MANIFEST = '.dsh/project.json';

/** Specification directory, relative to the project root. */
const SPECS = '.dsh/specs';

/**
 * Reads the workspace directory out of a tool-execution context.
 *
 * The harness runs tools under a session, and a session carries the workspace it was opened on. The
 * server process is normally launched from somewhere else entirely — a home directory, an app
 * directory — so `process.cwd()` is not the workspace, and searching upward from it finds no
 * manifest. The filesystem tools resolve relative paths through this same field, and the context
 * tools must resolve the project root the same way or they answer "no manifest" for every project.
 *
 * @param exec - Tool-execution context supplied by the harness; may be undefined in tests.
 * @returns The session's workspace directory, or `undefined` to fall back to the process directory.
 */
export function sessionRoot(exec) {
  const cwd = exec?.agent?.session?.header?.cwd;
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined;
}

/**
 * Finds the project root by walking up from a starting directory.
 *
 * A tool must work from any subdirectory a shell happens to be in, so the manifest is located by
 * ascent rather than assumed to be at the working directory. Version-control and package roots stop
 * the walk so a search never escapes into an unrelated parent repository.
 *
 * @param start - Directory to begin at; defaults to the process working directory.
 * @returns Absolute project root, or `null` when no manifest is found.
 */
export function findProjectRoot(start = process.cwd()) {
  let current = resolve(start);
  for (let depth = 0; depth < 40; depth += 1) {
    if (existsSync(join(current, MANIFEST))) {
      return current;
    }
    const parent = resolve(current, '..');
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

/**
 * Reads and parses the project manifest.
 *
 * @param root - Absolute project root.
 * @returns `{ manifest }` on success or `{ error }` describing why it could not be read, so a tool
 *   reports a missing manifest as an actionable message instead of an empty result.
 */
export function readManifest(root) {
  const path = join(root, MANIFEST);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { error: `cannot read ${MANIFEST}: ${String(error)}` };
  }
  try {
    return { manifest: JSON.parse(text) };
  } catch (error) {
    return { error: `${MANIFEST} is not valid JSON: ${String(error)}` };
  }
}

/**
 * Reports whether a path lies inside a declared root.
 *
 * Boundary-aware: `packages/sim` does not contain `packages/sim-city`, which a plain string prefix
 * test would wrongly claim.
 *
 * @param path - Candidate path, repository-relative.
 * @param root - Declared root, repository-relative.
 * @returns `true` when the path is the root or lies beneath it.
 */
export function withinRoot(path, root) {
  const cleanRoot = root.replace(/\/+$/, '');
  return path === cleanRoot || path.startsWith(`${cleanRoot}/`);
}

/**
 * Lists every source file a manifest's languages declare, sorted.
 *
 * Extensions come from the manifest, so this walks Python, C#, C++ or TypeScript trees with the
 * same code. Directories that are never source are pruned by name.
 *
 * @param root - Absolute project root.
 * @param manifest - Parsed manifest.
 * @returns Repository-relative paths, sorted; empty when no roots exist.
 */
export function listSources(root, manifest) {
  const extensions = (manifest.languages ?? []).flatMap((language) => language.extensions ?? []);
  const roots = (manifest.languages ?? []).flatMap((language) => language.roots ?? []);
  const skip = new Set([
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.git',
    'bin',
    'obj',
    'Library',
    'Temp',
    '__pycache__',
    '.venv',
    'venv',
    'target',
  ]);
  const found = [];
  const walk = (absolute) => {
    let entries;
    try {
      entries = readdirSync(absolute);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry)) {
        continue;
      }
      const full = join(absolute, entry);
      let isDirectory = false;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        walk(full);
      } else if (extensions.some((extension) => entry.endsWith(extension))) {
        found.push(relative(root, full).split('\\').join('/'));
      }
    }
  };
  for (const languageRoot of roots) {
    const absolute = join(root, languageRoot);
    if (existsSync(absolute)) {
      walk(absolute);
    }
  }
  return found.sort();
}

/**
 * Extracts a module's declared contract from its leading comment run.
 *
 * Fields are read from the leading comments only, so a marker on a later function is not mistaken
 * for the module's own contract. This mirrors what the module projection records, and deliberately
 * does not try to be a parser: a comment convention that is easy to read is a convention that gets
 * followed.
 *
 * @param absolutePath - Absolute path of the source file.
 * @returns `{ purpose, links, exports }`, each absent as `null` or an empty array.
 */
export function readModuleContract(absolutePath) {
  let source;
  try {
    source = readFileSync(absolutePath, 'utf8');
  } catch {
    return { purpose: null, links: [], exports: null };
  }
  const lines = [];
  let insideBlock = false;
  for (const raw of source.split('\n')) {
    const trimmed = raw.trim();
    if (insideBlock) {
      const close = trimmed.indexOf('*/');
      lines.push((close === -1 ? trimmed : trimmed.slice(0, close)).replace(/^\*?\s?/, ''));
      if (close !== -1) {
        insideBlock = false;
      }
      continue;
    }
    if (trimmed.startsWith('/*')) {
      const after = trimmed.slice(trimmed.indexOf('/*') + 2).replace(/^\*/, '');
      const close = after.indexOf('*/');
      if (close === -1) {
        lines.push(after.trimStart());
        insideBlock = true;
      } else {
        lines.push(after.slice(0, close).trimStart());
      }
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      lines.push(trimmed.replace(/^(\/\/|#)\s?/, ''));
      continue;
    }
    if (trimmed.length === 0 && lines.length === 0) {
      continue;
    }
    break;
  }
  const joined = lines.join('\n');
  const field = (label) => {
    const match = new RegExp(`^\\s*${label}:\\s*(.+)$`, 'm').exec(joined);
    return match ? match[1].trim() : null;
  };
  const list = (value) =>
    value === null
      ? []
      : value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
          .sort();
  const exportsRaw = field('EXPORTS');
  return {
    purpose: field('PURPOSE'),
    links: list(field('LINKS')),
    exports: exportsRaw === null ? null : list(exportsRaw),
  };
}

/**
 * Derives a stable module identifier from a repository-relative path.
 *
 * @param path - Repository-relative path with forward slashes.
 * @returns Identifier such as `M-PACKAGES-SIM-SRC-RNG-RNG`.
 */
export function moduleIdFor(path) {
  return `M-${path
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .join('-')
    .toUpperCase()}`;
}

/**
 * Reports whether two scope paths overlap, comparing whole path segments.
 *
 * @param left - First scope path.
 * @param right - Second scope path.
 * @returns `true` when one contains the other or they are equal.
 */
export function scopesOverlap(left, right) {
  const a = left.replace(/\/+$/, '');
  const b = right.replace(/\/+$/, '');
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Validates a specification set, reporting every inconsistency it can decide.
 *
 * @param specs - Parsed specifications.
 * @param manifest - Parsed manifest, supplying resolvers and verification command ids.
 * @returns `{ problems, metrics }`.
 */
export function validateSpecs(specs, manifest, root) {
  const problems = [];
  const resolvers = new Set((manifest.scopes ?? []).map((scope) => scope.resolver));
  const commandIds = new Set((manifest.verification ?? []).map((command) => command.id));
  const roots = (manifest.languages ?? []).flatMap((language) => language.roots ?? []);
  // The same checks the `specs` gate runs, so the tool an agent asks can never be weaker than the
  // gate that will judge its work. When these two disagreed, the tool reported no problem on specs
  // the gate rejected, which is the worst possible direction for a tool to be wrong in.
  //
  // Filesystem checks run only against a root the caller supplied. Falling back to the process
  // directory would resolve `exists` against wherever the harness happens to be launched from, and
  // report a scope as missing when it is merely being asked about from the wrong place.
  const filesystemRoot = typeof root === 'string' && root.length > 0 ? root : null;
  const seen = new Set();

  for (const spec of specs) {
    if (seen.has(spec.id)) {
      problems.push({ spec: spec.id, message: 'two specifications share this id' });
    }
    seen.add(spec.id);

    if (spec.status === 'landed') {
      problems.push({
        spec: spec.id,
        message:
          'is marked landed and must be deleted: a delivered work order describes work that is already done',
      });
    }
    if (spec.status === 'blocked' && (spec.blockedBy ?? []).length === 0) {
      problems.push({ spec: spec.id, message: 'is blocked but names nothing in blockedBy' });
    }
    if (
      spec.status === 'in-flight' &&
      (spec.acceptance ?? []).every((entry) => entry.verifiedBy === undefined)
    ) {
      problems.push({
        spec: spec.id,
        message:
          'is in flight with no acceptance criterion bound to a verification command, so nothing proves it is finished',
      });
    }
    if ((spec.scope ?? []).length === 0) {
      problems.push({ spec: spec.id, message: 'claims no scope, so its write area is unbounded' });
    }
    for (const scope of spec.scope ?? []) {
      if (!resolvers.has(scope.resolver)) {
        problems.push({ spec: spec.id, message: `cites undeclared resolver "${scope.resolver}"` });
        // The gate stops here for this scope, so an undeclared resolver does not also produce the
        // outside-root and existence findings. Continuing produced three problems where the gate
        // produced one, and a tool that over-reports is as wrong as one that under-reports.
        continue;
      }
      const absolute =
        filesystemRoot === null ? null : join(filesystemRoot, String(scope.path ?? ''));
      if (filesystemRoot !== null && scope.exists && !existsSync(absolute)) {
        problems.push({
          spec: spec.id,
          message: `declares scope "${scope.path}" as existing, but it is not there`,
        });
      }
      if (filesystemRoot !== null && !scope.exists && existsSync(absolute)) {
        problems.push({
          spec: spec.id,
          message: `declares scope "${scope.path}" as new, but it already exists`,
        });
      }
      if (!roots.some((root) => withinRoot(scope.path, `${root}/`))) {
        problems.push({
          spec: spec.id,
          message: `scope "${scope.path}" lies outside every declared language root`,
        });
      }
    }
    for (const criterion of spec.acceptance ?? []) {
      if (criterion.verifiedBy !== undefined && !commandIds.has(criterion.verifiedBy)) {
        problems.push({
          spec: spec.id,
          message: `acceptance cites undeclared command "${criterion.verifiedBy}"`,
        });
      }
    }
  }

  const active = specs.filter((spec) => spec.status === 'ready' || spec.status === 'in-flight');
  for (let left = 0; left < active.length; left += 1) {
    for (let right = left + 1; right < active.length; right += 1) {
      for (const a of active[left].scope ?? []) {
        for (const b of active[right].scope ?? []) {
          if (scopesOverlap(a.path, b.path)) {
            problems.push({
              spec: active[left].id,
              message: `scope "${a.path}" collides with ${active[right].id}'s "${b.path}"; their workers would edit the same files`,
            });
          }
        }
      }
    }
  }
  return { problems, metrics: { specsTotal: specs.length } };
}

/**
 * Reads every specification file in a project.
 *
 * @param root - Absolute project root.
 * @returns Parsed specifications plus one problem per unreadable file.
 */
export function readSpecs(root) {
  const directory = join(root, SPECS);
  const specs = [];
  const problems = [];
  let entries;
  try {
    entries = readdirSync(directory)
      .filter((entry) => entry.endsWith('.json'))
      .sort();
  } catch {
    return { specs, problems };
  }
  for (const entry of entries) {
    try {
      specs.push(JSON.parse(readFileSync(join(directory, entry), 'utf8')));
    } catch (error) {
      problems.push({ spec: `${SPECS}/${entry}`, message: `cannot be parsed: ${String(error)}` });
    }
  }
  return { specs, problems };
}

/**
 * Builds the answer shared by the tools when no manifest exists.
 *
 * The message is self-contained on purpose. An earlier version ended with "see
 * `docs/specs/README.md` for the format", and nothing in this package, in the
 * harness, or in the deployment ever creates that file — so at the single moment
 * a reader most needs the format, the text pointed at a path that does not exist.
 * Naming the fields here costs a few more characters and cannot go stale.
 *
 * @param root - Absolute project root, or `null` when none was found.
 * @returns A canonical value naming the file to create and the fields it needs,
 *   so the failure is actionable without a second lookup.
 */
export function noManifest(root) {
  return {
    ok: false,
    reason:
      root === null
        ? `no ${MANIFEST} found in this directory or any parent, so this project declares no structure, rules or work orders`
        : `${MANIFEST} exists but could not be read`,
    fix:
      `create ${MANIFEST} with "name" (used by every tool answer), "languages" (each with ` +
      '"id", "roots" and "extensions", so source files can be found), "verification" (each with ' +
      '"id", "command", "purpose" and "path"), "rules" (each with "id", "statement", "statedIn" ' +
      'and "enforcedBy"), and "scopes" (each with "resolver" and "root"). Architecture ' +
      'decisions are a separate section of the same file, read by the ratchet plugin.',
  };
}

/**
 * Gathers the decision records as structured facts, for reconciliation.
 *
 * The reconciler's job is to notice that a new decision contradicts an old one, which is a question
 * about meaning and therefore not decidable by comparing text mechanically. What *is* mechanical is
 * collecting the material: every record's identifier, status, one-line decision and consequences,
 * with the boilerplate and the prose formatting stripped, so a reader (a model) reasons over the
 * decisions rather than over four hundred lines of markdown.
 *
 * Each record's `decision` is deliberately the first paragraph only. A record's rationale lives in
 * Context and its trade-offs in Consequences; a contradiction is nearly always between Decision
 * statements, and sending whole documents makes the comparison noisier without making it better.
 *
 * @param root - Absolute project root.
 * @returns One entry per record, sorted by identifier, plus any record that could not be read.
 */
export function readDecisions(root) {
  const directory = join(root, 'docs', 'decisions');
  const records = [];
  const problems = [];
  let entries;
  try {
    entries = readdirSync(directory)
      .filter((entry) => entry.endsWith('.md'))
      .sort();
  } catch {
    return { records, problems };
  }

  /** Extracts one section's text, flattened to a single line. */
  const section = (source, heading) => {
    // The section ends at the next `##` heading or at end of input. An earlier version also allowed
    // whitespace to end it, which matched immediately and returned null for every section.
    const match = new RegExp(
      `^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`,
      'm',
    ).exec(source);
    if (match === null) {
      return null;
    }
    const body = (match[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      // Table rows are flattened away: the reconciler compares what was decided, and a shell of pipe
      // characters adds tokens without adding a decision.
      .filter((line) => line.length > 0 && !line.startsWith('|'))
      .join(' ')
      .replace(/\s+/g, ' ');
    return body.length === 0 ? null : body;
  };

  for (const entry of entries) {
    const path = `docs/decisions/${entry}`;
    let source;
    try {
      source = readFileSync(join(directory, entry), 'utf8').replace(/\r\n/g, '\n');
    } catch (error) {
      problems.push({ record: path, message: `cannot be read: ${String(error)}` });
      continue;
    }
    const status = section(source, 'Status') ?? '';
    const supersededBy = /Superseded by\s+(\d{4})/.exec(status)?.[1] ?? null;
    // Consequences are truncated: their "Revisit if" clause matters for reconciliation, but a record
    // can run to a page of rationale that adds tokens without adding a decision. The full text stays
    // where it belongs, in the record, which the reader can open.
    const consequences = section(source, 'Consequences');
    records.push({
      id: entry.slice(0, 4),
      path,
      title: (/^#\s+(.*)$/m.exec(source)?.[1] ?? '').replace(/^\d{4}\s*[—-]\s*/, '').trim(),
      status,
      supersededBy,
      decision: section(source, 'Decision'),
      consequences:
        consequences === null || consequences.length <= 400
          ? consequences
          : `${consequences.slice(0, 400)}…`,
    });
  }

  return { records, problems };
}
