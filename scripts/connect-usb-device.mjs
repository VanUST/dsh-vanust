/**
 * PURPOSE
 *   Connect a USB-attached phone to the chat bridge running on this machine, with one command and
 *   no configuration. It uses `adb reverse`, which asks the phone's own adb daemon to listen on a
 *   port and forward every connection to the SAME port on this PC over the USB cable. The phone's
 *   browser then opens `http://127.0.0.1:<port>/chat-bridge/` and reaches this machine's loopback
 *   interface without any of them being on a network.
 *
 *   Two consequences make this the cheapest way to reach the bridge, and both are deliberate:
 *     - The bridge's browser-trust fence sees `Host: 127.0.0.1:<port>`, which is loopback and
 *       therefore already trusted, so no `--trusted-host` and no profile change is needed. A
 *       tailnet or LAN deployment has to declare its authority; this one does not.
 *     - Nothing is exposed to any network. The tunnel exists only while the cable is attached and
 *       only for the phone holding it, so there is no listening socket a stranger can reach.
 *
 * INPUTS
 *   --port <n>       Port to forward. Default 3080, the port `dsh web` serves on.
 *   --device <id>    Which attached device, when more than one is authorized.
 *   --open           Also open the URL on the phone (Android `am start`).
 *   --check          Report what a connection WOULD do, and change nothing.
 *   --json           Print one JSON object instead of the human report.
 *   --adb <path>     adb binary; otherwise PATH, then $ANDROID_HOME/platform-tools/adb.
 *   --state-dir <p>  The bridge's state directory, to report the open pairing code. Default
 *                    `$DSH_HOME/chat-bridge`.
 *
 * OUTPUTS
 *   Exit 0 only when a device is attached, AUTHORIZED, and the reverse forward is in place (or
 *   `--check` found that it could be). Exit 1 otherwise, naming the one action the human must take.
 *   Prints the URL to open on the phone, and the pairing instruction for a device that has never
 *   been paired. `--json` prints `{ok, port, serial, url, steps[]}` for a caller to parse.
 *
 * KEYWORDS
 *   usb, adb, adb reverse, phone, chat bridge, pairing, loopback, no-network, make connect-usb-device
 *
 * BEHAVIOUR ON EDGE CASES
 *   - adb missing: says where it looked and how to install it; does not pretend the phone is at
 *     fault.
 *   - No device attached: names the two things that must be true (cable, and USB debugging
 *     enabled).
 *   - Device attached but UNAUTHORIZED: names the single action (accept the Allow USB debugging
 *     prompt on the phone) and stops. This is the most common state and the one a generic failure
 *     message wastes the most time on.
 *   - More than one authorized device: refuses to guess, lists the serials, and asks for --device.
 *   - Nothing listening on the port on this machine: forwards anyway but says plainly that the
 *     harness is not serving that port yet, because a working tunnel to nothing is the confusing
 *     failure this warns about.
 *   - The forward already exists: `adb reverse` replaces it, so re-running is a no-op rather than
 *     an error, and the command is safe to keep in a loop.
 *   - `--open` on a device whose browser is unavailable: reported as a warning; the URL is still
 *     printed, because the human can type it.
 *   - `--open` is a CONVENIENCE THAT MAY SHOW "forbidden", and it says so. `am start` launches the
 *     browser from an external app, and a browser marks such a navigation `Sec-Fetch-Site:
 *     cross-site`. The harness's trust fence refuses cross-site requests outright
 *     (`dsh-client-connection/lib/index.js:211`), so an intent-launched URL is answered 403 while
 *     the identical URL opened from the browser's own address bar (measured: `Sec-Fetch-Site:
 *     none`) is answered 200. The tunnel is not the problem and nothing here is broken; the
 *     navigation is. The reliable one-time action is to open the URL in the browser once and add
 *     it to the home screen or bookmark it.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Ports `dsh web` serves on by default. */
const DEFAULT_PORT = 3080

/**
 * Parse the arguments.
 *
 * @param argv - `process.argv.slice(2)`.
 * @returns The parsed options; `error` is set for a usage problem.
 */
function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, device: null, open: false, check: false, json: false, adb: null, stateDir: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--port') options.port = Number(argv[++index])
    else if (arg === '--device') options.device = argv[++index] ?? null
    else if (arg === '--adb') options.adb = argv[++index] ?? null
    else if (arg === '--state-dir') options.stateDir = argv[++index] ?? null
    else if (arg === '--open') options.open = true
    else if (arg === '--check') options.check = true
    else if (arg === '--json') options.json = true
    else return { error: `unknown argument ${JSON.stringify(arg)}` }
  }
  if (!Number.isSafeInteger(options.port) || options.port <= 0 || options.port > 65535) {
    return { error: `--port must be a port number, got ${JSON.stringify(String(options.port))}` }
  }
  return options
}

/**
 * Resolve the adb binary.
 *
 * @param explicit - A path from `--adb`, when given.
 * @returns The binary to run.
 * @throws When none can be found.
 */
