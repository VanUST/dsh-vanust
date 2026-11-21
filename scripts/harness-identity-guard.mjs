/**
 * PURPOSE
 *   Make one defect class impossible instead of repairing its instances: an event stored as
 *   `user/message` (or any other message type) whose message carries no `id`. The harness
 *   persists an injected message verbatim — `agent.inject()` never stamps an identity — and
 *   validates identities only at LOAD time (`adoptSessionEvent()` in `@deepseek-ai/dsh-session`,
 *   error "session event at seq N lacks an identified message"). One such event makes the
 *   WHOLE session refuse to open, so the cost is the session, not the message. The state-feed
 *   plugin was one producer of it (fixed in @cc/dsh-state-feed 0.1.2); any future producer would
 *   repeat the failure, and every already-written log would keep blocking until repaired.
 *
 * WHY A HARNESS PATCH AND NOT A PLUGIN
 *   The two places that decide this are both inside the pinned harness and both are reached
 *   before a plugin runs: `snapshotAppend()` accepts whatever a producer passes, and
 *   `adoptSessionEvent()` is what refuses the load. A plugin can only fix its own producer. The
 *   kit therefore patches the two functions and re-applies the patch on every boot through
 *   `scripts/kit-update.mjs` — an `npm install` of the harness would otherwise silently restore
 *   the defect.
 *
 * WHAT IT CHANGES (three marks, one file:
 * <install>/node_modules/@deepseek-ai/dsh-session/lib/index.js)
 *   1. an `import { createHash, randomUUID } from "node:crypto";` line at the top;
 *   2. WRITE — `snapshotAppend()` stamps a missing identity with a fresh UUID, so no producer
 *      can write an unidentified message again;
 *   3. LOAD — `adoptSessionEvent()` stamps a missing identity with a deterministic id derived
 *      from the event, so a log written before the guard opens instead of refusing.
 *   The deterministic form matters: the same stored event receives the same identity on every
 *   load, so a repaired log does not develop new ids each time the UI opens it.
 *
 * INPUTS
 *   --check          exit 0 when patched, 3 when unpatched, 1 when an anchor cannot be found
 *   --apply          patch in place (idempotent; keeps one <file>.pre-identity-guard backup)
 *   --revert         restore the backup
 *   --probe          import the installed harness module and exercise both marks for real:
 *                    append an unidentified message (write guard) and adopt a legacy event
 *                    (load guard); exit 0 green, 3 red. Run it after --revert and after --apply:
 *                    the red must be the real refusal, not an assertion.
 *   --install <dir>  harness install root; default `$DSH_INSTALL_DIR`
 *   --json           one JSON document on stdout instead of the human lines
 *
 * OUTPUTS
 *   { state: 'patched' | 'unpatched' | 'unrecognized' | 'absent', path, sha256,
 *     patches: [{ id, applied }] }, or for --probe { state, probe: { load, write, detail } }.
 *
 * INVARIANTS
 *   - An anchor that does not occur exactly once is 'unrecognized': the harness version changed,
 *     nothing is written, and exit 1 says a human must re-read the code. Guessing would corrupt
 *     a file the whole machine boots from.
 *   - --apply writes only the marks that are missing; a second --apply changes no byte.
 *   - --revert without a backup writes nothing and says so.
 *   - The probe never mocks the guard: it calls the same exported functions the harness calls.
 *
 * KEYWORDS
 *   harness, session, identity, patch, idempotent, convergence, adoptSessionEvent
 */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PACKAGE = ['node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js']
const BACKUP_SUFFIX = '.pre-identity-guard'
const MARK = 'dsh-kit identity guard'
const WRITE_TYPES = 'type === "user/message" || type === "developer/message" || type === "system/message" || type === "assistant/message" || type === "tool/result"'
const LOAD_TYPES = 'event.type === "user/message" || event.type === "developer/message" || event.type === "system/message" || event.type === "assistant/message" || event.type === "tool/result"'

