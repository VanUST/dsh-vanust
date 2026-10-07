/**
 * PURPOSE
 *   Raise a desktop notification when the agent STOPS WORKING and when it ASKS THE USER
 *   SOMETHING, so a human who walked away while a long turn ran finds out without watching the
 *   window. It is deliberately small: it decides nothing about the work, changes nothing the
 *   agent sees, and cannot fail a turn - a machine with no notifier loses the popup, never the
 *   answer.
 *
 *   Two harness seams carry it, and neither is a guess:
 *     - `agent/status` with `{ agent, status }`, where a `running -> idle` transition IS the
 *       turn having ended. A turn shorter than `minRunMs` is ignored, because a popup for a
 *       two-second reply trains a human to dismiss popups.
 *     - `user-questions/request`, the waterfall the harness's own ask-user tool calls before
 *       it waits for an answer. Listening THERE rather than to a tool name means any future
 *       caller that asks a question notifies too. The listener announces first and then calls
 *       `next()`, so the notification is raised while the human is being waited on rather than
 *       after they have already answered.
 *
 * INPUTS
 *   Config (all optional):
 *     `enabled`      - false turns every notification off. Default true.
 *     `onFinish`     - announce a `running -> idle` transition. Default true.
 *     `onQuestion`   - announce a `user-questions/request`. Default true.
 *     `minRunMs`     - shortest turn worth announcing. Default 15000 (15s).
 *     `title`        - the notification title. Default `DeepSeek Harness`.
 *     `style`        - `overlay` (default) puts a borderless ALWAYS-ON-TOP window in the
 *                      top-right corner of the screen, where no focused window, fullscreen
 *                      app or Do-Not-Disturb setting can hide it. `daemon` hands the
 *                      notification to the desktop instead (`notify-send`, a Windows toast,
 *                      `osascript`), which decides its own placement and can suppress it.
 *                      macOS has no positioned overlay through `osascript` and therefore
 *                      always uses the daemon path there.
 *     `dismissMs`    - how long an overlay stays on screen. Default 6000.
 *     `pythonPath`   - the interpreter an overlay runs on. Default `python3`.
 *     `url`          - what a CLICK on a notification opens. Default: the harness's own Web
 *                      address, so a click reuses the running `dsh web` rather than starting a
 *                      second one. `DSH_NOTIFY_URL` overrides it.
 *     `slotsDir`     - where concurrent notifications claim a stack row (fixed width, height
 *                      and pitch, exclusive file creation), so several at once line up instead
 *                      of overlapping. `DSH_NOTIFY_SLOTS_DIR` overrides it.
 *     `notifySendPath`, `powershellPath`, `appId` - launcher overrides, passed through to
 *       `notificationCommand`; the only absolute paths this plugin will ever use.
 *   Environment: `DSH_NOTIFY_DISABLED=1` disables the plugin without editing the profile, and
 *   `DSH_NOTIFY_MIN_RUN_MS` overrides the threshold, so a machine can silence it in a shell.
 *
 * OUTPUTS
 *   No tool, no prompt section and no service: the plugin's whole output is a process spawned
 *   on another program's behalf. `apply(ctx)` returns nothing and never throws.
 *
 * KEYWORDS
 *   notification, desktop, turn finished, user question, notify-send, powershell toast,
 *   cross-platform, agent/status, user-questions
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No notifier on the host (no `notify-send`, no PowerShell): the spawn fails, the error is
 *     logged ONCE per platform, and nothing else changes.
 *   - A notification process that hangs: nothing waits for it. It is spawned detached with
 *     `stdio: 'ignore'` and unref'd, so the agent loop is never blocked by a popup.
 *   - A throwing listener in the waterfall: the question listener wraps its own work in
 *     try/catch and always calls `next()`, because a notification that broke asking would be
 *     far worse than a missing popup.
 *   - `agent/status` for a session whose start was never seen: no finish notification.
 *   - A status flap (running, idle, running, idle) inside the threshold: no notification.
 *   - Repeated notification failures: logged once, not once per turn, so a headless machine
 *     does not fill a log with the same line.
 */

import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  APP_NAME,
  chooseDisplay,
  DEFAULT_DISMISS_MS,
  notificationCommand,
  platformFamily,
  questionSummary,
  sessionLabel,
  sessionMessage,
  shouldNotify,
} from './notify-core.mjs'

/** X display sockets, when this machine has any. */
function displayNodes() {
  try {
    return readdirSync('/tmp/.X11-unix')
      .filter((name) => /^X\d+$/.test(name))
      .map((name) => `:${name.slice(1)}`)
  } catch {
    return []
  }
}

