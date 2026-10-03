/**
 * PURPOSE
 *   One command that turns the newest DeepSeek usage export in your Downloads folder into the
 *   shipped aggregate report, without you unzipping anything or naming a path.
 *
 *   It exists because "run the analyser" used to mean four steps that differ per machine: find
 *   the file, find the platform's download directory, extract the archive, then work out which
 *   directory the analyser wants. Every one of those is a place to get it wrong, and none of
 *   them is about usage. So the whole sequence lives here and `make usage` is a one-line alias.
 *
 *   The archive reader is written out rather than shelled out on purpose. There is no `unzip`
 *   on a default Windows install and no `Expand-Archive` on Linux, so shelling out would mean
 *   two code paths and a different failure on each. A zip's central directory is a simple
 *   structure, and Node already carries the one piece that is not (`zlib.inflateRawSync`).
 *
 * INPUTS
 *   `--downloads <dir>`  Directory to scan. Default: this machine's Downloads folder —
 *                        `$XDG_DOWNLOAD_DIR` or `~/Downloads` on Linux, `%USERPROFILE%\Downloads`
 *                        on Windows, `~/Downloads` elsewhere.
 *   `--zip <file>`       Use this archive instead of scanning.
 *   `--pattern <glob>`   Filename pattern to look for. Default `usage_data_*.zip`.
 *   `--out <file>`       Report path. Default `docs/usage/<YYYY-MM>.html`, derived from the export.
 *   `--print`            Also print the report to stdout.
 *   `--no-open`          Do not launch a browser.
 *   `--open-with <cmd>`  Use this launcher instead of the platform default (`start` via cmd on
 *                        Windows, `open` on macOS, `xdg-open` elsewhere).
 *
 * OUTPUTS
 *   Writes the report, prints the resolved paths, and by default opens the page in a browser.
 *   Exit 0 on success; 1 when the analysis refuses (identity material), or when the analyser
 *   fails; 2 on a usage error or when no export is found — naming the directory that was
 *   scanned and the pattern that was used, so "nothing happened" never has to be guessed at.
 *   A launcher that cannot be found is a warning, not a failure: the report is already on disk.
 *
 * KEYWORDS
 *   usage, cost, downloads, zip, cross-platform, xdg, one command, makefile
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No Downloads directory (a container, a fresh account): exit 2 naming the path it tried and
 *     pointing at `--downloads`.
 *   - Several exports: the one with the newest modification time wins, and the run says which.
 *   - An archive with no CSV, or with the CSVs nested in a folder: the whole archive is searched,
 *     and an archive with nothing usable is reported as such rather than extracted empty.
 *   - An entry using a compression method other than stored or deflate: reported with the method
 *     number rather than returning garbage bytes.
 *   - The report directory does not exist: it is created.
 *   - The temporary extraction directory is always removed, including on failure.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { inflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ANALYZER = join(HERE, 'analyze-usage.mjs')

const USAGE = [
  'Usage: node scripts/usage-from-downloads.mjs [options]',
  '',
  '  --downloads <dir>  directory to scan (default: this machine\'s Downloads folder)',
  '  --zip <file>       use this archive instead of scanning',
  '  --pattern <glob>   filename pattern to look for (default usage_data_*.zip)',
  '  --out <file>       report path (default docs/usage/<YYYY-MM>.html)',
  '  --print            also print the report to stdout',
  '  --no-open          do not launch a browser (for scripts and CI)',
  '  --open-with <cmd>  use this launcher instead of the platform default',
].join('\n')

/**
 * Parse argv.
 *
 * @param argv - Arguments after the script name.
 * @returns The resolved options.
 * @throws On an unknown flag or a flag without a value.
 */
