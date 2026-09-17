#!/usr/bin/env node
/**
 * PURPOSE
 *   Refuse a test that is an assertion engine rather than a behaviour check. A
 *   test that only proves an exported object has a method or a field, that only
 *   proves a mock exists or was called, or whose expected value is computed by
 *   the code under test, cannot fail for the reason the product is wrong: it
 *   passes while the behaviour it names is broken, and it fails when the shape
 *   is merely renamed. Those shapes are the ones this command reports.
 *
 *   It exists because the deployment rules require every test to name the break
 *   it catches and to exercise the real thing, and a rule with no command that
 *   fails when it is broken enforces nothing. This is that command for the test
 *   corpus.
 *
 * INPUTS
 *   `--root <dir>`  project root to scan (default: the current directory).
 *   `--strict`      exit 1 when findings exist. Default is report mode: the
 *                   findings are printed and the exit is 0, so the corpus can be
 *                   measured before the rule becomes a gate.
 *   `--json`        print the findings as one JSON document instead of lines.
 *   Scanned files: `scripts/test-*.mjs`, `plugins/<name>/test-*.mjs` and every
 *   `.mjs` under `test/`, resolved under the root. A file that cannot be read
 *   makes the run unusable (exit 2) rather than silently clean.
 *
 * OUTPUTS
 *   One line per finding, `<relative path>:<line> <CODE> <message>`, then a
 *   summary line. Exit 0 = nothing found, or findings in report mode; 1 =
 *   findings under `--strict`; 2 = the root or a scanned file could not be read,
 *   so "nothing was checked" is never reported as "nothing is wrong".
 *
 * KEYWORDS
 *   test quality, assertion engine, shape assertion, change detector, mirror
 *   assertion, mock assertion, behaviour verification, rule enforcement
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Missing `--root`: the current directory is used.
 *   - No test files: exit 2, because a lint over an empty test set proves nothing
 *     and a moved test directory must not read as a pass.
 *   - A line carrying `test-quality:allow <reason>` (on the finding's line or the
 *     line before it) is exempt.
 *   - Heuristic by construction: it matches shapes, not semantics. A finding is a
 *     question to answer, not a verdict; the inline allow is how an answered
 *     question stops being reported.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Finding codes, with the wording each prints. */
export const CODES = {
  SHAPE_TYPEOF: 'asserts a member is a function rather than exercising it',
  SHAPE_MEMBER: 'asserts a module member exists rather than what it does',
  MIRROR: 'expected value is computed by the call under test',
  MOCK_ONLY: 'asserts a mock was called rather than what the real code produced',
}

/** @returns True when the path exists and is a directory. */
function isDir(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** @returns True when a directory entry is a test module by convention. */
function isTestName(name) {
  return /^test-.*\.mjs$/.test(name) || /^test\.mjs$/.test(name)
}

/** Collect `*.mjs` test modules under a directory, recursively. */
function walk(dir, found) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (isDir(path)) walk(path, found)
    else if (/\.mjs$/.test(entry)) found.push(path)
  }
}

/**
 * Resolve the test files under a root.
 *
 * @param root - Absolute project root.
 * @returns Absolute paths of matching test files, sorted. Empty when none exist.
 */
export function testFilesFor(root) {
  const found = []
  const scriptsDir = join(root, 'scripts')
  if (isDir(scriptsDir)) {
    for (const entry of readdirSync(scriptsDir)) {
      if (isTestName(entry)) found.push(join(scriptsDir, entry))
    }
  }
  const pluginsDir = join(root, 'plugins')
  if (isDir(pluginsDir)) {
    for (const plugin of readdirSync(pluginsDir)) {
      const dir = join(pluginsDir, plugin)
      if (!isDir(dir)) continue
      for (const entry of readdirSync(dir)) {
        if (isTestName(entry)) found.push(join(dir, entry))
      }
    }
  }
  const testDir = join(root, 'test')
  if (isDir(testDir)) walk(testDir, found)
  return found.sort()
}

/**
 * Collect the identifiers a test file imports, so a shape assertion on a module
 * binding is distinguishable from a shape assertion on a computed value.
 *
 * @param text - File source.
 * @returns Set of imported binding names (default, named and namespace).
 */
