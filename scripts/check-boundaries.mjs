#!/usr/bin/env node
/**
 * PURPOSE
 *   Two boundaries of this kit were held by the orchestrator's memory: (1) outside the harness
 *   seam, kit code does not import the harness's internals (node_modules/@deepseek-ai/...);
 *   (2) every state has ONE writer — the board through the taskboard, the Analysis Record
 *   through the analysis plugin, the case library through the case library, the project ledger
 *   through the project-state core. This check turns both into findings, with a named exception
 *   list where a deliberate reach is recorded together with its owner and its reason.
 *
 * WHAT IT CHECKS
 *   I-SEAM-ONLY    an import statement in kit code whose specifier is a harness package that is
 *                  not part of the plugin API the kit declares in every plugin's package.json
 *                  (@deepseek-ai/cordis, @deepseek-ai/dsh-tools), reaches inside a harness
 *                  package (@deepseek-ai/<pkg>/<subpath>), or resolves into the installed
 *                  harness directory (node_modules/@deepseek-ai/). The seam,
 *                  plugins/orchestrator/harness-seam.mjs (docs/ARCHITECTURE.md §3), is where
 *                  such a reach is allowed.
 *   I-ONE-WRITER   a write call (writeFile*, appendFile*, createWriteStream, copyFile*, rename*,
 *                  rmSync, unlinkSync, truncateSync, writeSync) whose arguments name a state's
 *                  file or directory, in a file outside the state's owning component — plus a
 *                  module outside the owner that imports the owner's store module.
 *
 * WHAT IT DOES NOT CHECK
 *   Reads: reading a state is not a write. Comments are stripped, so a package named in prose is
 *   not a finding. A package name passed as a string to a resolver (the godot-mcp bridge's
 *   @deepseek-ai/dsh-mcp-client) is wiring, not an import, and is not covered. The check reads
 *   source; it does not run the kit.
 *
 * ARCHITECTURE DRIFT (a report, never a finding)
 *   docs/ARCHITECTURE.md §2 names each component with its path. Both modes also print how that
 *   table compares with the tree: a declared path the tree does not have, and a scanned code file
 *   no declared path claims; a missing page says "архитектуры нет". The section never enters
 *   `open` or `stale` and never changes the exit code — a stale architecture page is a fact for
 *   the orchestrator and the architect, not a build failure.
 *
 *   A drift line is ONE line of counts (declared paths, paths the tree lacks, code files no
 *   component claims) followed by at most DRIFT_EXAMPLES examples: a list of eighty files stops
 *   being read, and an unread report names nothing. The complete lists stay in --json and behind
 *   --drift-all.
 *
 * EXCEPTIONS
 *   Each entry names the rule, the file, the matched literal, the OWNER and the REASON. An
 *   exception that no longer matches anything is a finding of its own (a stale exception), so the
 *   list cannot rot: retiring the code must retire the exception in the same change.
 *
 * USAGE
 *   node scripts/check-boundaries.mjs                 report: print findings and the architecture
 *                                                     drift, always exit 0
 *   node scripts/check-boundaries.mjs --check         gate: exit 1 on an unexcepted finding
 *   node scripts/check-boundaries.mjs --json          machine-readable result, the complete
 *                                                     architecture drift included
 *   node scripts/check-boundaries.mjs --drift-all     print every drifting path, not the examples
 *   node scripts/check-boundaries.mjs --list          the component inventory only
 *   node scripts/check-boundaries.mjs --root <dir>    scan <dir> (a pilot tree or a fixture)
 *
 * EXIT
 *   0  report mode, or gate mode with nothing outside the exceptions
 *   1  gate mode found an unexcepted finding or a stale exception
 *   2  an exception names a rule that does not exist
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Kit directories that hold production code. Docs, ledger, fixtures and caches are not scanned. */
export const CODE_ROOTS = ['plugins', 'scripts', 'profile']

/** Directories whose files are fixtures, not production: a test writes into a temporary tree. */
const FIXTURE_DIRS = new Set(['node_modules', 'test', 'tests', 'proof', 'dist', '.git', '.tmp', '.cache', '.dsh'])

/** The one place allowed to reach into harness internals. */
export const SEAM = 'plugins/orchestrator/harness-seam.mjs'

