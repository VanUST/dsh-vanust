/**
 * PURPOSE
 *   Install — or report on — the external tools the kit's features need, so a fresh
 *   machine does not start with RTK silently inert, Headroom uninstalled, or the
 *   deck/diagram exports unable to render. Missing tools are a supported state (each
 *   feature degrades and says so), which is exactly why nobody notices them for
 *   weeks; this command makes the state explicit and fixable in one step.
 *
 *   WHY NOT ONLY DOCUMENT THEM. A dependency that lives in a README is a dependency
 *   every new machine gets wrong. The kit already pins and installs the harness, the
 *   profile and the plugin tarballs; the binaries belong in the same convergence.
 *
 * INPUTS
 *   --check            report only (default). Writes nothing.
 *   --apply            install what is missing. Never uses sudo.
 *   --json             one JSON object instead of a table.
 *   --only <ids>       comma-separated subset, e.g. "rtk,d2".
 *   --skip <ids>       comma-separated exclusions, e.g. "mermaid".
 *   --kit <path>       kit checkout. Default: the parent of this script.
 *   Environment: RTK_EDITION (default "oss" — Apache-2.0 only), SKIP_TOOLS (set 1 to
 *   make the installer skip this whole step).
 *
 * OUTPUTS
 *   Exit 0 when every selected tool is present or was installed; 1 when any is still
 *   missing after the run; 2 on a usage error. Prints per-tool status, the version it
 *   found, and the exact next command for a manual install.
 *
 * KEYWORDS
 *   provisioning, rtk, headroom, babysitter, marp, mermaid, d2, chrome, installer
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Already present (any version): never reinstalled, never fetched. The probe is
 *     the authority, so re-running is free and offline-safe.
 *   - No network: each install fails on its own and is reported with the manual
 *     command; the run continues, and the exit code says something is missing.
 *   - Windows: `--check` works everywhere, `--apply` refuses the POSIX-only installers
 *     with a message naming the equivalent (winget/choco), rather than half-installing.
 *   - A tool whose probe throws (corrupt binary) is reported missing, not present.
 *   - Chrome and ffmpeg are DETECTED ONLY: they are OS packages, and installing them
 *     under a user account is how a machine ends up with two browsers.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOCAL_BIN = join(homedir(), '.local', 'bin')
const DSH_HOME = resolve(process.env.DSH_HOME ?? join(homedir(), '.npm', 'dsh'))

/** Parse arguments; unknown flags are a usage error. */
function parseArgs(argv) {
  const options = { mode: 'check', json: false, only: null, skip: null, kit: resolve(join(HERE, '..')) }
  const known = new Set(['check', 'apply', 'json', 'only', 'skip', 'kit'])
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`unexpected argument ${token}`)
    const [key, inline] = token.slice(2).split('=')
    if (!known.has(key)) throw new Error(`unknown option --${key}`)
    if (key === 'check') { options.mode = 'check'; continue }
    if (key === 'apply') { options.mode = 'apply'; continue }
    if (key === 'json') { options.json = true; continue }
    const value = inline ?? argv[++index]
    if (value === undefined) throw new Error(`--${key} needs a value`)
    if (key === 'kit') options.kit = resolve(value)
    else options[key] = new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))
  }
  return options
}

/** Where a command may live: PATH first, then the per-user bin directories. */
function candidateDirs() {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const extra of [LOCAL_BIN, join(homedir(), '.cargo', 'bin'), join(homedir(), '.npm-global', 'bin')]) {
    if (!dirs.includes(extra)) dirs.push(extra)
  }
  return dirs
}

