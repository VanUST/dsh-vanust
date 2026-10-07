# @cc/dsh-notify — desktop notifications for agent events

Tells a human who walked away that the agent **finished** or is **asking them something**.

## Where it appears

**Top-right of the screen, always on top** — because `notify-send` cannot do either. The
desktop daemon decides where its own notification goes (GNOME puts it top-centre), and a
notification is not a window, so a focused window, a fullscreen app or Do-Not-Disturb can hide
it. The default `style: overlay` therefore spawns a real window:

| Platform | Overlay | Notes |
|---|---|---|
| Linux | a borderless Tk window, `-topmost`, geometry from `winfo_screenwidth` | python3 + Tkinter; text by environment, so a question full of quotes is data |
| Windows | a borderless WinForms form, `TopMost`, anchored to `Screen.PrimaryScreen.WorkingArea` | text by environment, no XML and no quoting to get wrong |
| macOS | **no overlay** — `osascript` cannot position a window | falls back to `display notification`, which is bottom-right and may be suppressed |

`style: daemon` uses the desktop mechanism instead (and is what macOS always gets):

| Platform | Mechanism | Notes |
|---|---|---|
| Linux | `notify-send` (libnotify) | path overridable with `notifySendPath` |
| Windows | WinRT toast via `powershell.exe -NoProfile -NonInteractive -Command …` | falls back to a tray balloon when WinRT is unavailable; text arrives in environment variables and is XML-escaped in-script |
| macOS | `osascript -e 'display notification …'` | AppleScript string escaping, one argv element |

### Which display it draws on

A notification is only visible to whoever is looking at the display the process draws on, and a
harness server often inherits a **virtual** one. Measured on the machine this was written for:
the desktop runs on `:1` (gnome-shell) while the server's environment says `:99` (Xvfb,
1920x1080, nobody watching) - so the overlay would have appeared correctly and to no one.

The plugin therefore refuses a display it can identify as Xvfb (`/proc` scan, bounded to one
`readdir` plus a `cmdline` read per pid) and prefers the lowest-numbered real socket. The choice
is logged once at activation:

```
notify: overlay display :1 (inherited DISPLAY=:99)
```

Override it with `display: ':1'` in the config, or `DSH_NOTIFY_DISPLAY=:1` in the server's
environment. If the GUI is opened in a browser on **another** machine, no server-side overlay can
reach that screen at all - only a browser-side notification could, which is a different mechanism
and is not implemented here.

If an overlay cannot start (`python3` missing, no `DISPLAY`, no Tkinter), the plugin
**downgrades to the daemon path** rather than losing the notification: you lose the corner and
the always-on-top, not the message.

## What triggers it

| Harness seam | Event | Fires when |
|---|---|---|
| turn ended | `agent/status` with `running → idle` | the agent stopped working, and the turn lasted at least `minRunMs` (default 15 s) |
| question asked | `user-questions/request` | the harness's ask-user path is about to wait for an answer — any caller, not one tool name |

The question listener announces **before** `next()`, so the popup arrives while you are being waited on, not after you have already answered.

## Configuration

```yaml
- insert:
    - id: notify
      name: '@cc/dsh-notify'
      config:
        minRunMs: 15000     # shortest turn worth a popup
        onFinish: true
        onQuestion: true
        title: DeepSeek Harness
        style: overlay      # overlay (top-right, always on top) | daemon
        # display: ':1'     # X display to draw on; defaults to a real socket, not an inherited Xvfb
        dismissMs: 6000     # how long an overlay stays on screen
        # pythonPath: /usr/bin/python3
        # notifySendPath: /usr/bin/notify-send
        # powershellPath: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
```

Silence it without editing the profile: `DSH_NOTIFY_DISABLED=1`, or raise the threshold with `DSH_NOTIFY_MIN_RUN_MS`.

## What it will not do

- **No shell.** Every argument is an argv element of a direct spawn; the text travels in environment variables on Windows. A question containing `"`, `'`, `;` or `$(…)` is text, not syntax.
- **No blocking.** The notifier is spawned detached, with `stdio: 'ignore'`, and unref'd. Nothing waits for it.
- **No failure path into the agent.** A missing `notify-send`, a hanging daemon or a throwing listener costs the popup and nothing else. The question listener always calls `next()`.
- **No prompt cost.** No tools, no system-prompt section, no service.
