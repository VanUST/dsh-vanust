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
/**
 * The fixed geometry every overlay uses, so several notifications cannot overlap.
 *
 * A notification is one process per popup, and processes cannot see each other, so the rule
 * that keeps them apart has to be agreed in advance rather than negotiated live: the same
 * width, the same height and the same vertical pitch, with the slot index choosing the row.
 * Fixed geometry is what makes "no overlap" a property of the design instead of a hope.
 */
export const OVERLAY_WIDTH = 360
export const OVERLAY_HEIGHT = 96
export const OVERLAY_PITCH = 104
export const OVERLAY_MARGIN = 24
/** How many popups may stack before the last row is reused. */
export const OVERLAY_MAX_SLOTS = 8
/** A claim older than this is treated as abandoned (its process died without releasing). */
export const SLOT_STALE_SECONDS = 45

/**
 * The lowest stack slot nobody holds, or null when every slot is taken.
 *
 * Pure, and the Python and PowerShell overlays implement the same rule: a claim is a file
 * created exclusively (`O_CREAT|O_EXCL` / `FileMode.CreateNew`), so two processes racing for
 * the same row cannot both win. Stale claims are pruned by the caller before this is asked.
 *
 * @param occupied - Slot indices currently claimed.
 * @returns The lowest free index below {@link OVERLAY_MAX_SLOTS}, or null.
 */
export function firstFreeSlot(occupied = []) {
  const taken = new Set(occupied)
  for (let slot = 0; slot < OVERLAY_MAX_SLOTS; slot += 1) {
    if (!taken.has(slot)) return slot
  }
  return null
}

/**
 * The Linux/macOS overlay: a borderless, ALWAYS-ON-TOP window pinned to the top-right.
 *
 * `notify-send` cannot do any of the three things this was asked for: the desktop daemon decides
 * where a notification appears, a notification is not a window (so a fullscreen app, a focused
 * window or Do-Not-Disturb can hide it), and it has no close button. This is a real window with
 * `-topmost`, positioned from the screen's own width, with:
 *
 *   - a ✕ that dismisses it immediately,
 *   - a title and body that OPEN the given URL and dismiss (the running GUI, same server),
 *   - a hover PAUSE, so a notification being read does not vanish,
 *   - a stack slot, claimed atomically, so simultaneous notifications line up instead of
 *     drawing on top of one another.
 *
 * Tkinter is in the Python standard library; every piece of text arrives in the environment, so
 * a question full of quotes is data rather than script.
 */
