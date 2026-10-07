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

import { notificationCommand } from '../plugins/notify/notify-core.mjs'

/** Parse `--platform <value>` and `--dry-run`. */
function parseArgs(argv) {
  const options = { platform: process.platform, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dry-run') options.dryRun = true
    else if (argv[index] === '--platform') options.platform = argv[++index] ?? ''
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
const built = notificationCommand({
  platform: options.platform,
  title: 'DeepSeek Harness',
  body: 'Notification self-test: if you can read this, the agent can reach your desktop.',
})

if (built === null) {
  process.stderr.write(`notify-selftest: no notifier implemented for ${JSON.stringify(options.platform)}\n`)
  process.exit(2)
}

process.stdout.write(`command   ${built.command}\n`)
process.stdout.write(`args      ${JSON.stringify(built.args)}\n`)
if (Object.keys(built.env).length > 0) process.stdout.write(`env       ${JSON.stringify(Object.keys(built.env))}\n`)
if (options.dryRun) {
  process.stdout.write('dry-run: nothing was spawned\n')
  process.exit(0)
}

const child = spawn(built.command, built.args, { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...built.env } })
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
  process.stdout.write(`exit      ${code === null ? `signal ${signal}` : code}\n`)
  process.exit(code === 0 ? 0 : 1)
})
