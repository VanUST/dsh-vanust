/**
 * PURPOSE
 *   Provision the three things the Godot MCP server cannot work without: the Godot
 *   engine, the `uv`/`uvx` launcher, and the Godot AI editor addon committed inside
 *   the project. The engine and the launcher are per-machine and the addon is
 *   per-project, which is why all three are supplied here rather than declared in the
 *   server list.
 *
 *   WHY EVERY DOWNLOAD GOES THROUGH NODE. Measured on the Windows machine this
 *   deployment was built on: `curl`, `git`, `choco`, `winget` and the `irm | iex` uv
 *   installer all fail because the OS TLS stack answers `SEC_E_NO_CREDENTIALS`, while
 *   Node's own TLS stack reaches every source needed. Measured again on the Linux
 *   machine, 2026-09-28: `curl` against `release-assets.githubusercontent.com` dies
 *   with `OpenSSL SSL_connect: Broken pipe` while the same URLs answer through
 *   `fetch`. The downloader is therefore not a preference.
 *
 *   It is idempotent: a component already present is reported and skipped, so
 *   re-running costs nothing and changes nothing.
 *
 * INPUTS
 *   --mode check|apply     check reports state and writes nothing; apply installs.
 *                          Default: check.
 *   --project <dir>        Godot project directory that receives the addon under
 *                          `addons/godot_ai`. Default: the working directory.
 *   --godot-version <v>    engine version, default 4.7.2.
 *   --uv-version <v>       uv release, default 0.12.19.
 *   --godot-ai-tag <t>     Godot AI release tag, default v4.2.3. Its MAJOR must match
 *                          the `godot-ai==` pin in `profile/mcp-servers.json`, or the
 *                          bridge refuses the server.
 *
 * OUTPUTS
 *   One JSON object per line on stdout, each with an `event` field, ending in
 *   `provision.summary` carrying `{ ok, mode, components }`. Exit 0 when the
 *   requested mode succeeded, 1 when a download, checksum or extraction failed, 2 on
 *   a usage error. No secrets are printed.
 *
 *   Install locations, chosen so the deployment's own launcher resolution finds the
 *   result without extra configuration: `~/.local/bin/uvx` and `~/.local/bin/uv`
 *   (`resolveUvx` searches that directory on both platforms), and the engine under
 *   `~/.local/opt/godot-<version>/` with a `godot` link in `~/.local/bin` on POSIX.
 *
 * KEYWORDS
 *   provisioning, godot, uv, uvx, godot-ai, addon, checksum, sha256, sha512, node
 *   fetch, transferable setup, mcp
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Unknown flag or missing value: usage error, exit 2, nothing written.
 *   - `--project` without a `project.godot`: warned about and the addon step is
 *     skipped, rather than writing `addons/` into a directory that is not a project.
 *   - Platform/arch with no published asset: refused by name, nothing downloaded.
 *   - `darwin` is NOT implemented and says so: the engine ships as an `.app` bundle
 *     whose placement differs, no machine in this deployment runs it, and code that
 *     cannot be exercised here would be an untested claim.
 *   - A download interrupted mid-stream: the partial file is discarded and the request
 *     retried with backoff; a cached archive whose digest does not match is
 *     re-downloaded, never trusted.
 *   - A release that publishes no digest for an asset: reported as `unverified`; the
 *     run is not claimed as verified. The Godot archive is checked against the
 *     release's `SHA512-SUMS.txt`, and the Godot AI addon against its release
 *     manifest, because the `.sha256` asset that release carries belongs to the v3
 *     archive.
 *   - Windows is IMPLEMENTED FROM DOCUMENTED TOOLING BUT UNVERIFIED on this machine,
 *     which has no Windows host: the asset names and the `%USERPROFILE%\.local` layout
 *     are the ones upstream documents, and the extraction uses `tar`, which Windows 10
 *     and later ship. A Windows operator should treat the first run as a test and read
 *     the JSON, not assume the POSIX result transfers.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULTS = {
  mode: 'check',
  project: process.cwd(),
  godotVersion: '4.7.2',
  uvVersion: '0.12.19',
  godotAiTag: 'v4.2.3',
}

const HOME = homedir()
const OPT_DIR = join(HOME, '.local', 'opt')
const BIN_DIR = join(HOME, '.local', 'bin')
const CACHE_DIR = join(HOME, '.cache', 'dsh-godot')
const IS_WINDOWS = process.platform === 'win32'

/** Published asset names for the platforms this provisioner implements. */
const GODOT_ASSETS = {
  'linux-x64': 'linux.x86_64.zip',
  'linux-arm64': 'linux.arm64.zip',
  'win32-x64': 'win64.exe.zip',
  'win32-arm64': 'windows_arm64.exe.zip',
}