/**
 * The displays an Xvfb server owns, read from `/proc`.
 *
 * Bounded by construction: one `readdirSync` of `/proc` plus a `cmdline` read per numeric
 * entry, and every failure is skipped. A machine where this finds nothing simply keeps the
 * display it was given.
 */
function virtualDisplays() {
  const found = new Set()
  let pids = []
  try {
    pids = readdirSync('/proc').filter((name) => /^\d+$/.test(name))
  } catch {
    return []
  }
  for (const pid of pids) {
    let cmdline
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    } catch {
      continue
    }
    const match = /Xvfb\s+(:\d+)/.exec(cmdline.replace(/\0/g, ' '))
    if (match) found.add(match[1])
  }
  return [...found]
}

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'notify'

/** Nothing is injected: this plugin observes events and needs no service to exist. */
export const inject = []

/** How long a turn must have run to be worth a popup. */
const DEFAULT_MIN_RUN_MS = 15000

/** Whether notifications can be silenced from the environment. */
function disabledFromEnv() {
  const value = process.env.DSH_NOTIFY_DISABLED
  return typeof value === 'string' && value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}

/**
 * The threshold in force, from the environment or the profile config.
 *
 * @param config - Resolved plugin configuration.
 * @returns A non-negative number of milliseconds.
 */
function minRunMsFrom(config) {
  const fromEnv = Number(process.env.DSH_NOTIFY_MIN_RUN_MS)
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv
  return Number.isFinite(config?.minRunMs) && config.minRunMs >= 0 ? config.minRunMs : DEFAULT_MIN_RUN_MS
}

/**
 * The X display an overlay should draw on, for this process.
 *
 * Exported so `scripts/notify-selftest.mjs` can print it: "the notification appeared nowhere"
 * is otherwise undiagnosable from the outside, and the answer is usually that the server
 * inherited a virtual display.
 *
 * @param config - Resolved plugin configuration; `display` wins over everything.
 * @returns A display name, or null when none could be determined.
 */
export function detectDisplay(config = {}) {
  if (typeof config.display === 'string' && config.display !== '') return config.display
  if (typeof process.env.DSH_NOTIFY_DISPLAY === 'string' && process.env.DSH_NOTIFY_DISPLAY !== '') return process.env.DSH_NOTIFY_DISPLAY
  return chooseDisplay({ current: process.env.DISPLAY, nodes: displayNodes(), virtual: virtualDisplays() })
}

/**
 * Install the two listeners.
 *
 * @param ctx - Cordis context.
 * @param config - Resolved plugin configuration; see the module header.
 * @returns Nothing.
 */