/** The architecture page whose component table names paths in the tree. */
export const ARCHITECTURE_FILE = 'docs/ARCHITECTURE.md'

/** How many drifting paths the report prints before it says how many are left (--drift-all shows all). */
export const DRIFT_EXAMPLES = 5

/** The two invariants this check knows (docs/analysis/architecture-boundaries.json). */
export const RULES = ['I-SEAM-ONLY', 'I-ONE-WRITER']

/** The harness surface the kit declares as its plugin API in every plugin's package.json. */
export const DECLARED_SURFACE = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools']

/**
 * The states of this kit, each with its one writer. "paths" are the literals a code path must
 * name to write that state; "stores" are the owner's modules no other component may import.
 */
export const STATES = [
  {
    id: 'board',
    name: 'таскборд',
    owner: 'plugins/taskboard',
    invariant: 'I-ONE-WRITER',
    paths: ['taskboard.rows.json', 'taskboard.links.json'],
    stores: ['plugins/taskboard/taskboard.mjs'],
  },
  {
    id: 'analysis',
    name: 'запись анализа',
    owner: 'plugins/analysis',
    invariant: 'I-ONE-WRITER',
    paths: ['docs/analysis', "docs', 'analysis'"],
    stores: ['plugins/analysis/store.mjs'],
  },
  {
    id: 'cases',
    name: 'библиотека кейсов',
    owner: 'plugins/test-cases',
    invariant: 'I-ONE-WRITER',
    paths: ['docs/cases', "docs', 'cases'"],
    stores: ['plugins/test-cases/lib/store.mjs', 'plugins/test-cases/lib/journal.mjs'],
  },
  {
    id: 'ledger',
    name: 'журнал проекта',
    owner: 'plugins/project-state',
    invariant: 'I-ONE-WRITER',
    paths: ["state', 'events.jsonl'", 'state/events.jsonl', "state', 'views'", 'state/views'],
    stores: ['plugins/project-state/lib/core.mjs'],
  },
]

/**
 * Named exceptions. Every one carries an owner (the role that answers for the reach) and a reason
 * (why the reach is deliberate). "match" is the literal the finding carries.
 */
export const EXCEPTIONS = [
  {
    id: 'seam-retainer',
    rule: 'I-SEAM-ONLY',
    file: 'plugins/run-code-projection/run-code-projection.mjs',
    match: '@deepseek-ai/dsh-output-retention',
    owner: 'BACKEND',
    reason:
      'the head/tail cut geometry of a large tool result is the retainer the harness already applies; a second implementation here would drift from it',
  },
  {
    id: 'ledger-merge',
    rule: 'I-ONE-WRITER',
    file: 'scripts/state-merge.mjs',
    match: 'plugins/project-state/lib/core.mjs',
    owner: 'orchestrator',
    reason:
      'a pull that stops on state/ is resolved by this script (AGENTS.md, "The project ledger across machines"); it writes the whole ledger through the core service, never around it, and only while a merge is in progress',
  },
  {
    id: 'ledger-migrate',
    rule: 'I-ONE-WRITER',
    file: 'scripts/state-migrate.mjs',
    match: 'plugins/project-state/lib/core.mjs',
    owner: 'BACKEND',
    reason:
      'one-off fill of the ledger from the sources that predate it; it runs against a workspace the human names, writes nothing outside state/, and goes through the core service so the journal stays replayable',
  },
  {
    id: 'board-migrate',
    rule: 'I-ONE-WRITER',
    file: 'scripts/taskboard-migrate.mjs',
    match: 'plugins/taskboard/taskboard.mjs',
    owner: 'BACKEND',
    reason:
      'an operator runs it with --apply to bring a legacy board (222 tasks, 11 role rows) to the role contract; a plugin-boot migration would rewrite a live board behind a running chat',
  },
  {
    id: 'seam-ptc-render',
    rule: 'I-SEAM-ONLY',
    file: 'plugins/tool-families/tool-families.mjs',
    match: '@deepseek-ai/dsh-tool-executor-ptc',
    owner: 'BACKEND',
    reason:
      'the SDK declarations of the generated tool surface are rendered by the executor that consumes them; a second renderer would describe a different surface than the one executed',
  },
]

