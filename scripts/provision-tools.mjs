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
 *   - `--apply` installs on every platform: npm-based tools through the global npm
 *     (a `.cmd` shim on Windows, which is why the runner routes through the command
 *     interpreter), rtk and d2 from their release archives onto a directory that is
 *     already on PATH, and headroom through `uv tool install` with uv installed on
 *     demand. A tool whose release asset does not exist for this platform stays
 *     missing and reports the manual command.
 *   - Chrome and ffmpeg are DETECTED ONLY: they are OS packages, and installing them
 *     under a user account is how a machine ends up with two browsers.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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

/**
 * Run a command with inherited stdio so a human sees what is happening.
 *
 * PURPOSE
 *   Run one installer and report whether it exited zero, on every platform.
 * INPUTS
 *   argv - executable followed by its arguments (string[]).
 *   env  - extra environment entries merged over process.env (object, optional).
 * OUTPUTS
 *   true when the command exited 0. false on any non-zero exit, a spawn failure,
 *   or the 15-minute timeout; never throws.
 * KEYWORDS
 *   spawn, install, cross-platform, exit code
 *
 * A `.cmd`/`.bat` shim is NOT spawned here: Node refuses that with EINVAL since
 * CVE-2024-27980, and routing it through `cmd.exe` from spawnSync mis-escapes the
 * quoted path. Callers that need npm resolve its CLI script instead - see
 * installWithNpm - which needs neither.
 */
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

/**
 * Directory a downloaded single binary is installed into.
 *
 * PURPOSE
 *   Put a release binary somewhere the NEXT shell finds it. A tool copied to a
 *   directory that is not on PATH is installed and unreachable at the same time,
 *   which reads exactly like a failed install.
 * INPUTS
 *   none.
 * OUTPUTS
 *   Absolute directory path (string). Windows: the directory npm already puts
 *   global shims in, because it is on PATH and user-writable - measured on this
 *   machine: C:\Users\<user>\AppData\Roaming\npm. POSIX: ~/.local/bin, which the
 *   kit's own rtk installer targets too.
 * KEYWORDS
 *   PATH, bin directory, npm prefix, ~/.local/bin, portable install
 */
function binDir() {
  if (process.platform === 'win32') {
    const npmPrefix = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null
    if (npmPrefix !== null && existsSync(npmPrefix)) return npmPrefix
  }
  mkdirSync(LOCAL_BIN, { recursive: true })
  return LOCAL_BIN
}

/** Extract a .tar.gz with the system tar, which ships on every target OS. */
function extractTarGz(archive, into) {
  mkdirSync(into, { recursive: true })
  return run(['tar', '-xzf', archive, '-C', into])
}

/**
 * Extract a .zip. Windows has no unzip binary, so PowerShell's Expand-Archive is
 * the one extractor guaranteed to be present there.
 */