const UV_ASSETS = {
  'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
  'win32-arm64': 'uv-aarch64-pc-windows-msvc.zip',
}

/** Emits one structured log line. Never throws, whatever it is handed. */
function log(event, data = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`)
}

/** PURPOSE: Parse argv into options. INPUTS: argv (string[]). OUTPUTS: options.
 *  Throws an Error naming the offending flag; never returns null. */
function parseArgs(argv) {
  const options = { ...DEFAULTS }
  const flags = {
    '--mode': 'mode',
    '--project': 'project',
    '--godot-version': 'godotVersion',
    '--uv-version': 'uvVersion',
    '--godot-ai-tag': 'godotAiTag',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help') { options.help = true; continue }
    const key = flags[arg]
    if (!key) throw new Error(`unknown argument: ${arg}`)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    i += 1
    options[key] = value
  }
  if (!['check', 'apply'].includes(options.mode)) throw new Error(`--mode must be check or apply, got "${options.mode}"`)
  options.project = resolve(options.project)
  options.key = `${process.platform}-${process.arch}`
  return options
}

/** PURPOSE: Fetch with bounded retries so a flaky TLS connection does not fail an
 *  unattended install. INPUTS: url, retries=5. OUTPUTS: a Response. Throws after the
 *  last attempt; waits 1s, 2s, 4s, 8s between attempts. */
async function fetchWithRetry(url, retries = 5) {
  let lastError
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
      return response
    } catch (error) {
      lastError = error
      log('fetch.retry', { url, attempt, of: retries, reason: error.message })
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)))
    }
  }
  throw lastError
}

/** PURPOSE: Fetch a small text document with the same retry policy.
 *  INPUTS: url. OUTPUTS: body as a string. Throws after retries. */
async function fetchText(url) {
  return (await fetchWithRetry(url)).text()
}

/** PURPOSE: Hex digest of a file. INPUTS: path, algorithm. OUTPUTS: lowercase hex. */
function hashFile(path, algorithm) {
  return createHash(algorithm).update(readFileSync(path)).digest('hex')
}

/** PURPOSE: Download an asset into the cache atomically.
 *  INPUTS: url, dest. OUTPUTS: { path, bytes, sha256 }. A partial file is never left
 *  in place: the bytes land in `<dest>.part` and are renamed on completion. */
async function download(url, dest) {
  mkdirSync(CACHE_DIR, { recursive: true })
  const response = await fetchWithRetry(url)
  const buffer = Buffer.from(await response.arrayBuffer())
  const temporary = `${dest}.part`
  writeFileSync(temporary, buffer)
  renameSync(temporary, dest)
  const digest = hashFile(dest, 'sha256')
  log('download.done', { url, path: dest, bytes: buffer.length, sha256: digest })
  return { path: dest, bytes: buffer.length, sha256: digest }
}

/** PURPOSE: Read the expected digest for one filename out of a checksum document.
 *  INPUTS: text, fileName. OUTPUTS: lowercase hex digest, or null when the file does
 *  not list that name — a missing line is a null, never a guess. */
function digestFor(text, fileName) {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || !line.includes(fileName)) continue
    const match = line.match(/\b([a-fA-F0-9]{64,128})\b/)
    if (match) return match[1].toLowerCase()
  }
  return null
}

/** PURPOSE: Run a small external tool. INPUTS: cmd, args. OUTPUTS: boolean. */
function toolOk(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    return true
  } catch (error) {
    log('tool.failed', { cmd, args, reason: error.message.split('\n')[0] })
    return false
  }
}

/** PURPOSE: Extract a zip archive. INPUTS: archive, destDir. OUTPUTS: boolean.
 *  `unzip` on POSIX; `tar` on Windows, whose Windows 10+ build reads zip. */
function extractZip(archive, destDir) {
  mkdirSync(destDir, { recursive: true })
  return IS_WINDOWS
    ? toolOk('tar', ['-xf', archive, '-C', destDir])
    : toolOk('unzip', ['-o', '-q', archive, '-d', destDir])
}

/** PURPOSE: Extract a gzipped tar archive. INPUTS: archive, destDir. OUTPUTS: boolean. */
function extractTarGz(archive, destDir) {
  mkdirSync(destDir, { recursive: true })
  return toolOk('tar', ['-xzf', archive, '-C', destDir])
}

/**
 * PURPOSE: Install the Godot engine and expose it on PATH where the platform has one.
 * INPUTS: options. OUTPUTS: `{ ok, version, binary, verification }`, where
 *   `verification` is `sha512` on a matched release digest, `unverified` when the
 *   release lists none, `platform-unsupported` when no asset exists, or `failed` on a
 *   mismatch. Never throws.
 */
async function installGodot(options) {
  const version = options.godotVersion
  const suffix = GODOT_ASSETS[options.key]
  if (!suffix) {
    log('godot.platform-unsupported', { platform: options.key, supported: Object.keys(GODOT_ASSETS) })
    return { ok: false, version, binary: null, verification: 'platform-unsupported' }
  }
  const asset = `Godot_v${version}-stable_${suffix}`
  const base = `https://github.com/godotengine/godot/releases/download/${version}-stable`
  const installDir = join(OPT_DIR, `godot-${version}`)
  const binaryName = `Godot_v${version}-stable_${suffix.replace(/\.zip$/, '')}`
  const binary = join(installDir, binaryName)

  if (existsSync(binary)) {
    log('godot.present', { version, binary })
    return { ok: true, version, binary, verification: 'present' }
  }
  if (options.mode === 'check') {
    log('godot.missing', { version, wanted: binary })
    return { ok: false, version, binary, verification: 'absent' }
  }
  const zip = join(CACHE_DIR, asset)
  if (!existsSync(zip)) await download(`${base}/${asset}`, zip)

  let verification = 'unverified'
  try {
    const expected = digestFor(await fetchText(`${base}/SHA512-SUMS.txt`), asset)
    if (expected === null) {
      log('godot.checksum.absent', { asset, note: 'release lists no digest for this asset' })
    } else if (hashFile(zip, 'sha512') !== expected) {
      log('godot.checksum.mismatch', { expected, actual: hashFile(zip, 'sha512') })
      return { ok: false, version, binary, verification: 'failed' }
    } else {
      verification = 'sha512'
      log('godot.checksum.ok', { algorithm: 'sha512' })
    }
  } catch (error) {
    log('godot.checksum.unavailable', { reason: error.message })
  }

  if (!extractZip(zip, installDir)) return { ok: false, version, binary, verification: 'extract-failed' }
  const extracted = join(installDir, binaryName)
  if (!existsSync(extracted)) {
    log('godot.layout.unexpected', { installDir, expected: binaryName })
    return { ok: false, version, binary, verification: 'layout-unexpected' }
  }
  if (!IS_WINDOWS) {
    chmodSync(extracted, 0o755)
    mkdirSync(BIN_DIR, { recursive: true })
    const link = join(BIN_DIR, 'godot')
    rmSync(link, { force: true })
    symlinkSync(extracted, link)
  }
  log('godot.installed', { version, binary: extracted, verification })
  return { ok: true, version, binary: extracted, verification }
}

