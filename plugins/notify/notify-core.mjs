/**
 * PURPOSE
 *   Decide WHEN to raise a desktop notification and build the exact command that raises it,
 *   for Linux and Windows (and macOS, which costs four lines more). The decision and the
 *   command are pure functions so both can be tested without a desktop, a shell or a
 *   notification daemon: the plugin that wires them to harness events contains no logic worth
 *   testing twice.
 *
 *   What this module refuses to do on purpose: it never builds a shell string. Every argument
 *   is passed as an argv element to a direct spawn, and the notification TEXT travels in
 *   environment variables, because a command line assembled from a model-authored summary is
 *   an injection waiting for a quote character.
 *
 * INPUTS
 *   `shouldNotify({ from, to, startedAt, now, minRunMs })` - two consecutive agent statuses.
 *   `notificationCommand({ platform, title, body })` - the platform to speak to.
 *   `questionSummary(request, max)` - a `user-questions/request` payload.
 *
 * OUTPUTS
 *   `shouldNotify` -> boolean. A turn that ran for less than `minRunMs` is not worth a popup.
 *   `notificationCommand` -> `{ command, args, env }`, or null on a platform with no notifier
 *     this deployment knows. `env` is merged ON TOP of the process environment by the caller.
 *   `questionSummary` -> a one-line string, whitespace-collapsed and truncated; never throws,
 *     including for a payload with no questions at all.
 *
 * KEYWORDS
 *   notification, notify-send, toast, powershell, desktop, turn finished, user question,
 *   cross-platform, argv-not-shell
 *
 * BEHAVIOUR ON EDGE CASES
 *   - `startedAt` unknown (a status seen without the other one): the finish is not announced,
 *     because a popup saying "finished" for a turn nobody saw start is noise.
 *   - `now < startedAt` (a clock step): treated as a zero-length run and suppressed.
 *   - `minRunMs` absent or negative: treated as 0, so every finished turn notifies.
 *   - Notification text: truncated at 200 characters AFTER whitespace is collapsed, so a
 *     multi-line question cannot arrive as a wall of text.
 *   - Windows: if the WinRT toast calls are unavailable (an old PowerShell), the script falls
 *     back to a tray balloon, so the notification is not silently lost.
 *   - `notify-send` missing on the host: the caller's spawn fails and is swallowed; a machine
 *     with no notifier loses the popup, never a turn.
 */

/** The app name a Linux notification is attributed to, and the default title. */
export const APP_NAME = 'DeepSeek Harness'

/** Longest notification text this module will produce, after collapsing whitespace. */
export const MAX_BODY_CHARS = 200

/** The AppId a Windows toast is published under, so the OS has something to attribute it to. */
export const WINDOWS_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

/**
 * The PowerShell the Windows path runs.
 *
 * The notification text is NOT interpolated into this script: it arrives in
 * `DSH_NOTIFY_TITLE` / `DSH_NOTIFY_BODY` and is XML-escaped by .NET inside the script. A title
 * containing a quote or a `<` is therefore a title, not a syntax error and not an injection.
 * WinRT toasts are tried first; a machine whose PowerShell cannot load them falls back to a
 * tray balloon so the notification still arrives.
 */
export const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$title = [System.Security.SecurityElement]::Escape($env:DSH_NOTIFY_TITLE)',
  '$body = [System.Security.SecurityElement]::Escape($env:DSH_NOTIFY_BODY)',
  'try {',
  '  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
  '  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
  '  $xml.LoadXml("<toast><visual><binding template=\\"ToastGeneric\\"><text>$title</text><text>$body</text></binding></visual></toast>")',
  '  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
  '  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:DSH_NOTIFY_APPID).Show($toast)',
  '} catch {',
  '  Add-Type -AssemblyName System.Windows.Forms',
  '  $icon = New-Object System.Windows.Forms.NotifyIcon',
  '  $icon.Icon = [System.Drawing.SystemIcons]::Information',
  '  $icon.Visible = $true',
  '  $icon.ShowBalloonTip(5000, $env:DSH_NOTIFY_TITLE, $env:DSH_NOTIFY_BODY, [System.Windows.Forms.ToolTipIcon]::Info)',
  '  Start-Sleep -Seconds 6',
  '  $icon.Dispose()',
  '}',
].join('\n')