/** The three edits, as exact anchors and the text that replaces each one. */
const PATCHES = [
  {
    id: 'import',
    marker: 'import { createHash, randomUUID } from "node:crypto";',
    find: 'import { Service } from "@deepseek-ai/cordis";\nimport { isAbsolute } from "node:path";',
    replace: 'import { Service } from "@deepseek-ai/cordis";\nimport { createHash, randomUUID } from "node:crypto";\nimport { isAbsolute } from "node:path";',
  },
  {
    id: 'write',
    marker: '// ' + MARK + ' (write)',
    find: '\tconst dataSnapshot = snapshotJsonValue(data);\n\tif (dataSnapshot === void 0) throw new Error(`${subject} carries non-JSON-serializable data`);',
    replace: [
      '\tconst dataSnapshot = snapshotJsonValue(data);',
      '\tif (dataSnapshot === void 0) throw new Error(`${subject} carries non-JSON-serializable data`);',
      '\t// ' + MARK + ' (write): a message is stored with an identity, whichever producer built it.',
      '\tif (' + WRITE_TYPES + ') {',
      '\t\tconst guarded = type === "user/message" ? dataSnapshot : dataSnapshot?.["message"];',
      '\t\tif (typeof guarded === "object" && guarded !== null && (typeof guarded["id"] !== "string" || guarded["id"] === "")) guarded["id"] = randomUUID();',
      '\t}',
    ].join('\n'),
  },
  {
    id: 'load',
    marker: '// ' + MARK + ' (load)',
    find: '\tvalidateSessionEventData(event, `session event at seq ${event.seq}`);\n\tvalidateSurfaceMetadata(event);\n\tassertMessageEventShape(event, `session event at seq ${event.seq}`);',
    replace: [
      '\tvalidateSessionEventData(event, `session event at seq ${event.seq}`);',
      '\tvalidateSurfaceMetadata(event);',
      '\t// ' + MARK + ' (load): a legacy event gains the identity it should have carried; the session opens.',
      '\tif (' + LOAD_TYPES + ') {',
      '\t\tconst guarded = event.type === "user/message" ? event.data : event.data?.["message"];',
      '\t\tif (typeof guarded === "object" && guarded !== null && !Object.isFrozen(guarded) && (typeof guarded["id"] !== "string" || guarded["id"] === ""))',
      '\t\t\tguarded["id"] = "recovered-" + createHash("sha256").update(event.type + ":" + String(event.seq) + ":" + JSON.stringify(guarded)).digest("hex").slice(0, 32);',
      '\t}',
      '\tassertMessageEventShape(event, `session event at seq ${event.seq}`);',
    ].join('\n'),
  },
]