export const OVERLAY_PYTHON_SCRIPT = [
  'import os, glob, time',
  'import tkinter as tk',
  "title = os.environ.get('DSH_NOTIFY_TITLE', '')",
  "body = os.environ.get('DSH_NOTIFY_BODY', '')",
  "url = os.environ.get('DSH_NOTIFY_URL', '')",
  "dismiss = int(os.environ.get('DSH_NOTIFY_MS', '6000') or 6000)",
  "slots_dir = os.environ.get('DSH_NOTIFY_SLOTS', '')",
  'WIDTH = 360',
  'HEIGHT = 96',
  'PITCH = 104',
  'MARGIN = 24',
  'MAX_SLOTS = 8',
  'STALE = 45',
  'claim = None',
  'slot = 0',
  'if slots_dir:',
  '    try:',
  '        os.makedirs(slots_dir, exist_ok=True)',
  '        now = time.time()',
  '        for old in glob.glob(os.path.join(slots_dir, "slot-*")):',
  '            try:',
  '                if now - os.path.getmtime(old) > STALE:',
  '                    os.remove(old)',
  '            except OSError:',
  '                pass',
  '        for candidate in range(MAX_SLOTS):',
  '            path = os.path.join(slots_dir, "slot-%d" % candidate)',
  '            try:',
  '                handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)',
  '                os.close(handle)',
  '                claim = path',
  '                slot = candidate',
  '                break',
  '            except OSError:',
  '                continue',
  '    except OSError:',
  '        claim = None',
  'bg = "#12161f"',
  'fg = "#eaeef7"',
  'dim = "#8f9bb3"',
  'accent = "#5aa9ff"',
  'root = tk.Tk()',
  'root.overrideredirect(True)',
  "root.attributes('-topmost', True)",
  'try:',
  "    root.attributes('-alpha', 0.98)",
  'except Exception:',
  '    pass',
  'def release():',
  '    if claim:',
  '        try:',
  '            os.remove(claim)',
  '        except OSError:',
  '            pass',
  'shell = tk.Frame(root, bg=fg, highlightthickness=0)',
  'shell.pack(fill="both", expand=True)',
  'stripe = tk.Frame(shell, bg=accent, width=4)',
  'stripe.pack(side="left", fill="y")',
  'inner = tk.Frame(shell, bg=bg, padx=12, pady=9)',
  'inner.pack(side="left", fill="both", expand=True)',
  'top = tk.Frame(inner, bg=bg)',
  'top.pack(fill="x")',
  "tk.Label(top, text=title, fg=accent, bg=bg, font=('DejaVu Sans', 10, 'bold'), anchor='w').pack(side='left')",
  "close = tk.Label(top, text='\u2715', fg=dim, bg=bg, font=('DejaVu Sans', 12), cursor='hand2')",
  "close.pack(side='right')",
  "body_label = tk.Label(inner, text=body, fg=fg, bg=bg, font=('DejaVu Sans', 9), anchor='w', justify='left', wraplength=WIDTH - 48)",
  'body_label.pack(fill="x")',
  'root.update_idletasks()',
  'screen = root.winfo_screenwidth()',
  "root.geometry('%dx%d+%d+%d' % (WIDTH, HEIGHT, screen - WIDTH - MARGIN, MARGIN + slot * PITCH))",
  'def close_now(*_ignored):',
  '    release()',
  '    root.destroy()',
  'def open_now(*_ignored):',
  '    release()',
  '    if url:',
  '        try:',
  '            import webbrowser',
  '            if not webbrowser.open(url):',
  '                raise RuntimeError("no browser")',
  '        except Exception:',
  '            try:',
  '                import subprocess',
  '                subprocess.Popen(["xdg-open", url])',
  '            except Exception:',
  '                pass',
  '    root.destroy()',
  'timer = {}',
  'def arm():',
  '    timer["id"] = root.after(dismiss, close_now)',
  'def pause(*_ignored):',
  '    if "id" in timer:',
  '        root.after_cancel(timer["id"])',
  '        del timer["id"]',
  'def resume(*_ignored):',
  '    pause()',
  '    arm()',
  "close.bind('<Button-1>', close_now)",
  "top.bind('<Button-1>', open_now)",
  "body_label.bind('<Button-1>', open_now)",
  "inner.bind('<Button-1>', open_now)",
  'for widget in (inner, top, body_label):',
  "    widget.bind('<Enter>', pause)",
  "    widget.bind('<Leave>', resume)",
  'try:',
  "    root.bind('<Escape>', close_now)",
  'except Exception:',
  '    pass',
  'arm()',
  'root.mainloop()',
].join('\n')

/**
 * The Windows overlay: a borderless TopMost WinForms window in the primary screen's
 * top-right corner. A toast is placed by the OS (bottom-right by default) and Focus Assist
 * can suppress it, which is the opposite of "visible anywhere"; a TopMost window is not.
 * The text arrives in `$env:`, so no quoting question arises.
 */
/**
 * The Windows overlay: the same window as the Linux one, in WinForms.
 *
 * A borderless `TopMost` form in the primary screen's top-right, anchored to
 * `WorkingArea.Right`, with the same ✕, the same click-to-open, the same hover pause and the
 * same fixed geometry so stacked notifications line up. `ShowInTaskbar = $false` keeps it out
 * of the taskbar list, `AutoScaleMode = Dpi` keeps a 360x96 window 360x96 on a scaled display,
 * and everything the human reads arrives in `$env:`, so no quoting question arises.
 */