function parseArgs(argv) {
  const options = { downloads: null, zip: null, pattern: 'usage_data_*.zip', out: null, print: false, noOpen: false, openWith: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      i += 1
      return value
    }
    switch (arg) {
      case '--downloads': options.downloads = next(); break
      case '--zip': options.zip = next(); break
      case '--pattern': options.pattern = next(); break
      case '--out': options.out = next(); break
      case '--print': options.print = true; break
      case '--no-open': options.noOpen = true; break
      case '--open-with': options.openWith = next(); break
      case '--help': options.help = true; break
      default: throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

/**
 * This machine's Downloads folder.
 *
 * Windows keeps it at `%USERPROFILE%\Downloads` and macOS at `~/Downloads`. Linux is the awkward
 * one: the folder is a user setting, `XDG_DOWNLOAD_DIR` in `~/.config/user-dirs.dirs`, and it is
 * a shell assignment there rather than a plain path — so it is read and unquoted, and `~/Downloads`
 * is the fallback for a machine that never wrote the file.
 *
 * @returns The absolute path to use. Not guaranteed to exist; the caller reports that.
 */
function downloadsDir() {
  if (process.platform === 'win32') {
    const profile = process.env.USERPROFILE ?? homedir()
    return join(profile, 'Downloads')
  }
  const config = join(homedir(), '.config', 'user-dirs.dirs')
  try {
    const line = readFileSync(config, 'utf8')
      .split(/\r?\n/)
      .find((entry) => entry.trim().startsWith('XDG_DOWNLOAD_DIR'))
    if (line !== undefined) {
      const value = line.slice(line.indexOf('=') + 1).trim().replace(/^"|"$/g, '')
      if (value.length > 0) return value.replace(/^\$HOME/, homedir())
    }
  } catch {
    // No user-dirs.dirs: the conventional location is the answer, not a failure.
  }
  return join(homedir(), 'Downloads')
}

/**
 * Turn a shell-style glob into a regular expression.
 *
 * Only `*` and `?` are honoured, which is all this tool's pattern needs, and the whole name is
 * anchored: a pattern is a filename filter, not a substring search.
 *
 * @param glob - The pattern, e.g. `usage_data_*.zip`.
 * @returns An anchored RegExp.
 */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

/**
 * Find the newest archive matching a pattern in a directory.
 *
 * @param dir - Directory to scan.
 * @param pattern - Filename glob.
 * @returns `{ path, name, mtime, candidates }`, or null when the directory does not exist.
 *   `candidates` is every match, so the caller can say how many were considered.
 */
function newestExport(dir, pattern) {
  let names
  try {
    if (!statSync(dir).isDirectory()) return null
    names = readdirSync(dir)
  } catch {
    return null
  }
  const matcher = globToRegExp(pattern)
  const matches = names
    .filter((name) => matcher.test(name))
    .map((name) => ({ name, path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
    // Newest wins. A tie — two exports written in the same instant, or a filesystem with coarse
    // timestamps — must not be decided by readdir order, so it falls back to the filename
    // descending, which for `usage_data_<from>_<to>.zip` means the later period.
    .sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
  if (matches.length === 0) return { path: null, name: null, mtime: 0, candidates: [] }
  return { ...matches[0], candidates: matches }
}

/**
 * Read a zip archive into memory.
 *
 * Walks the central directory rather than the local headers, because only the central directory
 * is authoritative about entry count and offsets; the local headers may carry zeroed sizes when
 * a stream was written with a data descriptor. Stored and deflated entries are both supported,
 * which is every method a platform export uses.
 *
 * @param path - Absolute path to the archive.
 * @returns A Map of entry name to `{ method, bytes }` where `bytes` is the uncompressed Buffer.
 * @throws When the file is not a zip, when the central directory is damaged, or when an entry
 *   uses a compression method this reader does not implement.
 */
function readZip(path) {
  const buf = readFileSync(path)
  if (buf.length < 22) throw new Error(`${path} is too short to be a zip archive`)

  // The end-of-central-directory record sits at the very end, after a comment that may be up to
  // 64 KiB, so the search runs backwards over that window.
  let eocd = -1
  const floor = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error(`${path} is not a zip archive: no end-of-central-directory record`)

  const count = buf.readUInt16LE(eocd + 10)
  const directoryOffset = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  let cursor = directoryOffset
  for (let n = 0; n < count; n += 1) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`${path} is damaged: central directory entry ${n} is not a file header`)
    }
    const method = buf.readUInt16LE(cursor + 10)
    const compressedSize = buf.readUInt32LE(cursor + 20)
    const nameLength = buf.readUInt16LE(cursor + 28)
    const extraLength = buf.readUInt16LE(cursor + 30)
    const commentLength = buf.readUInt16LE(cursor + 32)
    const localOffset = buf.readUInt32LE(cursor + 42)
    const name = buf.toString('utf8', cursor + 46, cursor + 46 + nameLength)

    // The local header repeats the name and extra field, at its own lengths, so the data offset
    // is computed from the LOCAL header rather than reused from the central one.
    const localNameLength = buf.readUInt16LE(localOffset + 26)
    const localExtraLength = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buf.subarray(dataStart, dataStart + compressedSize)

    let bytes
    if (method === 0) bytes = Buffer.from(raw)
    else if (method === 8) bytes = inflateRawSync(raw)
    else throw new Error(`${name} in ${path} uses compression method ${method}, which this reader does not implement`)

    entries.set(name, { method, bytes })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * Decide whether a command can be run.
 *
 * Checked BEFORE spawning so the answer is synchronous. A browser launcher that does not exist
 * (a headless Linux box with no `xdg-open`) would otherwise fail inside an asynchronous `error`
 * event that the process may exit before observing, turning "no browser here" into a silent
 * nothing. A path with a separator is tested directly; a bare name is searched on PATH, with
 * the platform's executable extensions on Windows.
 *
 * @param command - The launcher name or path.
 * @returns True when something runnable was found.
 */
function hasCommand(command) {
  if (command.includes('/') || command.includes('\\')) return existsSync(command)
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const extension of extensions) {
      try {
        if (existsSync(join(dir, command + extension))) return true
      } catch {
        // An unreadable PATH entry is not a match, and must not stop the search.
      }
    }
  }
  return false
}

/**
 * Open the report in a browser.
 *
 * Detached and unref'd because a launcher must not hold this command open: `xdg-open` blocks
 * until the browser exits, so waiting on it would leave the terminal hanging for as long as the
 * page is open. A launcher that cannot be found is reported and ignored — the report is already
 * on disk by then, which is the outcome that matters.
 *
 * @param path - Absolute path to the report.
 * @param custom - A launcher name to use instead of the platform default, or null.
 * @returns Nothing.
 */
function openReport(path, custom) {
  let command
  let args
  if (custom !== null) {
    command = custom
    args = []
  } else if (process.platform === 'win32') {
    // `start` is a cmd builtin, and its first quoted argument is taken as the window TITLE, so an
    // empty one is passed before the path or a quoted path would be swallowed as the title.
    command = 'cmd'
    args = ['/c', 'start', '']
  } else if (process.platform === 'darwin') {
    command = 'open'
    args = []
  } else {
    command = 'xdg-open'
    args = []
  }

  if (!hasCommand(command)) {
    process.stderr.write(`usage: no browser launcher found (${command}) — open ${path} yourself\n`)
    return
  }
  process.stdout.write(`usage: opening ${path}\n`)
  const child = spawn(command, [...args, path], { detached: true, stdio: 'ignore' })
  child.on('error', (error) => {
    process.stderr.write(`usage: could not launch a browser (${error.code ?? error.message}) — open ${path} yourself\n`)
  })
  child.unref()
}

/**
 * Entry point.
 *
 * @returns The process exit code.
 */
function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`)
    return 2
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  let archive = options.zip
  let considered = 1
  if (archive === null) {
    const dir = resolve(options.downloads ?? downloadsDir())
    const found = newestExport(dir, options.pattern)
    if (found === null) {
      process.stderr.write(`usage: no directory at ${dir}\n  pass --downloads <dir>, or set one that exists.\n`)
      return 2
    }
    if (found.path === null) {
      process.stderr.write(`usage: nothing matching ${options.pattern} in ${dir}\n  download an export, or pass --zip <file>.\n`)
      return 2
    }
    archive = found.path
    considered = found.candidates.length
    process.stdout.write(`usage: newest export in ${dir}\n  ${found.name}${considered > 1 ? `  (chosen from ${considered} matches)` : ''}\n`)
  }

  const temp = mkdtempSync(join(tmpdir(), 'usage-extract-'))
  try {
    let entries
    try {
      entries = readZip(archive)
    } catch (error) {
      process.stderr.write(`usage: ${error.message}\n`)
      return 2
    }
    const csvs = [...entries.entries()].filter(([name]) => /\.csv$/i.test(name))
    if (csvs.length === 0) {
      process.stderr.write(`usage: ${archive} holds no CSV (${entries.size} entries)\n`)
      return 2
    }
    // Flattened to their basenames: the analyser discovers `cost-*.csv` and `amount-*.csv`, and
    // an archive the platform nested inside a folder must not defeat that.
    let wrote = 0
    for (const [name, entry] of csvs) {
      const base = name.split(/[\\/]/).pop()
      writeFileSync(join(temp, base), entry.bytes)
      wrote += 1
    }
    process.stdout.write(`usage: extracted ${wrote} CSV(s)\n`)

    const check = spawnSync(process.execPath, [ANALYZER, '--dir', temp, '--check'], { encoding: 'utf8' })
    if (check.status !== 0) {
      process.stderr.write(check.stderr || check.stdout || 'usage: the redaction gate refused this export\n')
      return 1
    }
    process.stdout.write(check.stdout)

    // The report name comes from the export's own first date, so a run is reproducible and a
    // fresh download does not silently overwrite a different month's report.
    let out = options.out
    if (out === null) {
      const stamp = /(\d{4})-(\d{2})-\d{2}/.exec(archive.split(/[\\/]/).pop())
      out = join('docs', 'usage', `${stamp === null ? 'usage' : `${stamp[1]}-${stamp[2]}`}.html`)
    }
    mkdirSync(dirname(resolve(out)), { recursive: true })
    const write = spawnSync(process.execPath, [ANALYZER, '--dir', temp, '--html', '--out', out], { encoding: 'utf8' })
    if (write.status !== 0) {
      process.stderr.write(write.stderr || 'usage: the analyser failed\n')
      return 1
    }
    process.stdout.write(`usage: report written to ${resolve(out)}\n`)
    if (options.print) process.stdout.write(`${readFileSync(resolve(out), 'utf8')}\n`)
    // Launching is the default because the page IS the deliverable: a path printed to a terminal
    // is a second step the human did not ask for. `--no-open` exists so a script or a CI run is
    // not made to depend on a desktop session.
    if (!options.noOpen) openReport(resolve(out), options.openWith)
    return 0
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

process.exit(main())
