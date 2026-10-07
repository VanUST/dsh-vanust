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

import { APP_NAME, DEFAULT_DISMISS_MS, notificationCommand, platformFamily, questionSummary, shouldNotify } from './notify-core.mjs'

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
  const family = platformFamily(process.platform)
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
          notify(`Finished after ${Math.round((Date.now() - previous) / 1000)}s`)
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
        notify(summary === '' ? 'The agent is waiting for your answer' : `Question: ${summary}`)
      } catch {
        // Never let the notification path affect the question itself.
      }
      return next()
    }))
  }

  if (!enabled) {
    ctx.logger?.info?.('notify: disabled by configuration or DSH_NOTIFY_DISABLED')
  } else if (family === null) {
    ctx.logger?.info?.(`notify: no notifier implemented for ${process.platform}; the plugin is inert`)
  }
}