/** Node's own directory; npm's global install sits beside it on Windows. */
const NODE_DIR = dirname(process.execPath)
/** The npm CLI behind the Windows `npm.cmd` shim - a plain argv spawn of the shim is refused. */
const NPM_CLI = join(NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js')
/** Where npm puts global packages on Windows when no custom prefix is configured. */
const GLOBAL_BIN = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm')

/** The global npm root, asked of npm itself; undefined when npm cannot answer. */
function globalNpmRoot() {
  const result = process.platform === 'win32' && existsSync(NPM_CLI)
    ? spawnSync(process.execPath, [NPM_CLI, 'root', '-g'], { encoding: 'utf8' })
    : spawnSync('npm', ['root', '-g'], { encoding: 'utf8' })
  const text = (result.stdout ?? '').trim()
  const answered = result.status === 0 && text !== ''
  if (answered) return text
  // Windows runs npm through a .cmd shim that a plain argv spawn cannot start, and a
  // machine with no npm on PATH still has its global packages in the conventional place.
  if (process.platform === 'win32' && existsSync(join(GLOBAL_BIN, 'node_modules'))) return join(GLOBAL_BIN, 'node_modules')
  return undefined
}

/** Resolve the harness install root: --install, then $DSH_INSTALL_DIR, then the global layouts. */
function installRoot(argv) {
  const index = argv.indexOf('--install')
  if (index !== -1) {
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('-')) throw new Error('--install needs a directory')
    return value
  }
  const env = process.env.DSH_INSTALL_DIR
  if (env !== undefined && env !== '') return env
  const candidates = []
  const root = globalNpmRoot()
  if (root !== undefined) candidates.push(join(root, '@deepseek-ai', 'dsh'))
  candidates.push(join(dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh'))
  for (const candidate of candidates) if (existsSync(join(candidate, ...PACKAGE))) return candidate
  throw new Error('no harness install root: pass --install <dir>, set DSH_INSTALL_DIR, or install @deepseek-ai/dsh globally')
}

/** The one file the guard edits. */
function targetPath(root) {
  return join(root, ...PACKAGE)
}

/** Whether every mark is present in the text. */
function marks(text) {
  return PATCHES.map((patch) => ({ id: patch.id, applied: text.includes(patch.marker) }))
}

/** Read the target and report what is missing, without writing. */
function inspect(path) {
  const text = readFileSync(path, 'utf8')
  const patches = marks(text)
  const state = patches.every((p) => p.applied) ? 'patched' : 'unpatched'
  return { state, path, sha256: createHash('sha256').update(text).digest('hex'), patches }
}

/** Insert every missing mark; refuse the whole write when an anchor is not exactly once. */
function apply(path) {
  const original = readFileSync(path, 'utf8')
  let text = original
  const applied = []
  for (const patch of PATCHES) {
    if (text.includes(patch.marker)) continue
    const count = text.split(patch.find).length - 1
    if (count !== 1) throw new Error('anchor for the ' + patch.id + ' mark occurs ' + count + ' time(s), expected exactly 1; the harness version changed, nothing was written')
    text = text.replace(patch.find, () => patch.replace)
    applied.push(patch.id)
  }
  if (text === original) return { ...inspect(path), applied }
  const backup = path + BACKUP_SUFFIX
  if (!existsSync(backup)) copyFileSync(path, backup)
  writeFileSync(path, text)
  return { ...inspect(path), applied }
}

/** Restore the backup, if this script made one. */
function revert(path) {
  const backup = path + BACKUP_SUFFIX
  if (!existsSync(backup)) return { state: 'absent', path, detail: 'no backup; nothing to revert' }
  copyFileSync(backup, path)
  return inspect(path)
}

/**
 * Drive both marks through the installed module's own exports: append an unidentified message
 * to a real Session (write guard), then adopt a legacy event (load guard).
 */
async function probe(path) {
  const module = await import(pathToFileURL(path).href)
  const { Session, adoptSessionEvent } = module
  if (typeof Session !== 'function' || typeof adoptSessionEvent !== 'function') return { load: false, write: false, detail: 'the module does not export Session/adoptSessionEvent' }

  const message = () => ({ role: 'user', content: [{ type: 'text', text: 'probe' }], source: { kind: 'probe' } })
  const legacy = { type: 'user/message', seq: 7, time: 1, data: message(), surfaceOp: 'append' }

  let load = false
  let loadDetail = ''
  try {
    const adopted = adoptSessionEvent(structuredClone(legacy))
    load = typeof adopted.data.id === 'string' && adopted.data.id !== ''
    loadDetail = load ? 'adopted id=' + adopted.data.id : 'adopted without an id'
  } catch (error) {
    loadDetail = 'refused: ' + String(error.message ?? error)
  }

  let write = false
  let writeDetail = ''
  try {
    const session = Session.create('identity-guard-probe')
    const event = session.append('user/message', message(), { surfaceOp: 'append' })
    write = typeof event.data.id === 'string' && event.data.id !== ''
    writeDetail = write ? 'appended id=' + event.data.id : 'appended without an id'
  } catch (error) {
    writeDetail = 'append failed: ' + String(error.message ?? error)
  }

  return { load, write, detail: { load: loadDetail, write: writeDetail } }
}

/** CLI: one command per run; unknown flags are a usage error. */
async function main(argv) {
  const json = argv.includes('--json')
  const command = argv.includes('--probe') ? 'probe' : argv.includes('--apply') ? 'apply' : argv.includes('--revert') ? 'revert' : 'check'
  let root
  try {
    root = installRoot(argv)
  } catch (error) {
    process.stderr.write('identity-guard: ' + String(error.message ?? error) + '\n')
    return 2
  }
  const path = targetPath(root)
  if (!existsSync(path)) {
    process.stderr.write('identity-guard: the harness module is not installed at ' + path + '\n')
    return 1
  }

  let report
  let code = 0
  try {
    if (command === 'probe') {
      const probeReport = await probe(path)
      report = { state: probeReport.load && probeReport.write ? 'patched' : 'unpatched', path, probe: probeReport }
      code = probeReport.load && probeReport.write ? 0 : 3
    } else if (command === 'apply') {
      report = apply(path)
      code = report.state === 'patched' ? 0 : 3
    } else if (command === 'revert') {
      report = revert(path)
      code = report.state === 'patched' ? 0 : 3
    } else {
      report = inspect(path)
      code = report.state === 'patched' ? 0 : 3
    }
  } catch (error) {
    const message = String(error.message ?? error)
    const unrecognized = message.includes('expected exactly 1')
    report = { state: unrecognized ? 'unrecognized' : 'error', path, detail: message }
    code = 1
  }

  if (json) process.stdout.write(JSON.stringify(report) + '\n')
  else if (report.probe !== undefined) process.stdout.write('identity-guard: ' + report.state + ' (load: ' + report.probe.detail.load + '; write: ' + report.probe.detail.write + ')\n')
  else if (report.detail !== undefined) process.stdout.write('identity-guard: ' + report.state + ' - ' + report.detail + '\n')
  else process.stdout.write('identity-guard: ' + report.state + ' ' + path + ' [marks: ' + report.patches.filter((p) => p.applied).map((p) => p.id).join(',') + ']\n')
  return code
}

process.exitCode = await main(process.argv.slice(2))