export function apply(ctx, config = {}) {
  const enabled = config.enabled !== false && !disabledFromEnv()
  const onFinish = config.onFinish !== false
  const onQuestion = config.onQuestion !== false
  const title = typeof config.title === 'string' && config.title !== '' ? config.title : APP_NAME
  const minRunMs = minRunMsFrom(config)
  // Where a click goes: the RUNNING GUI. `webStartup` carries the address this server actually
  // bound, so an instance on another port opens itself rather than a remembered 3080.
  const startup = ctx.get('webStartup')
  const webAddress =
    typeof config.url === 'string' && config.url !== ''
      ? config.url
      : typeof process.env.DSH_NOTIFY_URL === 'string' && process.env.DSH_NOTIFY_URL !== ''
        ? process.env.DSH_NOTIFY_URL
        : `http://${startup?.host ?? '127.0.0.1'}:${startup?.port ?? 3080}/`
  const slotsDir =
    typeof config.slotsDir === 'string' && config.slotsDir !== ''
      ? config.slotsDir
      : typeof process.env.DSH_NOTIFY_SLOTS_DIR === 'string' && process.env.DSH_NOTIFY_SLOTS_DIR !== ''
        ? process.env.DSH_NOTIFY_SLOTS_DIR
        : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cache', 'notify-slots')
  const family = platformFamily(process.platform)
  // Which display the overlay draws on. Explicit config wins; then the environment; then a
  // real socket in preference to the virtual one this process probably inherited. The choice
  // is logged once, because "the notification appeared nowhere" is otherwise impossible to
  // diagnose from the outside.
  const display = detectDisplay(config)
  /** When each agent last entered `running`, so a finish can be timed. */
  const runningSince = new Map()
  /** Failures already reported, by launch command, so a headless host logs one line. */
  const reported = new Set()

  /**
   * Raise one notification, or explain once why it could not be raised.
   *
   * @param body - The notification text.
   * @returns Nothing; the child is detached and never awaited.
   */
  function notify(body) {
    if (!enabled) return
    // The style is the caller's, except that an overlay that cannot START falls back to the
    // daemon: a machine with no Python, no DISPLAY or no Tkinter should lose the corner and
    // the always-on-top, not the notification itself.
    const style = config.style === 'daemon' ? 'daemon' : 'overlay'
    notifyWith(body, style)
  }

  /**
   * Raise one notification in the requested style, falling back to the daemon once.
   *
   * @param body - The notification text.
   * @param style - `overlay` or `daemon`.
   * @returns Nothing.
   */
  function notifyWith(body, style) {
    const built = notificationCommand({
      platform: process.platform,
      style,
      title,
      body,
      dismissMs: Number.isFinite(config.dismissMs) && config.dismissMs > 0 ? config.dismissMs : DEFAULT_DISMISS_MS,
      url: webAddress,
      slotsDir,
      pythonPath: config.pythonPath,
      notifySendPath: config.notifySendPath,
      powershellPath: config.powershellPath,
      appId: config.appId,
    })
    if (built === null) {
      if (!reported.has('platform')) {
        reported.add('platform')
        ctx.logger?.info?.(`notify: no notifier implemented for platform ${JSON.stringify(process.platform)}`)
      }
      return
    }
    try {
      const child = spawn(built.command, built.args, {
        // The overlay is only as visible as its display: a server that inherited Xvfb would
        // draw the window correctly and show it to nobody.
        ...(family === 'linux' && typeof display === 'string' && display !== '' ? { env: { ...process.env, ...built.env, DISPLAY: display } } : {}),
        // `detached` + `unref` so a popup outlives nothing and blocks nothing: the turn has
        // already ended by the time this runs, and a notification daemon that hangs must not
        // hold a handle the harness waits on.
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...built.env },
      })
      child.on('error', (error) => {
        const code = String(error?.code ?? error?.message ?? 'error')
        const key = `${built.command}:${code}`
        if (!reported.has(key)) {
          reported.add(key)
          ctx.logger?.warn?.(`notify: could not run ${built.command}: ${code}`)
        }
        // The overlay is the richer style, so its failure is downgraded rather than dropped.
        if (style === 'overlay' && code === 'ENOENT') notifyWith(body, 'daemon')
      })
      child.unref()
    } catch (error) {
      const key = String(error?.code ?? error)
      if (reported.has(key)) return
      reported.add(key)
      ctx.logger?.warn?.(`notify: could not spawn ${built.command}: ${key}`)
    }
  }

  // ── the agent finished ────────────────────────────────────────────────────
  // `running -> idle` is the turn ending. The map is keyed by the agent the event names, so
  // two sessions running at once are timed independently and neither one's finish announces
  // the other's.
  if (onFinish) {
    ctx.effect(() => ctx.on('agent/status', (payload) => {
      const id = payload?.agent?.id
      if (typeof id !== 'string' || id.length === 0) return
      const status = payload?.status
      const previous = runningSince.get(id)
      if (status === 'running') {
        if (previous === undefined) runningSince.set(id, Date.now())
        return
      }
      if (status === 'idle') {
        runningSince.delete(id)
        if (shouldNotify({ from: 'running', to: 'idle', startedAt: previous, now: Date.now(), minRunMs })) {
          // Which session, first: "Finished after 93s" says nothing about WHICH chat wants you
          // the moment two are open, and the session is the only part that answers that.
          notify(sessionMessage(sessionLabel(payload?.agent), `Finished after ${Math.round((Date.now() - previous) / 1000)}s`))
        }
      }
    }))
  }

  // ── the agent asked the user something ────────────────────────────────────
  // A waterfall listener: it MUST pass the call on, and it does so whatever happens above,
  // because failing to notify is a missing popup while failing to call `next()` would be a
  // question the user never sees.
  if (onQuestion) {
    ctx.effect(() => ctx.on('user-questions/request', async (request, next) => {
      try {
        const summary = questionSummary(request)
        notify(sessionMessage(sessionLabel(request?.agent), summary === '' ? 'is waiting for your answer' : `asks: ${summary}`))
      } catch {
        // Never let the notification path affect the question itself.
      }
      return next()
    }))
  }

  if (enabled && family === 'linux' && typeof display === 'string') {
    ctx.logger?.info?.(`notify: overlay display ${display}${process.env.DISPLAY !== display ? ` (inherited DISPLAY=${process.env.DISPLAY ?? 'unset'})` : ''}`)
  }
  if (!enabled) {
    ctx.logger?.info?.('notify: disabled by configuration or DSH_NOTIFY_DISABLED')
  } else if (family === null) {
    ctx.logger?.info?.(`notify: no notifier implemented for ${process.platform}; the plugin is inert`)
  }
}