function extractZip(archive, into) {
  mkdirSync(into, { recursive: true })
  if (process.platform === 'win32') {
    return run([
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath "${archive}" -DestinationPath "${into}" -Force`,
    ])
  }
  return run(['unzip', '-q', '-o', archive, '-d', into])
}

/**
 * Find one file by name under a freshly extracted directory.
 *
 * PURPOSE
 *   Release archives wrap their binary in a versioned directory whose name changes
 *   every release (`d2-v0.9.0/bin/d2`), so the installer must discover the file
 *   instead of assuming a path.
 * INPUTS
 *   root - directory to search (string).
 *   name - basename to match, case-insensitively, e.g. 'd2.exe' (string).
 * OUTPUTS
 *   Absolute path of the first match in depth-first order, or null when the
 *   archive does not contain it (a failed or renamed release).
 * KEYWORDS
 *   archive layout, find binary, release asset, recursive search
 */
function findInTree(root, name) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const candidate = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = findInTree(candidate, name)
      if (nested !== null) return nested
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return candidate
    }
  }
  return null
}

/**
 * Download a release archive, extract it, and install the binary it carries onto PATH.
 *
 * PURPOSE
 *   Install a tool the release publishes as a binary rather than through a package
 *   manager, without a shell pipeline, an elevation prompt, or an `install.sh`.
 * INPUTS
 *   options.url    - archive URL (string).
 *   options.binary - basename inside the archive, e.g. 'rtk.exe' (string).
 *   options.target - name to install it as, e.g. 'rtk.exe' (string).
 *   options.kind   - 'tar.gz' (default) or 'zip' (string).
 * OUTPUTS
 *   The installed absolute path (string), or null when the download, the
 *   extraction, or the copy failed; the caller reports the manual command.
 * KEYWORDS
 *   release asset, tar.gz, zip, copy, PATH, user-local install
 */
async function installArchiveBinary({ url, binary, target, kind = 'tar.gz' }) {
  const stem = `${target.replaceAll(/\W/gu, '-')}-${process.pid}`
  const archive = join(tmpdir(), kind === 'zip' ? `${stem}.zip` : `${stem}.tar.gz`)
  const into = join(tmpdir(), stem)
  try {
    await download(url, archive)
  } catch {
    return null
  }
  const extracted = kind === 'zip' ? extractZip(archive, into) : extractTarGz(archive, into)
  if (!extracted) return null
  const found = findInTree(into, binary)
  if (found === null) return null
  const destination = join(binDir(), target)
  try {
    copyFileSync(found, destination)
  } catch {
    return null
  }
  return destination
}

/**
 * Run a global npm install for a package that has no prebuilt release archive.
 *
 * PURPOSE
 *   One call site for "install this npm package globally", so the Windows shim
 *   problem and the PATH check live in exactly one place.
 * INPUTS
 *   pkg  - package spec, e.g. '@marp-team/marp-cli' (string).
 *   env  - extra environment entries for the install (object, optional).
 * OUTPUTS
 *   npm's own exit status as a boolean (false when npm is absent or the install
 *   failed). The caller re-probes the tool, because a package name and its binary
 *   name differ: `@marp-team/marp-cli` installs `marp`, `@mermaid-js/mermaid-cli`
 *   installs `mmdc`.
 * KEYWORDS
 *   npm, global install, npm-cli.js, windows shim, PATH, provision
 *
 * On Windows `npm` resolves to `npm.cmd`, which spawnSync cannot execute (EINVAL
 * since CVE-2024-27980) and which `cmd.exe` mangles once the path is quoted -
 * measured: `'\"C:\Program Files\nodejs\npm.cmd\"' is not recognized`. Running
 * npm's own CLI script with this node binary needs neither a shell nor a quote.
 */
function installWithNpm(pkg, env = {}) {
  const npm = which('npm')
  if (npm === null) return false
  const args = ['install', '-g', '--no-audit', '--no-fund', pkg]
  if (process.platform === 'win32' && /\.cmd$/iu.test(npm)) {
    const cli = join(dirname(npm), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    return existsSync(cli) ? run([process.execPath, cli, ...args], env) : false
  }
  return run([npm, ...args], env)
}

/**
 * Resolve the release asset name for a platform and architecture.
 *
 * PURPOSE
 *   Turn `process.platform`/`process.arch` into the tokens a release actually
 *   publishes. Guessing these is how a macOS machine ends up downloading a Linux
 *   binary: d2 publishes `macos`, not `darwin`, and Windows archives are `.tar.gz`
 *   in the same series as the Unix ones.
 * INPUTS
 *   os   - 'windows' | 'macos' | 'linux' for this run (string).
 *   arch - 'amd64' | 'arm64' (string).
 * OUTPUTS
 *   File name of the archive (string), e.g. 'd2-v0.9.0-macos-arm64.tar.gz'.
 * KEYWORDS
 *   release asset naming, macos, windows, amd64, arm64
 */
function d2AssetName(tag, os, arch) {
  return `d2-${tag}-${os}-${arch}.tar.gz`
}

/** Release-asset tokens for this run: d2 says `macos`, not `darwin`. */
function d2PlatformTokens() {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  return { os, arch }
}

/**
 * Make a directory visible to this process and to future ones.
 *
 * PURPOSE
 *   A tool whose bin directory is not on PATH is installed and unreachable at the
 *   same time. `uv` and its tool shims land in `~/.local/bin`, which on Windows is
 *   not on PATH by default, so wiring the binary also means wiring the PATH.
 * INPUTS
 *   dir - absolute directory that must be searchable (string).
 * OUTPUTS
 *   true when the directory is now on this process's PATH (always, for the caller's
 *   lifetime), and on the persisted user PATH on Windows. false only when the
 *   persisted write failed.
 * KEYWORDS
 *   PATH, setx, user environment, uv, shim, persistence
 */
function ensureOnPath(dir) {
  if (!existsSync(dir)) return false
  const current = String(process.env.PATH ?? '')
  if (!current.split(delimiter).includes(dir)) process.env.PATH = `${dir}${delimiter}${current}`
  if (process.platform !== 'win32') return true
  const escaped = dir.replaceAll("'", "''")
  const added = run([
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not (($p -split ';') -contains '${escaped}')) { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';${escaped}'), 'User') }`,
  ])
  return added
}

/**
 * Return a usable `uv`, installing the official one when it is absent.
 *
 * PURPOSE
 *   Headroom is published only as a Python tool, so `uv tool install` is its one
 *   supported unattended path. Without this, "install headroom" always degraded to
 *   a manual instruction.
 * INPUTS
 *   none.
 * OUTPUTS
 *   Absolute path of `uv` (string), or null when its installer failed or the
 *   binary cannot be found afterwards.
 * KEYWORDS
 *   uv, python toolchain, astral, headroom, unattended install
 */
function ensureUv() {
  const existing = which('uv')
  if (existing !== null) return existing
  const installed = process.platform === 'win32'
    ? run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex'])
    : run(['sh', '-c', 'curl -fsSL https://astral.sh/uv/install.sh | sh'])
  if (!installed) return null
  const candidateDirs = [join(homedir(), '.local', 'bin'), join(homedir(), '.cargo', 'bin')]
  for (const dir of candidateDirs) ensureOnPath(dir)
  return which('uv')
}

/** Chrome/Chromium/Edge install locations, per platform. Shared by detection and by
 * the mermaid puppeteer config, so the two cannot disagree about what is installed. */
const CHROME_KNOWN = {
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
}

/** The tool set, in a stable order, with the probe and the installer for each. */
const TOOLS = [
  {
    id: 'rtk',
    label: 'RTK — command-aware output compression',
    required: false,
    names: ['rtk'],
    install: async () => {
      const edition = process.env.RTK_EDITION === '' ? 'oss' : (process.env.RTK_EDITION ?? 'oss')
      if (process.platform === 'win32') {
        // The release publishes a Windows zip per edition (rtk-oss-x86_64-pc-windows-msvc.zip
        // for v1.1.0), so Windows installs the same Apache-2.0 edition the POSIX
        // installer would, without a shell.
        const meta = await fetchJson('https://api.github.com/repos/rtk-ai/rtk/releases/latest')
        const tag = typeof meta?.tag_name === 'string' ? meta.tag_name : ''
        if (tag === '') return false
        const prefix = edition === 'oss' ? 'rtk-oss' : 'rtk'
        const url = `https://github.com/rtk-ai/rtk/releases/download/${tag}/${prefix}-x86_64-pc-windows-msvc.zip`
        return (await installArchiveBinary({ url, binary: 'rtk.exe', target: 'rtk.exe', kind: 'zip' })) !== null
      }
      const script = join(tmpdir(), `rtk-install-${process.pid}.sh`)
      await download('https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh', script)
      return run(['sh', script], { RTK_EDITION: edition, RTK_INSTALL_DIR: LOCAL_BIN })
    },
    manual: 'RTK_EDITION=oss sh <(curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh)',
    manualWindows: 'download rtk-oss-x86_64-pc-windows-msvc.zip from https://github.com/rtk-ai/rtk/releases and put rtk.exe on PATH',
  },
  {
    id: 'headroom',
    label: 'Headroom — model-traffic compression proxy',
    required: false,
    names: ['headroom'],
    install: async () => {
      const uv = ensureUv()
      if (uv === null) return false
      const installed = run([uv, 'tool', 'install', '--python', '3.13', 'headroom-ai[proxy]'])
      // uv puts the shim in ~/.local/bin, which Windows does not search by default.
      ensureOnPath(join(homedir(), '.local', 'bin'))
      return installed && which('headroom') !== null
    },
    manual: 'uv tool install --python 3.13 "headroom-ai[proxy]"',
    manualWindows: 'irm https://astral.sh/uv/install.ps1 | iex; then: uv tool install --python 3.13 "headroom-ai[proxy]"',
  },
  {
    id: 'babysitter',
    label: 'Babysitter — deterministic process runs',
    required: false,
    names: ['babysitter'],
    install: async () => installWithNpm('@a5c-ai/babysitter'),
    manual: 'npm install -g @a5c-ai/babysitter',
  },
  {
    id: 'marp',
    label: 'Marp CLI — deck export to PDF/PPTX',
    required: false,
    names: ['marp'],
    install: async () => installWithNpm('@marp-team/marp-cli'),
    manual: 'npm install -g @marp-team/marp-cli',
  },
  {
    id: 'mermaid',
    label: 'Mermaid CLI — render .mmd source',
    required: false,
    names: ['mmdc'],
    install: async () => {
      // The package installs without its bundled browser; the pinned chrome-headless-shell
      // is then installed deliberately, so a render never touches the user's desktop browser.
      const ok = installWithNpm('@mermaid-js/mermaid-cli', { PUPPETEER_SKIP_DOWNLOAD: '1' })
      if (!ok) return false
      const shell = ensurePuppeteerShell()
      writePuppeteerConfig()
      return shell
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
      const meta = await fetchJson('https://api.github.com/repos/d2lang/d2/releases/latest')
      const tag = typeof meta?.tag_name === 'string' ? meta.tag_name : ''
      if (tag === '') return false
      // The release asset is platform- AND architecture-specific, and the tokens are
      // the project's own: `macos` (not `darwin`), `windows`, `amd64`/`arm64`, all
      // shipped as .tar.gz. Measured against v0.9.0 before this line was written.
      const { os, arch } = d2PlatformTokens()
      const url = `https://github.com/d2lang/d2/releases/download/${tag}/${d2AssetName(tag, os, arch)}`
      const binary = process.platform === 'win32' ? 'd2.exe' : 'd2'
      return (await installArchiveBinary({ url, binary, target: binary })) !== null
    },
    manual: 'download d2-linux-amd64.tar.gz from https://github.com/d2lang/d2/releases and put `d2` on PATH',
    manualWindows: 'download d2-windows-amd64.tar.gz from https://github.com/d2lang/d2/releases and put d2.exe on PATH',
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
    known: CHROME_KNOWN,
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

/**
 * Where globally installed npm packages live, so a package's own tooling can be run.
 *
 * PURPOSE
 *   mermaid-cli's puppeteer must install the browser revision IT was pinned to, and only
 *   the copy inside that package knows which revision that is.
 * INPUTS
 *   none.
 * OUTPUTS
 *   Absolute `node_modules` directory (string), or null when it cannot be determined.
 * KEYWORDS
 *   npm root -g, global modules, puppeteer, mermaid-cli
 */
function globalModulesRoot() {
  if (process.platform === 'win32') {
    const root = join(binDir(), 'node_modules')
    return existsSync(root) ? root : null
  }
  const npm = which('npm')
  if (npm === null) return null
  try {
    const out = execFileSync(npm, ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const value = String(out).trim()
    return value === '' ? null : value
  } catch {
    return null
  }
}

/**
 * Install the browser revision mermaid-cli's puppeteer pins.
 *
 * PURPOSE
 *   `mmdc` defaults to `headless: "shell"`, which needs its own `chrome-headless-shell`
 *   binary. Without that exact revision every render fails with "Could not find
 *   chrome-headless-shell (ver. …)". The tempting workaround - pointing puppeteer at the
 *   installed desktop Chrome with PUPPETEER_EXECUTABLE_PATH - makes a user's browser the
 *   machine-wide target of every puppeteer consumer and can put real windows on screen,
 *   which is exactly what a tool call must never do. Installing the pinned shell keeps
 *   rendering headless and leaves the user's browser alone.
 * INPUTS
 *   none.
 * OUTPUTS
 *   true when the pinned shell is installed or already present, false when the mermaid-cli
 *   puppeteer CLI is missing or the download failed.
 * KEYWORDS
 *   puppeteer, chrome-headless-shell, mermaid-cli, headless, revision pin
 */
function ensurePuppeteerShell() {
  const root = globalModulesRoot()
  if (root === null) return false
  const cli = join(root, '@mermaid-js', 'mermaid-cli', 'node_modules', 'puppeteer', 'lib', 'puppeteer', 'node', 'cli.js')
  if (!existsSync(cli)) return false
  return run([process.execPath, cli, 'browsers', 'install', 'chrome-headless-shell'])
}

/**
 * Write the puppeteer config mmdc should use, with headlessness stated rather than assumed.
 *
 * PURPOSE
 *   `@mermaid-js/mermaid-cli` is installed with PUPPETEER_SKIP_DOWNLOAD=1, so its browser is
 *   provisioned deliberately rather than by a postinstall; this config then pins `headless`
 *   and the flags that keep a render off the desktop - no extensions, no sync, no first-run
 *   window.
 * INPUTS
 *   none.
 * OUTPUTS
 *   true when the config was written; false when the file could not be written.
 * KEYWORDS
 *   mermaid, mmdc, puppeteer, headless shell, JSON, BOM
 *
 * Two measured details. The file is UTF-8 with NO byte-order mark: PowerShell's
 * `Set-Content -Encoding utf8` adds one and mermaid-cli's `JSON.parse` then rejects the file
 * with "Unexpected token", so `mmdc -p <config>` failed while the same flags inline worked.
 * And `headless` is spelled "shell" to match the pinned chrome-headless-shell - never the
 * desktop Chrome, which would render in a real window.
 */
function writePuppeteerConfig() {
  const target = join(DSH_HOME, 'mermaid-puppeteer.json')
  const config = {
    headless: 'shell',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--hide-scrollbars',
    ],
  }
  try {
    mkdirSync(DSH_HOME, { recursive: true })
    writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    return true
  } catch {
    // A missing config is reported by the mmdc hint, not a failed install.
    return false
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
      } else {
        const ok = await tool.install({ options }).catch(() => false)
        const after = resolveToolBin(tool)
        entry.status = after === null ? 'missing' : 'installed'
        entry.bin = after ?? null
        entry.version = after === null ? null : probeVersion(after)
        entry.action = after === null ? 'manual' : 'none'
        if (after === null) entry.note = `the installer ran without producing ${tool.names[0]}; see its output above`
        else if (!ok) entry.note = 'installed, but the installer reported a non-zero exit'
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
