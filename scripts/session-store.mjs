/**
 * PURPOSE
 *   Keep one unreadable session log from taking the whole history down, because the
 *   harness does not: `dsh-session-persistence-jsonl`'s listArtifacts() tolerates only
 *   `SessionFormatUnsupportedError` and `SessionPersistenceCorruptionError` and rethrows
 *   everything else, and the `open()` inside readFirstZstdLine() is not wrapped. So a
 *   single file the OS refuses (EPERM from an on-access security scanner is what this
 *   machine produces, twice: 2026-11-03 and 2026-11-10) aborts the entire cross-workspace
 *   listing, the `workspace` plugin never activates, and four plugins that inject
 *   `workspaceRegistry` stay pending — `session-controller`, `workspace-controller`,
 *   `schedule`, `ui-deliverables`. The UI then serves an empty history and cannot create
 *   a chat, which reads as "all my chats are gone" when every byte is still on disk.
 *
 *   WHY A BOOT GUARD AND NOT A DOCUMENTED PROCEDURE. The failure is invisible until the
 *   UI is already useless, and the recovery is a directory move an operator has to
 *   remember at exactly the moment they have no history to read the procedure from. The
 *   launcher calls `ensure` before `exec dsh web`, so the machine heals itself and says
 *   what it moved.
 *
 *   WHY PROBE AND NOT DECOMPRESS. The probe reproduces the harness's own access — `open`
 *   plus a first read — because that is the exact call that throws. Decompressing instead
 *   would quarantine files the harness is happy to skip as corrupt, and would turn a
 *   0.2 s preflight into a full scan of the store.
 *
 * INPUTS
 *   <command>            ensure (default) | doctor
 *                        `ensure` quarantines what the OS refuses and exits 0 so the boot
 *                        continues; `doctor` moves nothing and exits 1 when it finds a
 *                        refused file, so it can be a check.
 *   --home <path>        harness home. Default $DSH_HOME, else ~/.npm/dsh.
 *   --quarantine <path>  where moved session directories land. Default
 *                        $DSH_HOME/sessions-quarantine.
 *   --retries <n>        read attempts per file before it counts as refused. Default 3.
 *   --delay <ms>         wait between attempts, so a scanner mid-scan gets to finish.
 *                        Default 300.
 *   --concurrency <n>    files probed in flight. Default 8.
 *   --max-age-minutes <n>  never move a session directory written more recently than this:
 *                        a fresh mtime means somebody is writing it. Default 60.
 *   --quiet              print only when something was quarantined or refused (the boot
 *                        path uses this, so a clean store costs no output).
 *   --verbose            name every probed file, not only the refused ones.
 *   --json               one JSON object on stdout instead of human lines.
 *
 * OUTPUTS
 *   Exit 0 when the guard ran (`ensure`), or when `doctor` found nothing refused; 1 when
 *   `doctor` found a refused file; 2 on a usage error. A quarantined directory keeps every
 *   byte and gains a README.txt naming the failing file, the errno, the attempts and the
 *   restore command; one line per move is appended to `$QUARANTINE/preflight.log`.
 *
 * KEYWORDS
 *   session store, jsonl, EPERM, quarantine, workspaceRegistry, activation, boot guard
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No sessions directory, or a host with no sessions yet: reported as a first run and
 *     treated as clean. A missing store is not a defect.
 *   - A file that vanishes mid-probe (ENOENT): skipped, not quarantined — the harness
 *     treats the same case as a skip.
 *   - A dir with a fresh mtime: reported as in use and left alone even when refused, since
 *     moving a session another process is writing would corrupt a live turn.
 *   - Two runs racing for the same directory name: the second target gets `-2`, `-3`, …
 *     rather than overwriting a quarantine that already holds somebody's bytes.
 *   - Cross-device `--quarantine`: falls back from rename to copy-then-remove.
 *   - `ensure` never fails the boot. If the guard itself cannot run it prints
 *     `session-store: warning: …` and exits 0, because a broken guard must not cost the
 *     user the harness as well.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join, resolve } from 'node:path'

const SESSION_FILE = /^session\.v\d+\.jsonl(?:\.zstd)?$/
// The errnos an interceptor or a filesystem can return for a file that is otherwise
// fine. ENOENT is not here: a file that disappeared is the harness's own skip case.
const REFUSED = new Set(['EPERM', 'EACCES', 'EBUSY', 'EIO', 'EAGAIN', 'ETXTBSY'])
const PROBE_BYTES = 8192

const USAGE = `usage: node scripts/session-store.mjs <ensure|doctor> [options]

  ensure                  quarantine session logs the OS refuses to read, then exit 0
  doctor                  report what ensure would do; moves nothing

  --home <path>           harness home (default $DSH_HOME, else ~/.npm/dsh)
  --quarantine <path>     where moved session dirs land (default $HOME/sessions-quarantine)
  --retries <n>           attempts per file before it counts as refused (default 3)
  --delay <ms>            wait between attempts (default 300)
  --concurrency <n>       files probed in flight (default 8)
  --max-age-minutes <n>   never move a dir written more recently than this (default 60)
  --quiet                 print only when something was quarantined or refused
  --verbose               name every probed file, not only the refused ones
  --json                  one JSON object on stdout`

class UsageError extends Error {}

/** Reads `--flag value` and `--flag=value` forms; the caller validates the numbers. */
function take(argv, name) {
  const inline = argv.find((a) => a.startsWith(`${name}=`))
  if (inline !== undefined) return inline.slice(name.length + 1)
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

const number = (value, name, fallback) => {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new UsageError(`${name} wants a non-negative number, got ${JSON.stringify(value)}`)
  return parsed
}

const stamp = (date = new Date()) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`

/** One `open` + first `read` + `close`, the harness's own access to a session artifact. */
async function probe(path) {
  const handle = await open(path, 'r')
  try {
    await handle.read(Buffer.alloc(PROBE_BYTES), 0, PROBE_BYTES, null)
  } finally {
    await handle.close()
  }
}

/**
 * Probe with retries. Returns `{ verdict }` where verdict is one of:
 * `readable`, `missing`, `refused` (with the last errno).
 */
async function probeWithRetries(path, retries, delay) {
  let last = null
  for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
    try {
      await probe(path)
      return { verdict: 'readable', attempts: attempt }
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : null
      if (code === 'ENOENT') return { verdict: 'missing', attempts: attempt }
      if (code === null || !REFUSED.has(code)) {
        // An unexpected failure is reported as refused rather than thrown: the guard's job
        // is to keep the store listable, and "unknown" here means the harness would die
        // on it too.
        last = { code: code ?? String(error?.message ?? error), message: String(error?.message ?? error) }
        break
      }
      last = { code, message: String(error?.message ?? error) }
      if (attempt < retries) await new Promise((r) => setTimeout(r, delay))
    }
  }
  return { verdict: 'refused', attempts: Math.max(1, retries), ...last }
}

/** Runs `worker` over `items` with at most `limit` in flight, preserving order. */
async function settleLimited(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(lanes)
  return results
}

/** Every `{ project, session, dir, files }` under the store. */
function collect(home) {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return { root, projects: 0, entries: [] }
  const entries = []
  const projects = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())
  for (const project of projects) {
    const projectDir = join(root, project.name)
    for (const session of readdirSync(projectDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const dir = join(projectDir, session.name)
      let names
      try {
        names = readdirSync(dir)
      } catch (error) {
        // An unreadable session DIRECTORY is the same fatal class as an unreadable file.
        entries.push({ project: project.name, session: session.name, dir, files: [], dirError: error?.code ?? String(error) })
        continue
      }
      const files = names.filter((name) => SESSION_FILE.test(name)).map((name) => join(dir, name))
      if (files.length > 0) entries.push({ project: project.name, session: session.name, dir, files })
    }
  }
  return { root, projects: projects.length, entries }
}

/** Free target path for a moved dir, never overwriting an earlier quarantine. */
function freeTarget(quarantine, session) {
  const base = `${session}-${stamp()}`
  let candidate = join(quarantine, base)
  for (let n = 2; existsSync(candidate); n += 1) candidate = join(quarantine, `${base}-${n}`)
  return candidate
}

function quarantine(input) {
  const { quarantineRoot, entry, finding } = input
  mkdirSync(quarantineRoot, { recursive: true })
  const target = freeTarget(quarantineRoot, entry.session)
  try {
    renameSync(entry.dir, target)
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    mkdirSync(target, { recursive: true })
    for (const name of readdirSync(entry.dir)) copyFileSync(join(entry.dir, name), join(target, name))
    rmSync(entry.dir, { recursive: true, force: true })
  }
  const readme = [
    'QUARANTINED DSH SESSION — moved by scripts/session-store.mjs',
    '============================================================',
    '',
    `Session directory : ${entry.session}`,
    `Project directory : ${entry.project}`,
    `Moved from        : ${entry.dir}`,
    `Moved to          : ${target}`,
    `Moved at          : ${new Date().toISOString()} on ${hostname()}`,
    '',
    'WHY',
    '---',
    `The OS refused to read ${finding.file.split(/[\\/]/).pop()} for the harness:`,
    `${finding.code} after ${finding.attempts} attempt(s) — ${finding.message}`,
    '',
    'dsh-session-persistence-jsonl treats any error that is not a recognised corruption or',
    'an unsupported format as fatal, so this one file aborted the whole cross-workspace',
    'session listing. The `workspace` plugin then failed to activate and four plugins',
    '(session-controller, workspace-controller, schedule, ui-deliverables) stayed pending:',
    'the UI showed no history and could not create a chat.',
    '',
    'FILES',
    '-----',
    ...readdirSync(target)
      .filter((name) => name !== 'README.txt')
      .map((name) => {
        const size = (() => {
          try {
            return statSync(join(target, name)).size
          } catch {
            return '?'
          }
        })()
        return `${name}  ${size} bytes`
      }),
    'Nothing here was modified or deleted: the directory was moved whole.',
    '',
    'TO RESTORE',
    '----------',
    'Only once the reader no longer refuses it. Re-test first (a scanner mid-scan is',
    'transient; a cached deny is not). If the refusal was a mode, fix that first:',
    '',
    `  chmod 600 "${join(target, finding.file.split(/[\\/]/).pop())}"  # only when the mode was the cause`,
    `  for i in $(seq 30); do head -c 8192 "${join(target, finding.file.split(/[\\/]/).pop())}" >/dev/null || echo BLOCKED; done`,
    '',
    'Then move the directory back under its original name — dsh keys on that name and',
    'rejects a duplicate session id appearing in two project directories:',
    '',
    `  mkdir -p "${join(input.home, 'sessions', entry.project)}"`,
    `  mv "${target}" "${entry.dir}"`,
    '',
  ].join('\n')
  writeFileSync(join(target, 'README.txt'), readme, 'utf8')
  writeFileSync(
    join(quarantineRoot, 'preflight.log'),
    `${new Date().toISOString()} ${entry.project}/${entry.session} ${finding.code} after ${finding.attempts} attempt(s) -> ${target}\n`,
    { encoding: 'utf8', flag: 'a' },
  )
  return target
}

