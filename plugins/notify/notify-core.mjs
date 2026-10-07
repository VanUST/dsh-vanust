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
 *   `notificationCommand` with `style: 'overlay'` (the default) -> an always-on-top window in
 *     the top-right corner; `style: 'daemon'` -> the platform's own notification.
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

/** How long an overlay window stays on screen, in milliseconds. */
export const DEFAULT_DISMISS_MS = 6000

/**
 * The Linux/macOS overlay: a borderless, ALWAYS-ON-TOP window pinned to the top-right.
 *
 * `notify-send` cannot do either of the two things this was asked for: the desktop daemon
 * decides where a notification appears, and a notification is not a window, so a fullscreen
 * app, a focused window or Do-Not-Disturb can hide it. This is a real window with
 * `-topmost`, positioned from the screen's own width, so it is visible above whatever has
 * focus and always in the same corner. Tkinter is in the Python standard library and
 * present on this machine; the text arrives in the environment, so a question full of
 * quotes is data rather than script.
 */
export const OVERLAY_PYTHON_SCRIPT = [
  'import os, tkinter as tk',
  "title = os.environ.get('DSH_NOTIFY_TITLE', '')",
  "body = os.environ.get('DSH_NOTIFY_BODY', '')",
  "dismiss = int(os.environ.get('DSH_NOTIFY_MS', '6000') or 6000)",
  "bg = '#1f2430'",
  'root = tk.Tk()',
  'root.overrideredirect(True)',
  "root.attributes('-topmost', True)",
  'try:',
  "    root.attributes('-alpha', 0.97)",
  'except Exception:',
  '    pass',
  "frame = tk.Frame(root, bg=bg, padx=14, pady=10, highlightthickness=1, highlightbackground='#3b4252')",
  "tk.Label(frame, text=title, fg='#9dc4ff', bg=bg, font=('DejaVu Sans', 10, 'bold'), anchor='w', justify='left').pack(fill='x')",
  "tk.Label(frame, text=body, fg='#e8e8e8', bg=bg, font=('DejaVu Sans', 9), anchor='w', justify='left', wraplength=340).pack(fill='x')",
  'frame.pack(fill="both", expand=True)',
  'root.update_idletasks()',
  'width = max(340, root.winfo_reqwidth())',
  'height = root.winfo_reqheight()',
  'screen = root.winfo_screenwidth()',
  "root.geometry('%dx%d+%d+%d' % (width, height, screen - width - 24, 24))",
  'root.after(dismiss, root.destroy)',
  'root.mainloop()',
].join('\n')

/**
 * The Windows overlay: a borderless TopMost WinForms window in the primary screen's
 * top-right corner. A toast is placed by the OS (bottom-right by default) and Focus Assist
 * can suppress it, which is the opposite of "visible anywhere"; a TopMost window is not.
 * The text arrives in `$env:`, so no quoting question arises.
 */