const WRITE_CALL =
  /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|copyFileSync|copyFile|renameSync|rmSync|unlinkSync|truncateSync|writeSync)\s*\(/g

/** Strip block and line comments so a package named in prose is not a finding. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')
}

/** Every import-ish specifier in stripped source: from, import(...), require(...). */
export function importSpecifiers(code) {
  const found = []
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g
  let match
  while ((match = re.exec(code)) !== null) found.push({ specifier: match[1], index: match.index })
  return found
}

/** The argument text of each write call, from the opening parenthesis to its matching close. */
export function writeCalls(code) {
  const calls = []
  WRITE_CALL.lastIndex = 0
  let match
  while ((match = WRITE_CALL.exec(code)) !== null) {
    let depth = 0
    let text = ''
    for (let at = match.index + match[0].length - 1; at < code.length && text.length < 400; at += 1) {
      const char = code[at]
      if (char === '(') depth += 1
      else if (char === ')') {
        depth -= 1
        if (depth === 0) break
      }
      text += char
    }
    calls.push({ function: match[1], index: match.index, text })
  }
  return calls
}

/** The harness package a specifier names, or '' when it names no harness package. */
export function harnessPackage(specifier) {
  if (specifier.startsWith('@deepseek-ai/')) return specifier.split('/').slice(0, 2).join('/')
  if (specifier.includes('node_modules/@deepseek-ai/') || specifier.includes('node_modules\\@deepseek-ai')) return '@deepseek-ai/'
  return ''
}

/** Classify one harness import. Null when it is part of the declared plugin API. */
export function seamViolation(file, specifier) {
  const pkg = harnessPackage(specifier)
  if (pkg === '') return null
  if (specifier.includes('node_modules')) {
    return { rule: 'I-SEAM-ONLY', kind: 'install-path', file, match: specifier, detail: 'imports a path into the installed harness' }
  }
  if (specifier.split('/').length > 2) {
    return { rule: 'I-SEAM-ONLY', kind: 'deep-import', file, match: specifier, detail: 'imports inside the harness package ' + pkg }
  }
  if (!DECLARED_SURFACE.includes(pkg)) {
    return {
      rule: 'I-SEAM-ONLY',
      kind: 'undeclared-package',
      file,
      match: specifier,
      detail: 'imports ' + pkg + ', which is not the plugin API every kit plugin declares',
    }
  }
  return null
}

/** All scanned code files under <root>, kit-relative with forward slashes, in path order. */
export function codeFiles(root) {
  const files = []
  const walk = (dir, prefix) => {
    let entries = []
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix + '/' + entry.name
      if (entry.isDirectory()) {
        if (FIXTURE_DIRS.has(entry.name)) continue
        walk(join(dir, entry.name), rel)
        continue
      }
      if (!/\.(mjs|js|cjs|mts|ts)$/.test(entry.name)) continue
      if (/\.test\.mjs$|-proof\.mjs$|\.d\.ts$/.test(entry.name)) continue
      files.push(rel)
    }
  }
  for (const codeRoot of CODE_ROOTS) {
    try {
      if (!statSync(join(root, codeRoot)).isDirectory()) continue
    } catch {
      continue
    }
    walk(codeRoot, codeRoot)
  }
  return files
}

/** Is <file> inside <dir>? Kit-relative, forward slashes. */
export function inside(file, dir) {
  return file === dir || file.startsWith(dir + '/')
}

/**
 * The component paths docs/ARCHITECTURE.md declares: the backticked literals of the FIRST column
 * of the table whose header cell says "Компонент" (§2, "Компоненты, владельцы, контракты"). The
 * second column names state paths and consumers, not components, so it is not read. A literal is
 * a path when it has a separator or a file extension.
 *
 * @param {string} markdown - the architecture page's text.
 * @returns {string[]|null} the declared paths; `null` when the page has no component table.
 */