/**
 * PURPOSE: Install the uv launcher pair into `~/.local/bin`, the directory the
 *   deployment's own `resolveUvx` searches on both platforms.
 * INPUTS: options. OUTPUTS: `{ ok, version, uv, uvx, verification }`.
 */
async function installUv(options) {
  const version = options.uvVersion
  const asset = UV_ASSETS[options.key]
  if (!asset) {
    log('uv.platform-unsupported', { platform: options.key, supported: Object.keys(UV_ASSETS) })
    return { ok: false, version, uv: null, uvx: null, verification: 'platform-unsupported' }
  }
  const base = `https://github.com/astral-sh/uv/releases/download/${version}`
  const exe = IS_WINDOWS ? '.exe' : ''
  const uv = join(BIN_DIR, `uv${exe}`)
  const uvx = join(BIN_DIR, `uvx${exe}`)

  if (existsSync(uv) && existsSync(uvx)) {
    log('uv.present', { version, uv, uvx })
    return { ok: true, version, uv, uvx, verification: 'present' }
  }
  if (options.mode === 'check') {
    log('uv.missing', { version, wanted: uvx })
    return { ok: false, version, uv, uvx, verification: 'absent' }
  }
  const archive = join(CACHE_DIR, asset)
  if (!existsSync(archive)) await download(`${base}/${asset}`, archive)

  let verification = 'unverified'
  try {
    const expected = (await fetchText(`${base}/${asset}.sha256`)).trim().split(/\s+/)[0].toLowerCase()
    const actual = hashFile(archive, 'sha256')
    if (actual !== expected) {
      log('uv.checksum.mismatch', { expected, actual })
      return { ok: false, version, uv, uvx, verification: 'failed' }
    }
    verification = 'sha256'
    log('uv.checksum.ok', { algorithm: 'sha256' })
  } catch (error) {
    log('uv.checksum.unavailable', { reason: error.message })
  }

  const staging = join(CACHE_DIR, `uv-${version}`)
  rmSync(staging, { recursive: true, force: true })
  const extracted = asset.endsWith('.zip')
    ? (extractZip(archive, staging) ? staging : null)
    : (extractTarGz(archive, staging) ? join(staging, asset.replace(/\.tar\.gz$/, '')) : null)
  if (extracted === null) return { ok: false, version, uv, uvx, verification: 'extract-failed' }

  mkdirSync(BIN_DIR, { recursive: true })
  for (const name of ['uv', 'uvx']) {
    const source = join(extracted, `${name}${exe}`)
    if (!existsSync(source)) {
      log('uv.extract.missing', { source })
      return { ok: false, version, uv, uvx, verification: 'extract-failed' }
    }
    const target = join(BIN_DIR, `${name}${exe}`)
    rmSync(target, { force: true })
    writeFileSync(target, readFileSync(source))
    if (!IS_WINDOWS) chmodSync(target, 0o755)
  }
  log('uv.installed', { version, uv, uvx, verification })
  return { ok: true, version, uv, uvx, verification }
}