/**
 * Filename suffixes to try for one name on this platform.
 *
 * PURPOSE
 *   Reproduce the host's own executable resolution, which `statSync` does not do:
 *   Windows runs `node.exe` for the name `node` by appending PATHEXT, and asking
 *   for the bare name finds nothing.
 * INPUTS
 *   name - the requested tool name, e.g. 'node' or 'chrome.exe' (string).
 * OUTPUTS
 *   Array of suffixes to append, '' meaning the name as given. On POSIX, [''].
 *   On Windows, the PATHEXT list (lower-cased) for a name without a dot, because
 *   Windows never executes an extensionless file; [''] when the name already
 *   carries an extension, because that spelling is exact.
 * KEYWORDS
 *   PATHEXT, win32, executable resolution, which, provisioning
 *
 * The bare name is NOT tried first on Windows: `C:\Program Files\nodejs\npm` is a
 * POSIX shell script that exists next to `npm.cmd`, and spawning the former from
 * Node fails with EINVAL. Measured before this change: which('node'), which('git')
 * and which('powershell') all returned null while those programs run on the same
 * PATH, so every Windows probe reported a working tool as missing.
 */
function nameSuffixes(name) {
  if (process.platform !== 'win32') return ['']
  if (name.includes('.')) return ['']
  const configured = String(process.env.PATHEXT ?? '').split(';').map((entry) => entry.trim()).filter(Boolean)
  const suffixes = configured.length > 0 ? configured : ['.COM', '.EXE', '.BAT', '.CMD']
  return suffixes.map((suffix) => suffix.toLowerCase())
}

/** First path from a list that exists as a file, or null. */
function firstExisting(paths) {
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || candidate === '') continue
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Keep looking.
    }
  }
  return null
}

/** Resolve an executable by name across PATH and the per-user locations. */
export function which(names) {
  const list = Array.isArray(names) ? names : [names]
  for (const dir of candidateDirs()) {
    for (const name of list) {
      for (const suffix of nameSuffixes(name)) {
        const candidate = join(dir, `${name}${suffix}`)
        try {
          if (statSync(candidate).isFile()) return candidate
        } catch {
          // Not here; keep looking.
        }
      }
    }
  }
  return null
}

/**
 * Resolve a tool the way the OS would: by name on PATH, then by the install
 * locations the platform actually uses.
 *
 * PURPOSE
 *   A browser or a vendor tool is frequently installed but not on PATH, which is
 *   the normal case on Windows and macOS. Name-only probing reports it missing and
 *   makes a working feature look unavailable.
 * INPUTS
 *   tool - a TOOLS entry: { names: string[], known?: { [platform]: string[] } }.
 * OUTPUTS
 *   Absolute path (string), or null when neither PATH nor a known location has it.
 * KEYWORDS
 *   chrome, chromium, edge, detection, known locations, per-platform
 */
function resolveToolBin(tool) {
  const fromPath = which(tool.names)
  if (fromPath !== null) return fromPath
  const known = tool.known?.[process.platform] ?? []
  return firstExisting(known)
}

/** Run a probe command and return its first line, or null when it fails. */
function probeVersion(bin, args = ['--version']) {
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] })
    return String(out).trim().split('\n')[0].slice(0, 120) || 'present'
  } catch {
    return null
  }
}

/** Run an installer with inherited stdio so a human sees what is happening. */
function run(argv, env = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    timeout: 15 * 60_000,
  })
  return result.status === 0
}

/**
 * Run an async step up to three times.
 *
 * Measured on this deployment (2026-10-26): a web call commonly fails once or twice
 * and then succeeds. Provisioning a fresh machine over a flaky link is exactly the
 * case where a single attempt turns a working install into a reported failure.
 */
async function withRetry(step, attempts = 3) {
  let last
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await step()
    } catch (error) {
      last = error
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
  throw last
}

/** Download a URL to a temp file with Node's fetch (no curl dependency), with retries. */
async function download(url, target) {
  return withRetry(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    writeFileSync(target, buffer)
    return target
  })
}

/** Fetch a JSON API with retries. */
async function fetchJson(url) {
  return withRetry(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    return response.json()
  })
}