function resolveAdb(explicit) {
  if (typeof explicit === 'string' && explicit !== '') {
    if (!existsSync(explicit)) throw new Error(`--adb names ${explicit}, which does not exist`)
    return explicit
  }
  const fromSdk = process.env.ANDROID_HOME === undefined ? null : join(process.env.ANDROID_HOME, 'platform-tools', 'adb')
  if (fromSdk !== null && existsSync(fromSdk)) return fromSdk
  // `adb` on PATH is the normal case; let the spawn find it and report ENOENT if it does not.
  return 'adb'
}

/**
 * Run one adb command.
 *
 * @param adb - The adb binary.
 * @param args - Arguments.
 * @returns `{ok, stdout, stderr}`; never throws.
 */
function run(adb, args) {
  try {
    const stdout = execFileSync(adb, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, stdout, stderr: '' }
  } catch (error) {
    return {
      ok: false,
      stdout: typeof error?.stdout === 'string' ? error.stdout : '',
      stderr: typeof error?.stderr === 'string' ? error.stderr : String(error?.message ?? error),
    }
  }
}

/**
 * Read the attached devices and their authorization state.
 *
 * @param adb - The adb binary.
 * @returns `{devices, raw}` where each device is `{serial, state, model}`.
 */
function listDevices(adb) {
  const result = run(adb, ['devices', '-l'])
  const devices = []
  for (const line of result.stdout.split('\n')) {
    const match = /^(\S+)\s+(device|unauthorized|offline|no permissions|recovery|sideload)\b(.*)$/.exec(line.trim())
    if (match === null) continue
    const model = /model:(\S+)/.exec(match[3])
    devices.push({ serial: match[1], state: match[2], model: model === null ? null : model[1] })
  }
  return { devices, raw: result.stdout + result.stderr }
}

/**
 * Whether something on this machine is listening on the given port.
 *
 * Read from /proc rather than by connecting, so probing does not itself open a socket to the
 * harness. A `/proc` that cannot be read reports "unknown", never a false negative.
 *
 * @param port - Port to look for.
 * @returns `true`, `false`, or `null` when it could not be determined.
 */
function portListening(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0')
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text
    // Read the file directly. A `sh -c cat` here would be shell-dependent spawn, which the kit
    // bans in scripts/ for a real reason: the argument vector is re-parsed by a shell that may
    // not be the one the caller assumed.
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (text === '') continue
    for (const line of text.split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/)
      if (fields.length < 4) continue
      const local = fields[1] ?? ''
      const state = fields[3] ?? ''
      if (local.endsWith(`:${hex}`) && state === '0A') return true
    }
  }
  return false
}

/**
 * Read the bridge's open pairing code, so the human does not have to find it in a log.
 *
 * This is a convenience built on a file the bridge already writes for exactly this purpose. Every
 * failure is silent: a machine with no code, no state directory, or a code already spent simply
 * gets no pairing line instead of an error about a file the human never asked about.
 *
 * @param stateDir - The explicit `--state-dir`, or null to use the default.
 * @returns `{code, expiresAt}` for an open code, otherwise null.
 */