/**
 * Collapse whitespace and cut a string to a length a notification can display.
 *
 * @param text - Anything; a non-string is read as an empty string.
 * @param max - Maximum characters. Absent or non-finite: {@link MAX_BODY_CHARS}.
 * @returns A single-line string, at most `max` characters plus the ellipsis, never null.
 */
export function collapse(text, max = MAX_BODY_CHARS) {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_BODY_CHARS
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}

/**
 * Whether a finished turn deserves a popup.
 *
 * @param input - `{ from, to, startedAt, now, minRunMs }`. `from`/`to` are agent statuses;
 *   `startedAt` is when the agent entered `running`, in milliseconds.
 * @returns True only for a `running -> idle` transition whose run lasted at least `minRunMs`.
 */
export function shouldNotify(input = {}) {
  const { from, to, startedAt, now } = input
  if (from !== 'running' || to !== 'idle') return false
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return false
  const minRunMs = Number.isFinite(input.minRunMs) && input.minRunMs > 0 ? input.minRunMs : 0
  const ran = now - startedAt
  return ran >= minRunMs
}

/**
 * A one-line summary of what the agent is asking.
 *
 * @param request - A `user-questions/request` payload: `{ questions: [{ question, header }] }`.
 * @param max - Maximum characters, forwarded to {@link collapse}.
 * @returns The first question, preceded by its heading when there is one. Empty string when
 *   the payload carries no question, which the caller reads as "notify with a generic body".
 */
export function questionSummary(request, max = MAX_BODY_CHARS) {
  const questions = Array.isArray(request?.questions) ? request.questions : []
  const first = questions.find((item) => item !== null && typeof item === 'object')
  if (first === undefined) return ''
  const heading = typeof first.header === 'string' && first.header.trim() !== '' ? `${first.header.trim()}: ` : ''
  const question = typeof first.question === 'string' ? first.question : ''
  const suffix = questions.length > 1 ? ` (+${questions.length - 1} more)` : ''
  return collapse(`${heading}${question}${suffix}`, max)
}

/**
 * The platform family this module knows how to notify.
 *
 * @param platform - A `process.platform` value.
 * @returns `linux`, `windows`, `macos`, or null when nothing is known for it.
 */
export function platformFamily(platform) {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (typeof platform === 'string' && platform.length > 0) return 'linux'
  return null
}

/**
 * Build the command that raises one desktop notification.
 *
 * @param input - `{ platform, title, body, notifySendPath, powershellPath, appId }`. The path
 *   overrides exist because a plugin cannot assume where a launcher lives; they are the only
 *   absolute paths this function will ever use, and they come from the caller's configuration.
 * @returns `{ command, args, env }` to spawn with `shell: false`, or null on a platform with no
 *   notifier. `env` carries the TEXT on Windows and is empty elsewhere; it is meant to be
 *   merged over the process environment, so a missing PATH cannot make the spawn fail.
 */
export function notificationCommand(input = {}) {
  const family = platformFamily(input.platform)
  const title = collapse(input.title ?? APP_NAME, 120)
  const body = collapse(input.body ?? '', MAX_BODY_CHARS)
  if (family === 'windows') {
    return {
      command: typeof input.powershellPath === 'string' && input.powershellPath !== '' ? input.powershellPath : 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT],
      env: {
        DSH_NOTIFY_TITLE: title,
        DSH_NOTIFY_BODY: body,
        DSH_NOTIFY_APPID: typeof input.appId === 'string' && input.appId !== '' ? input.appId : WINDOWS_APP_ID,
      },
    }
  }
  if (family === 'macos') {
    // AppleScript string quoting: a backslash or a quote inside the text is escaped, and the
    // text never reaches a shell - `osascript -e` receives it as one argv element.
    const quoted = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    return {
      command: 'osascript',
      args: ['-e', `display notification ${quoted(body)} with title ${quoted(title)}`],
      env: {},
    }
  }
  if (family === 'linux') {
    return {
      command: typeof input.notifySendPath === 'string' && input.notifySendPath !== '' ? input.notifySendPath : 'notify-send',
      // `-a` attributes the popup to the app rather than to the launcher, `-u normal` keeps it
      // out of the "critical" style, and the two text arguments are argv elements: no shell,
      // so a quote in a question is a character rather than the end of a string.
      args: ['-a', APP_NAME, '-u', 'normal', title, body],
      env: {},
    }
  }
  return null
}