/** The tool set, in a stable order, with the probe and the installer for each. */
const TOOLS = [
  {
    id: 'rtk',
    label: 'RTK — command-aware output compression',
    required: false,
    names: ['rtk'],
    install: async (context) => {
      const edition = process.env.RTK_EDITION === '' ? 'oss' : (process.env.RTK_EDITION ?? 'oss')
      const script = join(tmpdir(), `rtk-install-${process.pid}.sh`)
      await download('https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh', script)
      return run(['sh', script], { RTK_EDITION: edition, RTK_INSTALL_DIR: LOCAL_BIN })
    },
    manual: 'RTK_EDITION=oss sh <(curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh)',
  },
  {
    id: 'headroom',
    label: 'Headroom — model-traffic compression proxy',
    required: false,
    names: ['headroom'],
    install: async () => {
      const uv = which('uv')
      if (uv === null) return false
      return run([uv, 'tool', 'install', '--python', '3.13', 'headroom-ai[proxy]'])
    },
    manual: 'uv tool install --python 3.13 "headroom-ai[proxy]"',
  },
  {
    id: 'babysitter',
    label: 'Babysitter — deterministic process runs',
    required: false,
    names: ['babysitter'],
    install: async () => {
      const npm = which('npm')
      return npm === null ? false : run([npm, 'install', '-g', '@a5c-ai/babysitter'])
    },
    manual: 'npm install -g @a5c-ai/babysitter',
  },
  {
    id: 'marp',
    label: 'Marp CLI — deck export to PDF/PPTX',
    required: false,
    names: ['marp'],
    install: async () => {
      const npm = which('npm')
      return npm === null ? false : run([npm, 'install', '-g', '@marp-team/marp-cli'])
    },
    manual: 'npm install -g @marp-team/marp-cli',
  },
  {
    id: 'mermaid',
    label: 'Mermaid CLI — render .mmd source',
    required: false,
    names: ['mmdc'],
    install: async () => {
      const npm = which('npm')
      if (npm === null) return false
      // No bundled Chromium: the machine already has a browser, and a second copy is
      // ~150 MB. The puppeteer config written below points mmdc at this one.
      const ok = run([npm, 'install', '-g', '@mermaid-js/mermaid-cli'], { PUPPETEER_SKIP_DOWNLOAD: '1' })
      if (ok) writePuppeteerConfig()
      return ok
    },
    manual: 'PUPPETEER_SKIP_DOWNLOAD=1 npm install -g @mermaid-js/mermaid-cli',
    manualWindows: '$env:PUPPETEER_SKIP_DOWNLOAD="1"; npm install -g @mermaid-js/mermaid-cli',
  },
  {
    id: 'd2',
    label: 'D2 — text-to-diagram renderer',
    required: false,
    names: ['d2'],
    install: async () => {
      const meta = await fetchJson('https://api.github.com/repos/terrastruct/d2/releases/latest')
      const tag = typeof meta?.tag_name === 'string' ? meta.tag_name : ''
      if (tag === '') return false
      // The release asset is platform- AND architecture-specific. Naming the Linux
      // asset unconditionally is how a macOS machine ends up with an ELF binary it
      // cannot run; the matrix below is the smallest true statement of what the
      // project publishes.
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
      const platform = process.platform === 'darwin' ? 'darwin' : 'linux'
      const archive = join(tmpdir(), `d2-${process.pid}.tar.gz`)
      await download(`https://github.com/terrastruct/d2/releases/download/${tag}/d2-${tag}-${platform}-${arch}.tar.gz`, archive)
      const extract = join(tmpdir(), `d2-${process.pid}`)
      mkdirSync(extract, { recursive: true })
      if (!run(['tar', '-xzf', archive, '-C', extract])) return false
      const binary = join(extract, `d2-${tag}`, 'bin', 'd2')
      if (!existsSync(binary)) return false
      mkdirSync(LOCAL_BIN, { recursive: true })
      run(['install', '-m', '0755', binary, join(LOCAL_BIN, 'd2')])
      return execFileSync(join(LOCAL_BIN, 'd2'), ['--version'], { encoding: 'utf8' }).includes('d2')
    },
    manual: 'download d2-linux-amd64 from https://github.com/terrastruct/d2/releases and put `d2` on PATH',
    manualWindows: 'download d2-windows-amd64.zip from https://github.com/terrastruct/d2/releases and put d2.exe on PATH',
  },
  {
    id: 'chrome',
    label: 'Chrome/Chromium — PDF rendering (decks, handoffs)',
    required: false,
    detectOnly: true,
    names: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'chrome.exe', 'msedge.exe'],
    // Per-platform install locations. A browser is installed OUTSIDE PATH on the
    // two desktop platforms - Windows puts chrome.exe under Program Files and
    // macOS under /Applications - so a name-only probe reports "missing" on a
    // machine whose Chrome is right there. Measured before this change: Chrome
    // present at C:\Program Files\Google\Chrome\Application\chrome.exe, probe
    // answering MISSING.
    known: {
      win32: [
        join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ],
      darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ],
      linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
    },
    manual: 'install Chrome or Chromium with your OS package manager, or set CHROME_PATH',
    manualWindows: 'install Chrome or Edge (winget install Google.Chrome, or winget install Microsoft.Edge), or set CHROME_PATH',
  },
  {
    id: 'ffmpeg',
    label: 'ffmpeg — video output (Manim animations)',
    required: false,
    detectOnly: true,
    names: ['ffmpeg'],
    manual: 'install ffmpeg with your OS package manager',
    manualWindows: 'install ffmpeg with winget (Gyan.FFmpeg) or choco, then put ffmpeg.exe on PATH',
  },
]