export function architecturePaths(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  const header = lines.findIndex((line, index) => {
    if (!line.trim().startsWith('|')) return false
    if (!/компонент/i.test(line.split('|')[1] ?? '')) return false
    // A real table header: the separator row follows it.
    return /^\|[\s:|-]+\|$/.test((lines[index + 1] ?? '').trim())
  })
  if (header < 0) return null
  const paths = []
  for (const line of lines.slice(header + 1)) {
    if (!line.trim().startsWith('|')) break
    const first = line.split('|')[1] ?? ''
    for (const match of first.matchAll(/`([^`]+)`/g)) {
      const token = match[1].trim()
      if (token !== '' && (token.includes('/') || /\.(mjs|js|cjs|mts|ts|json|yml|yaml|sh|ps1)$/.test(token))) paths.push(token)
    }
  }
  return paths
}

/**
 * How docs/ARCHITECTURE.md's component table compares with the tree. A REPORT, never a finding:
 * `scan()` keeps it out of `open` and `stale`, so the gate's verdict and exit codes do not move.
 *
 *   present: false     - no architecture page: nothing to compare, and not a failure;
 *   components: false  - the page has no component table: nothing to compare;
 *   missing            - declared paths the tree does not have;
 *   unowned            - scanned code files no declared path claims.
 *
 * @param {string} [root] - the tree to compare against.
 * @param {string[]} [files] - its scanned code files (kit-relative, forward slashes).
 */
export function architectureDrift(root = KIT, files = codeFiles(root)) {
  const file = ARCHITECTURE_FILE
  let markdown
  try {
    markdown = readFileSync(join(root, file), 'utf8')
  } catch {
    return { present: false, components: false, file, paths: [], missing: [], unowned: [] }
  }
  const paths = architecturePaths(markdown)
  if (paths === null) return { present: true, components: false, file, paths: [], missing: [], unowned: [] }
  const claimed = (rel) => paths.some((path) => inside(rel, path.endsWith('/') ? path.slice(0, -1) : path))
  return {
    present: true,
    components: true,
    file,
    paths,
    missing: paths.filter((path) => !existsSync(join(root, path))),
    unowned: files.filter((rel) => !claimed(rel)),
  }
}

/** Scan one root: the findings, the findings an exception waived, and the stale exceptions. */
export function scan(root = KIT) {
  const findings = []
  const files = codeFiles(root)
  for (const file of files) {
    const rel = file.split('\\').join('/')
    let code
    try {
      code = stripComments(readFileSync(join(root, file), 'utf8'))
    } catch (error) {
      findings.push({ rule: 'I-SEAM-ONLY', kind: 'unreadable', file: rel, match: '', detail: String(error.message ?? error) })
      continue
    }
    const imports = importSpecifiers(code)
    if (rel !== SEAM) {
      for (const entry of imports) {
        const violation = seamViolation(rel, entry.specifier)
        if (violation !== null) findings.push(violation)
      }
    }
    const calls = writeCalls(code)
    for (const state of STATES) {
      for (const store of state.stores) {
        if (rel === store) continue
        const storeName = store.split('/').pop()
        const ownerName = state.owner.split('/').pop()
        const borrowed = imports.some((entry) => entry.specifier.endsWith(storeName) && entry.specifier.includes(ownerName))
        if (!borrowed) continue
        findings.push({
          rule: 'I-ONE-WRITER',
          kind: 'store-import',
          file: rel,
          match: store,
          detail: 'reaches the ' + state.name + ' writer through ' + store + ', outside ' + state.owner,
          state: state.id,
        })
      }
      if (inside(rel, state.owner)) continue
      for (const call of calls) {
        const named = state.paths.find((fragment) => call.text.includes(fragment))
        if (named === undefined) continue
        findings.push({
          rule: 'I-ONE-WRITER',
          kind: 'second-writer',
          file: rel,
          match: named,
          detail: call.function + ' writes "' + named + '", a ' + state.name + ' path ' + state.owner + ' owns',
          state: state.id,
        })
      }
    }
  }
  const waived = []
  const stale = []
  for (const exception of EXCEPTIONS) {
    const hit = findings.find(
      (finding) => finding.rule === exception.rule && finding.file === exception.file && finding.match === exception.match,
    )
    if (hit === undefined) stale.push(exception)
    else waived.push({ exception, finding: hit })
  }
  const open = findings.filter((finding) => !waived.some((entry) => entry.finding === finding))
  return { root, scanned: files.length, findings, open, waived, stale, architecture: architectureDrift(root, files) }
}

export function main(argv = process.argv.slice(2), root = KIT) {
  const at = argv.indexOf('--root')
  const scanRoot = at >= 0 && argv[at + 1] !== undefined ? resolve(argv[at + 1]) : root
  const gate = argv.includes('--check')
  const json = argv.includes('--json')
  const driftAll = argv.includes('--drift-all')
  const known = new Set(RULES)
  const unknown = EXCEPTIONS.filter((exception) => !known.has(exception.rule))
  if (unknown.length > 0) {
    console.error('boundaries: exception(s) name a rule that does not exist: ' + unknown.map((entry) => entry.id + '=' + entry.rule).join(', '))
    return 2
  }
  const result = scan(scanRoot)
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return gate && (result.open.length > 0 || result.stale.length > 0) ? 1 : 0
  }
  console.log('boundaries: ' + (gate ? 'gate' : 'report') + ' over ' + result.scanned + ' code file(s) under ' + scanRoot)
  console.log('  inventory: ' + STATES.length + ' state(s) with one writer, seam ' + SEAM + ', ' + EXCEPTIONS.length + ' named exception(s)')
  for (const finding of result.open) {
    const state = finding.state === undefined ? '' : ' [' + finding.state + ']'
    console.log('  FINDING ' + finding.rule + state + ' ' + finding.file + ': ' + finding.detail + ' (' + finding.match + ')')
  }
  for (const entry of result.waived) {
    console.log('  excepted ' + entry.exception.rule + ' ' + entry.exception.file + ': ' + entry.exception.id + ' — owner ' + entry.exception.owner)
  }
  for (const exception of result.stale) {
    console.log('  STALE EXCEPTION ' + exception.id + ' (' + exception.rule + ' ' + exception.file + ' "' + exception.match + '"): nothing matches it any more — retract it or restore the code')
  }
  const drift = result.architecture
  if (drift.present === false) {
    console.log('  архитектуры нет (' + drift.file + ') — сверять нечего')
  } else if (drift.components === false) {
    console.log('  в ' + drift.file + ' нет таблицы компонентов — сверять нечего')
  } else if (drift.missing.length === 0 && drift.unowned.length === 0) {
    console.log('  архитектура сходится с деревом (' + drift.file + ')')
  } else {
    // One line of counts, then a few examples. The full list is a flag away: a report nobody
    // finishes reading names nothing, and the counts are the fact the reader needs either way.
    const drifting = [
      ...drift.missing.map((path) => 'нет такого пути: ' + path),
      ...drift.unowned.map((file) => 'файл кода вне компонентов: ' + file),
    ]
    console.log(
      '  архитектура расходится с деревом (' + drift.file + '): объявлено путей: ' + drift.paths.length +
        ', нет в дереве: ' + drift.missing.length + ', файлов кода вне компонентов: ' + drift.unowned.length,
    )
    const shown = driftAll ? drifting : drifting.slice(0, DRIFT_EXAMPLES)
    for (const line of shown) console.log('    ' + line)
    if (shown.length < drifting.length) {
      console.log('    ещё ' + (drifting.length - shown.length) + ' — полный список: --drift-all или --json')
    }
  }
  const red = result.open.length + result.stale.length
  if (!gate) {
    console.log(
      '  report: ' + result.open.length + ' unexcepted finding(s), ' + result.waived.length + ' excepted, ' + result.stale.length + ' stale — this run enforces nothing',
    )
    return 0
  }
  console.log(
    red === 0
      ? '  gate: ok — ' + result.waived.length + ' excepted finding(s), nothing outside the boundaries'
      : '  gate: REFUSED — ' + result.open.length + ' unexcepted finding(s), ' + result.stale.length + ' stale exception(s)',
  )
  return red === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--list')) {
    for (const state of STATES) console.log('state\t' + state.id + '\t' + state.owner + '\t' + state.name + '\t' + state.paths.join(', '))
    for (const exception of EXCEPTIONS) console.log('exception\t' + exception.id + '\t' + exception.rule + '\t' + exception.file + '\towner ' + exception.owner + '\t' + exception.match)
    process.exit(0)
  }
  process.exit(main())
}