export function importedBindings(text) {
  const names = new Set()
  for (const match of text.matchAll(/import\s+([^'"]+?)\s+from\s+['"]/g)) {
    const clause = match[1].trim()
    const named = clause.match(/\{([^}]*)\}/)
    if (named) {
      for (const part of named[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
      }
    }
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim()
    const nsMatch = rest.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
    if (nsMatch) names.add(nsMatch[1])
    else for (const name of rest.split(/\s+/)) {
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  for (const match of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(/g)) {
    names.add(match[1])
  }
  return names
}

/**
 * Analyse one test file for shape-only assertions.
 *
 * @param text - File source.
 * @returns Findings as `{ line, code, message }`, in line order.
 */
export function analyzeText(text) {
  const lines = text.split(/\r?\n/)
  const imports = importedBindings(text)
  const allowAt = new Set()
  lines.forEach((line, index) => {
    if (line.includes('test-quality:allow')) allowAt.add(index)
  })
  // A finding on line N is exempt when line N or N-1 carries the allow marker.
  const exempt = (lineNumber) => allowAt.has(lineNumber - 1) || allowAt.has(lineNumber - 2)

  const findings = []
  lines.forEach((line, index) => {
    const lineNumber = index + 1
    // A shape comparison inside a ternary is program logic, not an assertion;
    // only an assertion-bearing line (or the line that opened a call on the
    // previous line) is a candidate.
    if (!isAssertionLine(line) && !isAssertionLine(lines[index - 1] ?? '')) return
    const code = codeForLine(line, imports)
    if (code === null || exempt(lineNumber)) return
    findings.push({ line: lineNumber, code, message: CODES[code] })
  })
  return findings
}

/** @returns True when the line is an assertion-bearing line. */
function isAssertionLine(line) {
  return /\bassert\s*\.|\bclaim\s*\(|\bexpect\s*\(|\bshould\b/.test(line)
}

/**
 * Decide whether a line carries a shape-only assertion.
 *
 * @param line - The source line.
 * @param imports - Imported binding names, so a module member is distinguishable
 *   from a value a test computed.
 * @returns A finding code, or null.
 */
function codeForLine(line, imports) {
  const typeofMatch = line.match(/typeof\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*===?\s*['"]function['"]/)
  if (typeofMatch) return 'SHAPE_TYPEOF'
  const member = line.match(/(?:['"][\w$.-]+['"]\s+in\s+|hasOwnProperty\s*\(\s*['"][\w$.-]+['"]|propertyIsEnumerable\s*\(\s*['"][\w$.-]+['"]|Object\.prototype\.hasOwnProperty\.call\s*\(\s*)([A-Za-z_$][\w$]*)/)
  if (member && imports.has(member[1])) return 'SHAPE_MEMBER'
  const mirror = line.match(/\.(?:equal|deepEqual|deepStrictEqual|toEqual|toBe)\(\s*([^,]+?)\s*,\s*(.+?)\s*\)\s*$/)
  if (mirror && normalize(mirror[1]) === normalize(mirror[2])) return 'MIRROR'
  if (/(\.calls\.length|\.callCount|toHaveBeenCalled|toHaveBeenCalledTimes)/.test(line)) return 'MOCK_ONLY'
  return null
}

/** @returns Whitespace-normalized source text, for comparing two expressions. */
function normalize(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Analyse every test file under a root.
 *
 * @param root - Absolute project root.
 * @returns `{ files, findings }`, each finding carrying its path.
 */
export function scan(root) {
  const files = testFilesFor(root)
  const findings = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const finding of analyzeText(text)) findings.push({ path: file, ...finding })
  }
  return { files, findings }
}

/**
 * The command entry point.
 *
 * @param argv - Process argument vector (without the interpreter and script).
 * @returns The process exit code.
 */
export function main(argv) {
  const rootIndex = argv.indexOf('--root')
  const root = resolve(rootIndex === -1 ? process.cwd() : argv[rootIndex + 1])
  const strict = argv.includes('--strict')
  const json = argv.includes('--json')

  let result
  try {
    if (!isDir(root)) {
      process.stderr.write(`check-test-quality: root is not a directory: ${root}\n`)
      return 2
    }
    result = scan(root)
  } catch (error) {
    process.stderr.write(`check-test-quality: cannot scan ${root}: ${String(error)}\n`)
    return 2
  }

  // A lint over an empty test set proves nothing, so it is unusable rather than
  // clean: a moved or misnamed test directory must not read as a pass.
  if (result.files.length === 0) {
    process.stderr.write(`check-test-quality: no test files found under ${root}\n`)
    return 2
  }

  if (json) {
    const findings = result.findings.map((finding) => ({
      ...finding,
      path: relative(root, finding.path).split(sep).join('/'),
    }))
    process.stdout.write(`${JSON.stringify({ files: result.files.length, findings }, null, 2)}\n`)
  } else {
    for (const finding of result.findings) {
      const path = relative(root, finding.path).split(sep).join('/')
      process.stdout.write(`${path}:${finding.line} ${finding.code} ${finding.message}\n`)
    }
    process.stdout.write(
      `check-test-quality: ${result.findings.length} finding(s) across ${result.files.length} test file(s)` +
        `${strict ? ' (strict)' : ' (report mode)'}\n`,
    )
  }

  if (strict && result.findings.length > 0) return 1
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2))
}