export const WINDOWS_OVERLAY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  '$width = 360',
  '$height = 96',
  '$pitch = 104',
  '$margin = 24',
  '$maxSlots = 8',
  '$stale = 45',
  '$slot = 0',
  '$claim = $null',
  'if ($env:DSH_NOTIFY_SLOTS) {',
  '  New-Item -ItemType Directory -Force -Path $env:DSH_NOTIFY_SLOTS | Out-Null',
  '  Get-ChildItem -Path $env:DSH_NOTIFY_SLOTS -Filter "slot-*" -ErrorAction SilentlyContinue | Where-Object { ((Get-Date) - $_.LastWriteTime).TotalSeconds -gt $stale } | Remove-Item -Force -ErrorAction SilentlyContinue',
  '  foreach ($candidate in 0..($maxSlots - 1)) {',
  '    $path = Join-Path $env:DSH_NOTIFY_SLOTS ("slot-" + $candidate)',
  '    try {',
  '      $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)',
  '      $stream.Close()',
  '      $claim = $path',
  '      $slot = $candidate',
  '      break',
  '    } catch { }',
  '  }',
  '}',
  '$form = New-Object System.Windows.Forms.Form',
  "$form.FormBorderStyle = 'None'",
  "$form.StartPosition = 'Manual'",
  "$form.AutoScaleMode = 'Dpi'",
  '$form.TopMost = $true',
  '$form.ShowInTaskbar = $false',
  '$form.BackColor = [System.Drawing.Color]::FromArgb(18, 22, 31)',
  '$form.Size = New-Object System.Drawing.Size($width, $height)',
  '$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea',
  '$form.Location = New-Object System.Drawing.Point(($area.Right - $width - $margin), ($area.Top + $margin + ($slot * $pitch)))',
  '$stripe = New-Object System.Windows.Forms.Panel',
  '$stripe.BackColor = [System.Drawing.Color]::FromArgb(90, 169, 255)',
  '$stripe.Location = New-Object System.Drawing.Point(0, 0)',
  '$stripe.Size = New-Object System.Drawing.Size(4, $height)',
  '$title = New-Object System.Windows.Forms.Label',
  '$title.Text = $env:DSH_NOTIFY_TITLE',
  '$title.ForeColor = [System.Drawing.Color]::FromArgb(90, 169, 255)',
  '$title.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)',
  '$title.Location = New-Object System.Drawing.Point(14, 10)',
  '$title.Size = New-Object System.Drawing.Size(286, 20)',
  '$close = New-Object System.Windows.Forms.Label',
  '$close.Text = [char]0x2715',
  '$close.ForeColor = [System.Drawing.Color]::FromArgb(143, 155, 179)',
  '$close.Font = New-Object System.Drawing.Font("Segoe UI", 11)',
  '$close.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter',
  '$close.Cursor = [System.Windows.Forms.Cursors]::Hand',
  '$close.Location = New-Object System.Drawing.Point(320, 6)',
  '$close.Size = New-Object System.Drawing.Size(30, 26)',
  '$body = New-Object System.Windows.Forms.Label',
  '$body.Text = $env:DSH_NOTIFY_BODY',
  '$body.ForeColor = [System.Drawing.Color]::FromArgb(234, 238, 247)',
  '$body.Font = New-Object System.Drawing.Font("Segoe UI", 9)',
  '$body.Location = New-Object System.Drawing.Point(14, 34)',
  '$body.Size = New-Object System.Drawing.Size(332, 54)',
  '$form.Controls.AddRange(@($stripe, $title, $body, $close))',
  '$timer = New-Object System.Windows.Forms.Timer',
  '$timer.Interval = [int]$env:DSH_NOTIFY_MS',
  '$timer.Add_Tick({ if ($claim) { Remove-Item -Force -ErrorAction SilentlyContinue $claim }; $form.Close() })',
  '$openHandler = {',
  '  if ($claim) { Remove-Item -Force -ErrorAction SilentlyContinue $claim }',
  '  if ($env:DSH_NOTIFY_URL) { Start-Process $env:DSH_NOTIFY_URL -ErrorAction SilentlyContinue }',
  '  $form.Close()',
  '}',
  '$closeHandler = { if ($claim) { Remove-Item -Force -ErrorAction SilentlyContinue $claim }; $form.Close() }',
  '$pauseHandler = { $timer.Stop() }',
  '$resumeHandler = { $timer.Start() }',
  '$close.Add_Click($closeHandler)',
  '$title.Add_Click($openHandler)',
  '$body.Add_Click($openHandler)',
  'foreach ($control in @($form, $title, $body)) { $control.Add_MouseEnter($pauseHandler); $control.Add_MouseLeave($resumeHandler) }',
  '$form.Add_FormClosed({ if ($claim) { Remove-Item -Force -ErrorAction SilentlyContinue $claim } })',
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
 * Which session a notification is about, in one line.
 *
 * Without this a popup says only "Finished after 93s", which is useless the moment two chats
 * are open: the human cannot tell WHICH one wants them. The label is built from the two fields
 * the harness itself uses for session identity - `agent.session.header.cwd` (26 uses inside the
 * harness) and `agent.session.id` (24) - so it needs no service and no guess:
 *
 *     dsh-kit - #5fbab0a6          project and the short session id
 *     dsh-kit - Into the Unknown   when the header happens to carry a title
 *     #5fbab0a6                    no cwd to name
 *     dsh-kit                      no id to quote
 *     ''                           neither, so the caller omits the separator
 *
 * Everything is read defensively and nothing is invented: a field that moved yields a shorter
 * label rather than a wrong one, and a notification is never worth a thrown error.
 *
 * @param agent - The `agent` from an `agent/status` or `user-questions/request` payload.
 * @returns A non-empty label, or '' when the agent carries no usable identity.
 */
