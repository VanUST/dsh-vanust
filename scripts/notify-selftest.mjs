/**
 * PURPOSE
 *   Raise ONE real notification on the machine running it, through the same builder the plugin
 *   uses, so "notifications work here" is a measurement rather than an assumption. The unit
 *   suite can only prove the command's SHAPE; whether `notify-send` exists, whether a session
 *   bus answers, and whether the popup appears are facts about the host.
 *
 * INPUTS
 *   Optional `--platform <linux|win32|darwin>` to test a path other than this host's, which is
 *   useful for inspecting the exact command a Windows machine would run without running it.
 *   Optional `--style overlay|daemon` to choose the corner or the desktop. The TEXT does not
 *   change with the style - only how it is presented - so a daemon popup is the same message
 *   in the desktop's own frame rather than a different notification.
 *   Optional `--dry-run` to print the command and spawn nothing.
 *
 * OUTPUTS
 *   The command it ran and the child's exit code. Exit 0 when the child exited 0 (or on a
 *   dry-run), 1 when the notifier refused, 2 when this platform has no notifier.
 *
 * KEYWORDS
 *   notification, selftest, notify-send, toast, evidence, host capability
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A spawn error (no `notify-send` installed): reported with its code, exit 1, no throw.
 *   - A notifier that never exits (a hanging daemon): killed after ten seconds and reported.
 *   - `--dry-run` on any platform: prints and exits 0 without spawning.
 */

import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { notificationCommand, sessionMessage } from '../plugins/notify/notify-core.mjs'
import { detectDisplay } from '../plugins/notify/plugin-notify.mjs'

/** Parse `--platform <value>` and `--dry-run`. */
function parseArgs(argv) {
  const options = { platform: process.platform, style: 'overlay', dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dry-run') options.dryRun = true
    else if (argv[index] === '--platform') options.platform = argv[++index] ?? ''
    else if (argv[index] === '--style') options.style = argv[++index] ?? 'overlay'
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
// The overlay claims a stack row, so a row IS the proof that it started. Without this check the
// self-test proves only that a process was spawned - and a machine quietly degraded to the
// desktop notification would report success while showing a notification with no close button,
// no fixed corner and no stacking.
const slotsDir =
  process.env.DSH_NOTIFY_SLOTS_DIR && process.env.DSH_NOTIFY_SLOTS_DIR !== ''
    ? process.env.DSH_NOTIFY_SLOTS_DIR
    : join(process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh'), 'cache', 'notify-slots')

const built = notificationCommand({
  platform: options.platform,
  style: options.style,
  title: 'DeepSeek Harness',
  // The SAME shape every notification uses: source first, then what happened. A self-test that
  // renders differently from the real thing verifies a notification nobody will ever see - the
  // split this exists to avoid.
  body: sessionMessage('self-test', 'if you can read this, the agent can reach your desktop'),
  slotsDir,
})

if (built === null) {
  process.stderr.write(`notify-selftest: no notifier implemented for ${JSON.stringify(options.platform)}\n`)
  process.exit(2)
}

const display = options.platform === 'linux' || options.platform === 'darwin' ? detectDisplay({ display: process.env.DSH_NOTIFY_DISPLAY }) : null
process.stdout.write(`display   ${display ?? '(none)'}${process.env.DISPLAY && process.env.DISPLAY !== display ? `  (inherited DISPLAY=${process.env.DISPLAY} would be invisible if it is Xvfb)` : ''}\n`)
process.stdout.write(`command   ${built.command}\n`)
process.stdout.write(`args      ${JSON.stringify(built.args)}\n`)
if (Object.keys(built.env).length > 0) process.stdout.write(`env       ${JSON.stringify(Object.keys(built.env))}\n`)
if (options.dryRun) {
  process.stdout.write('dry-run: nothing was spawned\n')
  process.exit(0)
}

// Watch for the claim WHILE the overlay is alive, because it removes the row as it closes.
let sawClaim = false
const claimWatch = setInterval(() => {
  try {
    if (readdirSync(slotsDir).some((name) => /^slot-\d+$/.test(name))) sawClaim = true
  } catch {
    // No directory yet; the overlay may still be starting.
  }
}, 100)

const child = spawn(built.command, built.args, {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, ...built.env, ...(display !== null ? { DISPLAY: display } : {}) },
})
const timer = setTimeout(() => {
  process.stderr.write('notify-selftest: the notifier did not exit within 10s; killing it\n')
  child.kill('SIGKILL')
}, 10000)
child.on('error', (error) => {
  clearTimeout(timer)
  process.stderr.write(`notify-selftest: could not run ${built.command}: ${String(error?.code ?? error)}\n`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  clearTimeout(timer)
  clearInterval(claimWatch)
  process.stdout.write(`exit      ${code === null ? `signal ${signal}` : code}\n`)
  const claims = (() => {
    try { return readdirSync(slotsDir).filter((name) => /^slot-\d+$/.test(name)).length } catch { return 0 }
  })()
  // The overlay releases its row on close, so the row may be gone by now; the point is the
  // report, and a run that never claimed one is the degraded path wearing a success exit code.
  process.stdout.write(
    `overlay   ${
      options.style === 'daemon'
        ? 'not used (--style daemon): this is the DESKTOP notification, which has no close button, no fixed corner and no stacking'
        : claims > 0 || sawClaim
          ? 'started - it claimed a stack row'
          : 'DID NOT START - the desktop fallback would be used, which has no close button, no fixed corner and no stacking'
    }\n`,
  )
  process.exit(code === 0 && (claims > 0 || sawClaim || options.style === 'daemon') ? 0 : 3)
})