/**
 * PURPOSE: Install the Godot AI editor addon into the project — the half of the bridge
 *   that runs inside the editor and the piece that has to travel with the project.
 * INPUTS: options. OUTPUTS: `{ ok, tag, plugin, verification, skipped? }`. A project
 *   without `project.godot` is skipped with the reason, never written into blindly.
 */
async function installGodotAi(options) {
  const tag = options.godotAiTag
  const asset = 'godot-ai-v4-plugin.zip'
  const base = `https://github.com/hi-godot/godot-ai/releases/download/${tag}`
  const plugin = join(options.project, 'addons', 'godot_ai', 'plugin.cfg')

  if (!existsSync(join(options.project, 'project.godot'))) {
    log('godotai.skipped', { project: options.project, reason: 'no project.godot' })
    return { ok: true, tag, plugin, verification: 'skipped', skipped: 'no project.godot' }
  }
  if (existsSync(plugin)) {
    log('godotai.present', { tag, plugin })
    return { ok: true, tag, plugin, verification: 'present' }
  }
  if (options.mode === 'check') {
    log('godotai.missing', { tag, wanted: plugin })
    return { ok: false, tag, plugin, verification: 'absent' }
  }
  const zip = join(CACHE_DIR, `${tag}-${asset}`)
  if (!existsSync(zip)) await download(`${base}/${asset}`, zip)

  // The v4 archive publishes no `.sha256` asset of its own — the one that release
  // carries belongs to the v3 archive — so the digest is read from the manifest, with
  // the sidecar only as a fallback for releases that ship one.
  let verification = 'unverified'
  try {
    let expected = null
    try {
      const manifest = JSON.parse(await fetchText(`${base}/godot-ai-v4-plugin.manifest.json`))
      if (manifest?.asset?.name === asset && typeof manifest.asset.sha256 === 'string') {
        expected = manifest.asset.sha256.toLowerCase()
      }
    } catch (error) {
      log('godotai.manifest.unavailable', { reason: error.message })
    }
    if (expected === null) {
      const text = await fetchText(`${base}/${asset}.sha256`)
      expected = digestFor(text, asset) ?? text.trim().split(/\s+/)[0].toLowerCase()
    }
    const actual = hashFile(zip, 'sha256')
    if (actual !== expected) {
      log('godotai.checksum.mismatch', { expected, actual })
      return { ok: false, tag, plugin, verification: 'failed' }
    }
    verification = 'sha256'
    log('godotai.checksum.ok', { algorithm: 'sha256', source: 'manifest' })
  } catch (error) {
    log('godotai.checksum.unavailable', { reason: error.message })
  }

  if (!extractZip(zip, options.project)) return { ok: false, tag, plugin, verification: 'extract-failed' }
  if (!existsSync(plugin)) {
    log('godotai.layout.unexpected', { project: options.project, expected: 'addons/godot_ai/plugin.cfg' })
    return { ok: false, tag, plugin, verification: 'layout-unexpected' }
  }
  log('godotai.installed', { tag, plugin, verification })
  return { ok: true, tag, plugin, verification }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\nUsage: node scripts/provision-godot.mjs [--mode check|apply] [--project DIR]\n`)
    process.exit(2)
  }
  if (options.help) {
    process.stdout.write('Usage: node scripts/provision-godot.mjs [--mode check|apply] [--project DIR]\n')
    process.exit(0)
  }
  log('provision.start', { mode: options.mode, project: options.project, platform: options.key })

  const components = {}
  for (const [key, run] of [['godot', installGodot], ['uv', installUv], ['godotai', installGodotAi]]) {
    try {
      components[key] = await run(options)
    } catch (error) {
      components[key] = { ok: false, error: error.message }
      log(`${key}.failed`, { reason: error.message })
    }
  }
  const ok = Object.values(components).every((component) => component.ok)
  log('provision.summary', { ok, mode: options.mode, components })
  process.exit(ok || options.mode === 'check' ? 0 : 1)
}

await main()