export function sessionLabel(agent) {
  let cwd = ''
  let id = ''
  let title = ''
  try {
    cwd = typeof agent?.session?.header?.cwd === 'string' ? agent.session.header.cwd : ''
    const rawId = agent?.session?.id ?? agent?.session?.header?.id
    id = typeof rawId === 'string' ? rawId : ''
    title = typeof agent?.session?.header?.title === 'string' ? agent.session.header.title : ''
  } catch {
    return ''
  }
  const project = cwd.split(/[\\/]+/).filter((part) => part !== '').pop() ?? ''
  const short = id.replace(/^session[-_]/, '').slice(0, 8)
  const name = title.trim() === '' ? (short === '' ? '' : `#${short}`) : title.trim()
  return [project, name].filter((part) => part !== '').join(' - ')
}

/**
 * Prefix a message with the session it came from, or leave it alone.
 *
 * The session goes FIRST, because that is the part a human scans for when several chats are
 * open; the label is dropped entirely rather than joined with a separator when there is none.
 *
 * @param label - {@link sessionLabel}'s output, possibly ''.
 * @param message - What happened, without the session.
 * @returns `label - message`, or just the message.
 */
export function sessionMessage(label, message) {
  const text = typeof message === 'string' ? message : ''
  return typeof label === 'string' && label !== '' ? `${label} - ${text}` : text
}

/** The maximum characters a session label may contribute. */
export const MAX_LABEL_CHARS = 60

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
 * @param input - `{ platform, style, title, body, url, slotsDir, dismissMs, pythonPath,
 *   notifySendPath, powershellPath, appId }`. The path overrides exist because a plugin cannot
 *   assume where a launcher lives; they are the only absolute paths this function will ever use,
 *   and they come from the caller's configuration. `style` is `overlay` (a borderless
 *   always-on-top window in the top-right corner) or `daemon` (the platform's own notification
 *   mechanism); macOS has no positioned overlay through `osascript`, so it falls back to
 *   `daemon` there and says so. `url` is what a click on the notification opens - the RUNNING
 *   GUI, so no second server is started - and `slotsDir` is where concurrent notifications
 *   claim a stack row so they cannot overlap.
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
  const url = typeof input.url === 'string' ? input.url : ''
  const slotsDir = typeof input.slotsDir === 'string' ? input.slotsDir : ''
  const overlayEnv = {
    DSH_NOTIFY_TITLE: title,
    DSH_NOTIFY_BODY: body,
    DSH_NOTIFY_MS: String(dismissMs),
    DSH_NOTIFY_URL: url,
    DSH_NOTIFY_SLOTS: slotsDir,
  }
  if (overlay && family === 'windows') {
    return {
      command: typeof input.powershellPath === 'string' && input.powershellPath !== '' ? input.powershellPath : 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_OVERLAY_SCRIPT],
      env: overlayEnv,
    }
  }
  if (overlay && family === 'linux') {
    return {
      command: typeof input.pythonPath === 'string' && input.pythonPath !== '' ? input.pythonPath : 'python3',
      args: ['-c', OVERLAY_PYTHON_SCRIPT],
      env: overlayEnv,
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