async function run(argv) {
  const command = argv.find((a) => !a.startsWith('-')) ?? 'ensure'
  if (command === '--help' || command === '-h' || argv.includes('--help')) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if (command !== 'ensure' && command !== 'doctor') throw new UsageError(`unknown command ${JSON.stringify(command)}; expected ensure or doctor`)

  const apply = command === 'ensure'
  const home = resolve(take(argv, '--home') ?? process.env.DSH_HOME ?? join(homedir(), '.npm', 'dsh'))
  const quarantineRoot = resolve(take(argv, '--quarantine') ?? join(home, 'sessions-quarantine'))
  const retries = number(take(argv, '--retries'), '--retries', 3)
  const delay = number(take(argv, '--delay'), '--delay', 300)
  const concurrency = number(take(argv, '--concurrency'), '--concurrency', 8)
  const maxAgeMinutes = number(take(argv, '--max-age-minutes'), '--max-age-minutes', 60)
  const quiet = argv.includes('--quiet')
  const verbose = argv.includes('--verbose')
  const json = argv.includes('--json')
  const out = json ? () => {} : quiet ? () => {} : (line) => process.stdout.write(`${line}\n`)
  // `--quiet` still reports what it DID: the moves and the refusals it left alone are the
  // reason the UI is about to behave differently, so they are not silence.
  const say = (line) => process.stdout.write(`${line}\n`)

  const store = collect(home)
  if (store.entries.length === 0) {
    if (json) process.stdout.write(`${JSON.stringify({ home, sessions: 0, readable: 0, refused: [], quarantined: [], inUse: [], firstRun: true })}\n`)
    else out(`session-store: no sessions under ${store.root} yet — nothing to check`)
    return 0
  }

  const findings = await settleLimited(store.entries, concurrency, async (entry) => {
    // An unreadable session DIRECTORY is the same fatal class as an unreadable file: the
    // harness dies listing it, so it is quarantined without probing what is inside.
    if (entry.dirError !== undefined) return { entry, verdict: 'refused', file: entry.dir, code: entry.dirError, attempts: 1, message: `readdir failed: ${entry.dirError}` }
    const probes = await settleLimited(entry.files, 1, (file) => probeWithRetries(file, retries, delay))
    const refusedAt = probes.findIndex((r) => r.verdict === 'refused')
    if (refusedAt !== -1) return { entry, verdict: 'refused', file: entry.files[refusedAt], ...probes[refusedAt] }
    if (probes.every((r) => r.verdict === 'missing')) return { entry, verdict: 'missing' }
    return { entry, verdict: 'readable' }
  })

  const refused = findings.filter((f) => f.verdict === 'refused')
  const inUse = []
  const moving = []
  for (const finding of refused) {
    let ageMinutes = Number.POSITIVE_INFINITY
    try {
      ageMinutes = (Date.now() - statSync(finding.entry.dir).mtimeMs) / 60000
    } catch {
      // A dir whose stat itself fails is old enough to move by definition.
    }
    if (ageMinutes < maxAgeMinutes) inUse.push({ ...finding, ageMinutes })
    else moving.push(finding)
  }

  const quarantined = []
  for (const finding of moving) {
    if (!apply) {
      quarantined.push({ entry: finding.entry, planned: true, file: finding.file, code: finding.code })
      continue
    }
    try {
      const target = quarantine({ quarantineRoot, entry: finding.entry, finding, home })
      quarantined.push({ entry: finding.entry, target, file: finding.file, code: finding.code })
    } catch (error) {
      process.stderr.write(`session-store: warning: could not quarantine ${finding.entry.dir}: ${String(error?.message ?? error)}\n`)
    }
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        home,
        sessions: store.entries.length,
        projects: store.projects,
        readable: findings.filter((f) => f.verdict === 'readable').length,
        refused: refused.map((f) => ({ project: f.entry.project, session: f.entry.session, file: f.file, code: f.code, attempts: f.attempts })),
        quarantined: quarantined.map((q) => ({ project: q.entry.project, session: q.entry.session, target: q.target ?? null, planned: q.planned === true })),
        inUse: inUse.map((f) => ({ project: f.entry.project, session: f.entry.session, code: f.code, ageMinutes: Math.round(f.ageMinutes) })),
      })}\n`,
    )
    return (refused.length === 0 || apply) ? 0 : 1
  }

  if (verbose) for (const f of findings) out(`  ${f.verdict.padEnd(9)} ${f.entry.project}/${f.entry.session}${f.file === undefined ? '' : ` (${f.file.split(/[\\/]/).pop()})`}`)
  for (const q of quarantined) {
    // `doctor` says what `ensure` would do and stops there, so the two never read as if
    // something had already been moved.
    const where =
      q.planned === true
        ? `would move to ${quarantineRoot} — doctor moves nothing`
        : `moved to ${q.target}, README.txt holds the restore steps`
    say(`session-store: ${q.entry.project}/${q.entry.session} was refused (${q.code}) — ${where}`)
  }
  for (const f of inUse) {
    say(`session-store: ${f.entry.project}/${f.entry.session} was refused (${f.code}) but was written ${Math.round(f.ageMinutes)} min ago — left alone, re-run once that session is idle`)
  }
  if (quarantined.length === 0 && inUse.length === 0 && !verbose) out(`session-store: ${findings.length} session log(s) readable, nothing quarantined`)
  return (refused.length === 0 || apply) ? 0 : 1
}

try {
  const code = await run(process.argv.slice(2))
  process.exitCode = code
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`session-store: ${error.message}\n\n${USAGE}\n`)
    process.exitCode = 2
  } else {
    // The guard must never be the reason a boot fails.
    process.stderr.write(`session-store: warning: ${String(error?.stack ?? error)}\n`)
    process.exitCode = 0
  }
}