export const WINDOWS_OVERLAY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  '$form = New-Object System.Windows.Forms.Form',
  "$form.FormBorderStyle = 'None'",
  "$form.StartPosition = 'Manual'",
  '$form.TopMost = $true',
  '$form.ShowInTaskbar = $false',
  '$form.BackColor = [System.Drawing.Color]::FromArgb(31, 36, 48)',
  '$form.Size = New-Object System.Drawing.Size(400, 120)',
  '$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea',
  '$form.Location = New-Object System.Drawing.Point(($area.Right - $form.Width - 24), ($area.Top + 24))',
  '$title = New-Object System.Windows.Forms.Label',
  '$title.Text = $env:DSH_NOTIFY_TITLE',
  '$title.ForeColor = [System.Drawing.Color]::FromArgb(157, 196, 255)',
  '$title.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)',
  '$title.Location = New-Object System.Drawing.Point(14, 12)',
  '$title.Size = New-Object System.Drawing.Size(372, 24)',
  '$body = New-Object System.Windows.Forms.Label',
  '$body.Text = $env:DSH_NOTIFY_BODY',
  '$body.ForeColor = [System.Drawing.Color]::FromArgb(232, 232, 232)',
  '$body.Font = New-Object System.Drawing.Font("Segoe UI", 9)',
  '$body.Location = New-Object System.Drawing.Point(14, 40)',
  '$body.Size = New-Object System.Drawing.Size(372, 68)',
  '$form.Controls.AddRange(@($title, $body))',
  '$timer = New-Object System.Windows.Forms.Timer',
  '$timer.Interval = [int]$env:DSH_NOTIFY_MS',
  '$timer.Add_Tick({ $form.Close() })',
  '$timer.Start()',
  '[void]$form.ShowDialog()',
].join('\n')

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
 * Choose the X display an overlay should draw on.
 *
 * A harness server commonly inherits a VIRTUAL display: on the machine this was written for,
 * the desktop runs on `:1` (gnome-shell) while the server's environment says `:99` (Xvfb,
 * 1920x1080, nobody watching). Drawing there raises the notification correctly and shows it
 * to no one - the failure mode this function exists to prevent. So a display that is known
 * to be virtual is not accepted as `current`; the lowest-numbered real socket wins, and the
 * caller's own value is the last resort rather than the first choice.
 *
 * Pure on purpose: the caller supplies the sockets and the virtual list, so the rule can be
 * tested without an X server and without scanning `/proc`.
 *
 * @param input - `{ current, nodes, virtual }`. `nodes` are display names like `:0`; `virtual`
 *   is the subset of them known to be virtual.
 * @returns A display name, or null when there is nothing to choose from.
 */
export function chooseDisplay(input = {}) {
  const current = typeof input.current === 'string' && input.current.trim() !== '' ? input.current : null
  const virtual = Array.isArray(input.virtual) ? input.virtual : []
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  if (current !== null && !virtual.includes(current)) return current
  const real = nodes
    .filter((node) => typeof node === 'string' && !virtual.includes(node))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  if (real.length > 0) return real[0]
  return current ?? (nodes.length > 0 ? nodes[0] : null)
}

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
 * @param input - `{ platform, style, title, body, dismissMs, pythonPath, notifySendPath,
 *   powershellPath, appId }`. The path overrides exist because a plugin cannot assume where a
 *   launcher lives; they are the only absolute paths this function will ever use, and they come
 *   from the caller's configuration. `style` is `overlay` (a borderless always-on-top window in
 *   the top-right corner) or `daemon` (the platform's own notification mechanism); macOS has no
 *   positioned overlay through `osascript`, so it falls back to `daemon` there and says so.
 * @returns `{ command, args, env }` to spawn with `shell: false`, or null on a platform with no
 *   notifier. `env` carries the TEXT - always, because the text is never interpolated into a
 *   command string - and is meant to be merged over the process environment.
 */
export function notificationCommand(input = {}) {
  const family = platformFamily(input.platform)
  const title = collapse(input.title ?? APP_NAME, 120)
  const body = collapse(input.body ?? '', MAX_BODY_CHARS)
  const dismissMs = Number.isFinite(input.dismissMs) && input.dismissMs > 0 ? Math.floor(input.dismissMs) : DEFAULT_DISMISS_MS
  const overlay = input.style !== 'daemon'
  if (overlay && family === 'windows') {
    return {
      command: typeof input.powershellPath === 'string' && input.powershellPath !== '' ? input.powershellPath : 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_OVERLAY_SCRIPT],
      env: { DSH_NOTIFY_TITLE: title, DSH_NOTIFY_BODY: body, DSH_NOTIFY_MS: String(dismissMs) },
    }
  }
  if (overlay && family === 'linux') {
    return {
      command: typeof input.pythonPath === 'string' && input.pythonPath !== '' ? input.pythonPath : 'python3',
      args: ['-c', OVERLAY_PYTHON_SCRIPT],
      env: { DSH_NOTIFY_TITLE: title, DSH_NOTIFY_BODY: body, DSH_NOTIFY_MS: String(dismissMs) },
    }
  }
  if (family === 'windows') {
    // The DAEMON path (style: daemon, or a macOS overlay that has no positioned form).
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
