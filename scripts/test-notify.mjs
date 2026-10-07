/**
 * PURPOSE
 *   Prove the observable behaviour of the notification feature: which transitions raise a
 *   notification, which do not, and the exact command each platform is given. The command
 *   assertions are the point - a notification built by string concatenation would still "work"
 *   on a happy path and execute whatever a question happened to contain.
 *
 *   Hermetic: no desktop, no daemon and no spawn. The Linux path is exercised separately by
 *   `make notify-selftest`, which actually raises a popup on the machine running it.
 *
 * INPUTS
 *   None.
 *
 * OUTPUTS
 *   `node --test scripts/test-notify.mjs` exits 0 when every case holds.
 *
 * KEYWORDS
 *   notification, notify-send, powershell, toast, xml escape, argv not shell, behaviour test
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A question with quotes, semicolons and `$(...)` in it: it must appear in an ARGUMENT or
 *     an environment variable, never inside a command string.
 *   - A payload with no questions: a generic body rather than a throw or an empty popup.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  chooseDisplay,
  collapse,
  notificationCommand,
  OVERLAY_PYTHON_SCRIPT,
  platformFamily,
  questionSummary,
  shouldNotify,
  WINDOWS_OVERLAY_SCRIPT,
  WINDOWS_SCRIPT,
} from '../plugins/notify/notify-core.mjs'

describe('notification decision', () => {
  it('announces a finished turn that ran long enough, and stays quiet otherwise', () => {
    // Fails if the transition check or the threshold is dropped: a popup would then appear for
    // every two-second reply, which is how a human learns to ignore popups.
    const base = { from: 'running', to: 'idle', startedAt: 1000, now: 60000, minRunMs: 15000 }
    assert.equal(shouldNotify(base), true, 'a 59s turn must notify')
    assert.equal(shouldNotify({ ...base, now: 11000 }), false, 'a 10s turn is below a 15s threshold')
    assert.equal(shouldNotify({ ...base, minRunMs: 0 }), true, 'a zero threshold notifies every finished turn')
    assert.equal(shouldNotify({ ...base, from: 'idle' }), false, 'idle -> idle is not a finish')
    assert.equal(shouldNotify({ ...base, to: 'running' }), false, 'running -> running is not a finish')
    assert.equal(shouldNotify({ ...base, startedAt: undefined }), false, 'a finish nobody saw start is not announced')
    assert.equal(shouldNotify({ ...base, now: 500 }), false, 'a clock step back must not notify')
  })

  it('collapses and truncates the text a popup carries', () => {
    // Fails if multi-line agent output reaches a notification unflattened (the popup shows one
    // line) or unbounded (the daemon truncates it arbitrarily).
    assert.equal(collapse('a\n\n  b\tc '), 'a b c')
    const long = collapse('x'.repeat(500), 20)
    assert.equal(long.length, 20)
    assert.ok(long.endsWith('…'))
    assert.equal(collapse(null), '')
  })

  it('summarises a question, including several and none at all', () => {
    // Fails if the summary reads fields the payload does not have, or drops the count, which
    // is the difference between "answer this" and "answer this and three more".
    assert.equal(questionSummary({ questions: [{ question: 'Ship it?' }] }), 'Ship it?')
    assert.equal(questionSummary({ questions: [{ header: 'Release', question: 'Ship it?' }] }), 'Release: Ship it?')
    assert.equal(
      questionSummary({ questions: [{ question: 'One?' }, { question: 'Two?' }, { question: 'Three?' }] }),
      'One? (+2 more)',
    )
    assert.equal(questionSummary({}), '')
    assert.equal(questionSummary(null), '')
  })

  it('draws on the human display rather than the virtual one it inherited', () => {
    // The failure this pins, measured on the machine this was written for: the desktop runs on
    // :1 while the server's environment said :99 (Xvfb, 1920x1080, nobody watching). Drawing
    // there succeeds and shows the notification to no one.
    assert.equal(chooseDisplay({ current: ':99', nodes: [':1', ':99'], virtual: [':99'] }), ':1')
    assert.equal(chooseDisplay({ current: ':1', nodes: [':1', ':99'], virtual: [':99'] }), ':1', 'a real display is kept')
    assert.equal(chooseDisplay({ current: undefined, nodes: [':1'], virtual: [] }), ':1')
    assert.equal(chooseDisplay({ current: ':99', nodes: [':99'], virtual: [':99'] }), ':99', 'nothing else to offer, so keep it')
    assert.equal(chooseDisplay({ current: ':99', nodes: [], virtual: [':99'] }), ':99')
    assert.equal(chooseDisplay({ current: undefined, nodes: [], virtual: [] }), null)
    assert.equal(chooseDisplay({ current: ':99', nodes: [':2', ':10'], virtual: [':99'] }), ':2', 'the lowest real socket wins, numerically')
  })

  it('knows which platforms it can notify', () => {
    assert.equal(platformFamily('linux'), 'linux')
    assert.equal(platformFamily('win32'), 'windows')
    assert.equal(platformFamily('darwin'), 'macos')
    assert.equal(platformFamily(undefined), null)
  })
})

describe('overlay notification (the default style)', () => {
  it('pins the Linux overlay to the top-right and keeps it above other windows', () => {
    // Fails if the position or the always-on-top is dropped: the point of the overlay is that
    // a focused window, a fullscreen app or Do-Not-Disturb cannot hide it, which is exactly
    // what the desktop daemon gets to decide for itself.
    assert.match(OVERLAY_PYTHON_SCRIPT, /attributes\('-topmost', True\)/)
    assert.match(OVERLAY_PYTHON_SCRIPT, /overrideredirect\(True\)/)
    assert.match(OVERLAY_PYTHON_SCRIPT, /winfo_screenwidth/)
    assert.match(OVERLAY_PYTHON_SCRIPT, /screen - width - 24, 24/, 'the top-right geometry is gone')
    assert.match(OVERLAY_PYTHON_SCRIPT, /after\(dismiss, root.destroy\)/, 'an overlay that never closes is a window the human must clear')
  })

  it('builds the Linux overlay with the text in the ENVIRONMENT, never in the script', () => {
    const built = notificationCommand({ platform: 'linux', title: 'Deck', body: 'Ship "it"; $(id)' })
    assert.equal(built.command, 'python3')
    assert.deepEqual(built.args, ['-c', OVERLAY_PYTHON_SCRIPT])
    assert.equal(built.env.DSH_NOTIFY_BODY, 'Ship "it"; $(id)')
    assert.ok(!built.args[1].includes('Ship'), 'the text leaked into the script')
    assert.equal(built.env.DSH_NOTIFY_MS, '6000')
  })

  it('builds the Windows overlay as a TopMost form in the primary screen top-right', () => {
    const built = notificationCommand({ platform: 'win32', title: 'Deck', body: 'Ship "it"' })
    assert.equal(built.command, 'powershell.exe')
    assert.deepEqual(built.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command'])
    assert.equal(built.args[3], WINDOWS_OVERLAY_SCRIPT)
    assert.match(WINDOWS_OVERLAY_SCRIPT, /TopMost = \$true/)
    assert.match(WINDOWS_OVERLAY_SCRIPT, /PrimaryScreen\.WorkingArea/)
    assert.match(WINDOWS_OVERLAY_SCRIPT, /Right - \$form\.Width - 24/)
    assert.equal(built.env.DSH_NOTIFY_BODY, 'Ship "it"')
    assert.ok(!built.args[3].includes('Ship'), 'the text leaked into the script')
  })

  it('falls back to the daemon on macOS, where osascript has no positioned window', () => {
    // Documented limitation made testable: the request was top-right and always-on-top; macOS
    // cannot do either through the tools this deployment ships, so it must say so by using the
    // daemon rather than by silently placing a dialog in the middle of the screen.
    const built = notificationCommand({ platform: 'darwin', title: 't', body: 'b' })
    assert.equal(built.command, 'osascript')
    assert.match(built.args[1], /display notification/)
  })

  it('honours style: daemon for a machine that wants the desktop in charge', () => {
    const built = notificationCommand({ platform: 'linux', style: 'daemon', title: 't', body: 'b' })
    assert.equal(built.command, 'notify-send')
    const windows = notificationCommand({ platform: 'win32', style: 'daemon', title: 't', body: 'b' })
    assert.equal(windows.args[3], WINDOWS_SCRIPT)
  })

  it('takes a dismiss time and an interpreter path from the caller', () => {
    const built = notificationCommand({ platform: 'linux', title: 't', body: 'b', dismissMs: 2500, pythonPath: '/opt/venv/bin/python3' })
    assert.equal(built.command, '/opt/venv/bin/python3')
    assert.equal(built.env.DSH_NOTIFY_MS, '2500')
  })
})

describe('notification command (daemon style)', () => {
  it('passes the title and body to notify-send as ARGUMENTS, never as a shell string', () => {
    // Fails if the command is ever assembled as one string: the hostile text below would then
    // be executed rather than displayed. The assertion is that the text is an argv element
    // exactly as written, and that no shell is involved at all.
    const hostile = 'Ship it? "; rm -rf / # $(whoami) `id`'
    const built = notificationCommand({ platform: 'linux', style: 'daemon', title: 'DeepSeek Harness', body: hostile })
    assert.equal(built.command, 'notify-send')
    assert.deepEqual(built.args, ['-a', 'DeepSeek Harness', '-u', 'normal', 'DeepSeek Harness', hostile])
    assert.ok(!built.args.some((arg) => arg.includes('rm -rf') && arg.startsWith('sh')), 'a shell appeared in argv')
    assert.equal(built.env.DSH_NOTIFY_BODY, undefined, 'the Linux path does not need an env-carried body')
  })

  it('honours a configured notify-send path without inventing one', () => {
    const built = notificationCommand({ platform: 'linux', style: 'daemon', title: 't', body: 'b', notifySendPath: '/opt/bin/notify-send' })
    assert.equal(built.command, '/opt/bin/notify-send')
  })

  it('carries the Windows text in ENVIRONMENT variables and escapes it in-script', () => {
    // Fails if the text is interpolated into the PowerShell command: a title with a quote would
    // end the string, which is both a broken notification and an injection. The command must
    // contain the SCRIPT and none of the text.
    const hostile = 'Ship it? " <toast> & \' stuff'
    const built = notificationCommand({ platform: 'win32', style: 'daemon', title: 'Deck', body: hostile })
    assert.equal(built.command, 'powershell.exe')
    assert.deepEqual(built.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command'])
    assert.equal(built.args[3], WINDOWS_SCRIPT)
    assert.ok(!built.args[3].includes('Ship it?'), 'the text leaked into the command string')
    assert.equal(built.env.DSH_NOTIFY_BODY, hostile, 'the body must arrive verbatim through the environment')
    assert.equal(built.env.DSH_NOTIFY_TITLE, 'Deck')
    assert.match(built.env.DSH_NOTIFY_APPID, /WindowsPowerShell/)
    assert.match(WINDOWS_SCRIPT, /SecurityElement\]::Escape/, 'the script must escape the XML itself')
    assert.match(WINDOWS_SCRIPT, /ShowBalloonTip/, 'the fallback for a PowerShell without WinRT is missing')
  })

  it('quotes the macOS text so a quote in the question cannot end the AppleScript string', () => {
    const built = notificationCommand({ platform: 'darwin', title: 't', body: 'say "hi" \\ bye' })
    assert.equal(built.command, 'osascript')
    assert.equal(built.args[0], '-e')
    assert.match(built.args[1], /\\"hi\\"/, 'a quote was not escaped')
  })

  it('returns null for a platform with no notifier', () => {
    assert.equal(notificationCommand({ platform: undefined, title: 't', body: 'b' }), null)
  })
})