/** Write the puppeteer config mmdc should use when it has no bundled browser. */
function writePuppeteerConfig() {
  const chrome = which(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'])
  if (chrome === null) return
  const target = join(DSH_HOME, 'mermaid-puppeteer.json')
  try {
    mkdirSync(DSH_HOME, { recursive: true })
    writeFileSync(target, `${JSON.stringify({ executablePath: chrome, args: ['--no-sandbox'] }, null, 2)}\n`)
  } catch {
    // A missing config is reported by the mmdc hint, not a failed install.
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const selected = TOOLS.filter((tool) => (options.only === null || options.only.has(tool.id))
    && (options.skip === null || !options.skip.has(tool.id)))
  if (selected.length === 0) throw new Error('no tool selected')

  const report = { mode: options.mode, platform: process.platform, tools: [] }
  let missing = 0
  for (const tool of selected) {
    const bin = resolveToolBin(tool)
    const version = bin === null ? null : probeVersion(bin)
    const entry = {
      id: tool.id,
      label: tool.label,
      status: bin === null ? 'missing' : 'present',
      bin: bin ?? null,
      version,
      action: bin === null ? 'install' : 'none',
    }
    if (bin === null && options.mode === 'apply') {
      if (tool.detectOnly === true) {
        entry.action = 'manual'
      } else if (process.platform === 'win32') {
        entry.action = 'manual'
        entry.note = 'the POSIX installer is not used on Windows; install it with winget or choco'
      } else {
        const ok = await tool.install({ options }).catch(() => false)
        const after = resolveToolBin(tool)
        entry.status = after === null ? 'missing' : 'installed'
        entry.bin = after ?? null
        entry.version = after === null ? null : probeVersion(after)
        entry.action = after === null ? 'manual' : 'none'
      }
    }
    if (entry.status === 'missing') {
      missing += 1
      // The next command must be one this shell can run: a POSIX env-var prefix
      // and a Linux asset name are actively wrong advice on Windows.
      entry.manual = process.platform === 'win32' && tool.manualWindows ? tool.manualWindows : tool.manual
    }
    report.tools.push(entry)
    if (!options.json) {
      const version = entry.version === null ? '' : `  ${entry.version}`
      process.stdout.write(`${entry.status === 'missing' ? 'MISSING' : entry.status === 'installed' ? 'INSTALLED' : 'ok     '}  ${tool.id}${version}\n`)
      if (entry.status === 'missing') process.stdout.write(`         manual: ${entry.manual}\n`)
    }
  }
  report.missing = missing
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else process.stdout.write(`\n${selected.length - missing}/${selected.length} tools available${missing > 0 ? ` — ${missing} missing (run with --apply to install)` : ''}\n`)
  process.exit(missing === 0 ? 0 : 1)
}

const direct = process.argv[1] === undefined ? true : resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (direct) {
  main().catch((error) => {
    process.stderr.write(`provision-tools: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  })
}
