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
  firstFreeSlot,
  sessionLabel,
  sessionMessage,
  OVERLAY_HEIGHT,
  OVERLAY_MAX_SLOTS,
  OVERLAY_PITCH,
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
    assert.match(
      OVERLAY_PYTHON_SCRIPT,
      /screen - WIDTH - MARGIN, MARGIN \+ slot \* PITCH/,
      'the top-right geometry, or the stack row that keeps simultaneous notifications apart, is gone',
    )
    assert.match(OVERLAY_PYTHON_SCRIPT, /after\(dismiss, close_now\)/, 'an overlay that never closes is a window the human must clear')
  })

  it('gives the Linux overlay a close button, a click target and a hover pause', () => {
    // The three things asked for, each with a way to fail: without the ✕ the only way out is
    // waiting; without the click binding the notification cannot take you anywhere; without the
    // pause a notification you are reading disappears mid-sentence.
    // U+00D7, not a decorative cross: it is present in every font, so the ✕ renders everywhere
    // instead of becoming an empty box on a machine whose font lacks the fancier glyph.
    assert.match(OVERLAY_PYTHON_SCRIPT, /\u00d7/, 'the close glyph is gone')
    assert.match(OVERLAY_PYTHON_SCRIPT, /close\.pack\(side='right'\)[\s\S]{0,400}title_label\.pack\(side='left'\)/, 'the close button must claim its side before the title can squeeze it out')
    assert.match(OVERLAY_PYTHON_SCRIPT, /close\.bind\('<Button-1>', close_now\)/, '✕ does not dismiss')
    assert.match(OVERLAY_PYTHON_SCRIPT, /body_label\.bind\('<Button-1>', open_now\)/, 'the body is not clickable')
    assert.match(OVERLAY_PYTHON_SCRIPT, /webbrowser\.open\(url\)/, 'a click does not open the chat url')
    assert.match(OVERLAY_PYTHON_SCRIPT, /subprocess\.Popen\(\["xdg-open", url\]\)/, 'no fallback opener for a box without python-webbrowser')
    assert.match(OVERLAY_PYTHON_SCRIPT, /bind\('<Enter>', pause\)/, 'hover does not pause the auto-dismiss')
    assert.match(OVERLAY_PYTHON_SCRIPT, /arm\(\)/, 'the timer is never armed')
  })

  it('claims a stack row atomically so simultaneous notifications cannot overlap', () => {
    // One process per notification cannot see the others, so the row must be CLAIMED rather
    // than negotiated: an exclusive create is what makes two races resolve to two rows instead
    // of two windows in one place. Stale claims are pruned, so a killed popup does not hold a
    // row for ever.
    assert.match(OVERLAY_PYTHON_SCRIPT, /O_CREAT \| os\.O_EXCL \| os\.O_WRONLY/)
    assert.match(OVERLAY_PYTHON_SCRIPT, /os\.path\.getmtime\(old\) > STALE/)
    assert.match(OVERLAY_PYTHON_SCRIPT, /os\.remove\(claim\)/, 'a closed overlay must release its row')
    assert.match(WINDOWS_OVERLAY_SCRIPT, /FileMode\]::CreateNew/)
    assert.match(WINDOWS_OVERLAY_SCRIPT, /Remove-Item -Force -ErrorAction SilentlyContinue \$claim/)
  })

  it('names the session a notification is about', () => {
    // Without this a popup says only "Finished after 93s", which is useless with two chats
    // open. Both fields are the harness's own session identity, read defensively.
    const full = { session: { id: 'session-5fbab0a6-1b7a-4382-b3e3-a25978f858d1', header: { cwd: '/home/iustimov/dsh-kit' } } }
    assert.equal(sessionLabel(full), 'dsh-kit - #5fbab0a6')
    assert.equal(sessionLabel({ session: { id: 'session-5fbab0a6-x', header: {} } }), '#5fbab0a6', 'no cwd: the id must stand alone')
    assert.equal(sessionLabel({ session: { header: { cwd: '/home/iustimov/dsh-kit' } } }), 'dsh-kit', 'no id: the project must stand alone')
    assert.equal(sessionLabel({ session: { id: 'session-abc', header: { cwd: '/x/y', title: 'Into the Unknown' } } }), 'y - Into the Unknown')
    assert.equal(sessionLabel({}), '', 'an agent with no identity contributes nothing')
    assert.equal(sessionLabel(undefined), '')
    assert.equal(sessionLabel({ session: { id: 42, header: { cwd: 7 } } }), '', 'a moved field must not become a wrong label')
    assert.equal(sessionLabel({ session: { header: { cwd: '/a/b/' } } }), 'b', 'a trailing slash is not a name')
  })

  it('puts the session first, and drops the separator when there is none', () => {
    assert.equal(sessionMessage('dsh-kit - #5fbab0a6', 'Finished after 93s'), 'dsh-kit - #5fbab0a6 - Finished after 93s')
    assert.equal(sessionMessage('', 'Finished after 93s'), 'Finished after 93s')
    assert.equal(sessionMessage('', ''), '')
  })

  it('picks the lowest free stack row, and reports a full stack', () => {
    assert.equal(firstFreeSlot([]), 0)
    assert.equal(firstFreeSlot([0]), 1)
    assert.equal(firstFreeSlot([0, 2]), 1, 'a hole is a free row')
    assert.equal(firstFreeSlot([1, 2, 3]), 0)
    assert.equal(firstFreeSlot([0, 1, 2, 3, 4, 5, 6, 7]), null, 'a full stack has no free row')
    assert.equal(OVERLAY_MAX_SLOTS, 8)
    assert.ok(OVERLAY_PITCH > OVERLAY_HEIGHT, 'rows would overlap if the pitch were not taller than a row')
  })

  it('builds the Linux overlay with the text in the ENVIRONMENT, never in the script', () => {
    const built = notificationCommand({ platform: 'linux', title: 'Deck', body: 'Ship "it"; $(id)' })
    assert.equal(built.command, 'python3')
    assert.deepEqual(built.args, ['-c', OVERLAY_PYTHON_SCRIPT])
    assert.equal(built.env.DSH_NOTIFY_BODY, 'Ship "it"; $(id)')
    assert.ok(!built.args[1].includes('Ship'), 'the text leaked into the script')
    assert.equal(built.env.DSH_NOTIFY_MS, '6000')
    assert.equal(built.env.DSH_NOTIFY_URL, '', 'no url means a click only dismisses')
    assert.equal(built.env.DSH_NOTIFY_SLOTS, '', 'no slot directory means every notification takes row 0')
  })

  it('carries the chat url and the slot directory to the overlay', () => {
    const built = notificationCommand({
      platform: 'linux',
      title: 't',
      body: 'b',
      url: 'http://127.0.0.1:3080/',
      slotsDir: '/home/u/.npm/dsh/cache/notify-slots',
    })
    assert.equal(built.env.DSH_NOTIFY_URL, 'http://127.0.0.1:3080/')
    assert.equal(built.env.DSH_NOTIFY_SLOTS, '/home/u/.npm/dsh/cache/notify-slots')
    assert.ok(!built.args[1].includes('3080'), 'the url leaked into the script instead of the environment')
  })

  it('builds the Windows overlay as a TopMost form in the primary screen top-right', () => {
    const built = notificationCommand({ platform: 'win32', title: 'Deck', body: 'Ship "it"' })
    assert.equal(built.command, 'powershell.exe')
    assert.deepEqual(built.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command'])
    assert.equal(built.args[3], WINDOWS_OVERLAY_SCRIPT)
    assert.match(WINDOWS_OVERLAY_SCRIPT, /TopMost = \$true/)
    assert.match(WINDOWS_OVERLAY_SCRIPT, /PrimaryScreen\.WorkingArea/)
    assert.match(WINDOWS_OVERLAY_SCRIPT, /Right - \$width - \$margin/, 'the top-right anchor is gone')
    assert.match(WINDOWS_OVERLAY_SCRIPT, /\$margin \+ \(\$slot \* \$pitch\)/, 'the stack row is gone')
    assert.match(WINDOWS_OVERLAY_SCRIPT, /0x00d7/, 'the close glyph is gone')
    assert.match(WINDOWS_OVERLAY_SCRIPT, /Start-Process \$env:DSH_NOTIFY_URL/, 'a click does not open the chat url')
    assert.match(WINDOWS_OVERLAY_SCRIPT, /Add_MouseEnter\(\$pauseHandler\)/, 'hover does not pause the auto-dismiss')
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