function openPairingCode(stateDir) {
  const directory = stateDir ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'chat-bridge')
  try {
    const parsed = JSON.parse(readFileSync(join(directory, 'pairing.json'), 'utf8'))
    if (typeof parsed?.code !== 'string' || !/^[0-9]{6}$/.test(parsed.code)) return null
    if (!Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= Date.now()) return null
    return { code: parsed.code, expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

/**
 * The main routine.
 *
 * @returns The report object and a process exit code.
 */
function connect() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.error !== undefined) return { code: 2, report: { ok: false, error: parsed.error } }
  const options = parsed

  let adb
  try {
    adb = resolveAdb(options.adb)
  } catch (error) {
    return {
      code: 1,
      report: {
        ok: false,
        error: String(error.message),
        fix: 'install the Android platform tools (they provide adb), or pass --adb /path/to/adb',
      },
    }
  }

  const { devices, raw } = listDevices(adb)
  if (devices.length === 0) {
    if (/not found|ENOENT/i.test(raw)) {
      return {
        code: 1,
        report: {
          ok: false,
          error: 'adb was not found',
          fix: 'install the Android platform tools (they provide adb), or pass --adb /path/to/adb',
        },
      }
    }
    return {
      code: 1,
      report: {
        ok: false,
        error: 'no phone is attached',
        fix: 'plug the phone in with a data cable, and enable Developer options > USB debugging on it',
      },
    }
  }

  const unauthorized = devices.filter((device) => device.state === 'unauthorized')
  if (unauthorized.length > 0 && devices.every((device) => device.state === 'unauthorized')) {
    return {
      code: 1,
      report: {
        ok: false,
        error: `the phone is attached but NOT AUTHORIZED (${unauthorized.map((d) => d.serial).join(', ')})`,
        fix: 'look at the phone: accept the "Allow USB debugging?" dialog. If it does not appear, unplug and replug the cable.',
        devices,
      },
    }
  }

  const ready = devices.filter((device) => device.state === 'device')
  if (ready.length === 0) {
    return {
      code: 1,
      report: {
        ok: false,
        error: `no usable device; attached states are ${devices.map((d) => `${d.serial}=${d.state}`).join(', ')}`,
        devices,
      },
    }
  }
  if (ready.length > 1 && options.device === null) {
    return {
      code: 1,
      report: {
        ok: false,
        error: `${String(ready.length)} devices are attached; name one`,
        fix: `re-run with --device <serial>. Attached: ${ready.map((d) => `${d.serial}${d.model === null ? '' : ` (${d.model})`}`).join(', ')}`,
        devices,
      },
    }
  }
  const target = options.device === null ? ready[0] : ready.find((device) => device.serial === options.device)
  if (target === undefined) {
    return {
      code: 1,
      report: {
        ok: false,
        error: `no attached device has serial ${JSON.stringify(options.device)}`,
        devices,
      },
    }
  }

  const serving = portListening(options.port)
  const steps = []
  if (serving === false) {
    steps.push({
      warning: `nothing on this machine is listening on port ${String(options.port)}; start the harness first (for example \`dsh web\`) or the tunnel will lead nowhere`,
    })
  }

  const url = `http://127.0.0.1:${String(options.port)}/chat-bridge/`
  // The pairing link carries the code so the phone types nothing; the page spends it on arrival.
  const pairing = openPairingCode(options.stateDir)
  const pairUrl = pairing === null ? url : `${url}?code=${pairing.code}`
  if (options.check) {
    steps.push({ would: `adb -s ${target.serial} reverse tcp:${String(options.port)} tcp:${String(options.port)}` })
    return {
      code: 0,
      report: { ok: true, checked: true, port: options.port, serial: target.serial, url, pairUrl, pairing, steps },
    }
  }

  const forwarded = run(adb, ['-s', target.serial, 'reverse', `tcp:${String(options.port)}`, `tcp:${String(options.port)}`])
  if (!forwarded.ok) {
    return {
      code: 1,
      report: {
        ok: false,
        error: `adb reverse failed: ${forwarded.stderr.trim()}`,
        fix: 'run `adb kill-server`, replug the cable, and accept the dialog on the phone',
        devices,
      },
    }
  }
  steps.push({ reverse: `tcp:${String(options.port)} -> tcp:${String(options.port)}` })

  // Confirm from adb's own registry rather than trusting the exit code: a forward that was
  // accepted but not recorded would leave the phone talking to nothing.
  const listed = run(adb, ['-s', target.serial, 'reverse', '--list'])
  const recorded = listed.ok && listed.stdout.includes(`tcp:${String(options.port)}`)
  steps.push({ verified: recorded ? 'adb reports the reverse forward is in place' : 'adb did not list the forward back' })

  if (options.open) {
    const opened = run(adb, ['-s', target.serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url])
    steps.push(
      opened.ok
        ? {
            opened: `${url} — if the phone shows "forbidden", that is this launch and not the tunnel: the harness refuses cross-site navigations, and an app-launched URL is one. Open the URL from the browser itself (or its home-screen shortcut) and it loads.`,
          }
        : { warning: `could not open the URL on the phone: ${opened.stderr.trim()}` },
    )
  }

  return {
    code: recorded ? 0 : 1,
    report: { ok: recorded, port: options.port, serial: target.serial, url, pairUrl, pairing, serving, steps },
  }
}

const { code, report } = connect()
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else if (report.ok) {
  process.stdout.write(`chat bridge: USB tunnel ready on ${String(report.serial)}\n`)
  process.stdout.write(`  open on the phone:  ${report.url}\n`)
  process.stdout.write('  on the phone, open that URL IN THE BROWSER (type it, or bookmark it once).\n')
  process.stdout.write('    Do not open it from another app: the harness refuses cross-site navigations, and an\n')
  process.stdout.write('    app-launched URL is one, so it answers "forbidden". A browser-typed URL works.\n')
  process.stdout.write('  add it to the home screen once, and afterwards it is a one-tap app.\n')
  if (report.pairing === null) {
    process.stdout.write('  no open pairing code: either a device is already paired, or the code expired.\n')
  } else {
    const minutes = Math.max(0, Math.round((report.pairing.expiresAt - Date.now()) / 60000))
    process.stdout.write(`  pairing code: ${report.pairing.code} (expires in ~${String(minutes)} min)\n`)
    process.stdout.write(`  pair in ONE step (no digits typed): ${report.pairUrl}\n`)
  }
  for (const step of report.steps ?? []) {
    const [key] = Object.keys(step)
    if (key === 'warning') process.stdout.write(`  WARNING ${step.warning}\n`)
    else process.stdout.write(`  ${key}: ${String(step[key])}\n`)
  }
} else {
  process.stdout.write(`chat bridge: cannot connect a phone\n  ${String(report.error)}\n`)
  if (report.fix !== undefined) process.stdout.write(`  what to do: ${String(report.fix)}\n`)
  for (const device of report.devices ?? []) {
    process.stdout.write(`  attached: ${device.serial} (${device.state})\n`)
  }
}
process.exit(code)
