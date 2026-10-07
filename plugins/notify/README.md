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

### What the window does

| | |
|---|---|
| **✕** (top-right, or `Esc`) | dismisses that notification immediately |
| **click the title or body** | opens `url` in the default browser and dismisses |
| **hover** | PAUSES the auto-dismiss, so one you are reading does not vanish mid-sentence |
| **several at once** | each claims the lowest free STACK ROW and lines up below the others |

### One shape for every notification

Four principles, and every popup obeys all four - a finish, a question, or the self-test:

1. **The source comes first.** The body always begins with the label of what is speaking: the
   session (`dsh-kit - #5fbab0a6`) or `self-test`. A notification that does not say who it is
   from is the thing being fixed here.
2. **There is always a ✕.** Every overlay carries it; `Esc` does the same thing.
3. **It is always in the same place** - top-right, above other windows, at a fixed size - so a
   notification never has to be hunted for.
4. **Concurrency is always resolved the same way**: the lowest free stack row, claimed
   atomically, so simultaneous popups line up instead of overlapping.

The only permitted difference is the **degraded mode**: on a box with no `python3`/Tkinter/
`DISPLAY`, or on macOS where `osascript` cannot position a window, the platform's own
notification mechanism is used instead (`notify-send`, a WinRT toast, `display notification`).
Principles 1 and the text are identical there - it is the same message in the desktop's frame -
while 2-4 are impossible for a daemon to honour, which is why that path is a fallback and is
logged as one rather than being a second style offered as a choice.

### Which session it is about

A popup that says only "Finished after 93s" is useless the moment two chats are open, so the
session comes first:

```
dsh-kit - #5fbab0a6 - Finished after 93s
dsh-kit - #5fbab0a6 - asks: which database should the migration target?
```

The label is `project - #shortid`, built from the two fields the harness's own code uses for
session identity (`agent.session.header.cwd`, `agent.session.id`), read defensively: a missing
`cwd` leaves the id, a missing id leaves the project, and neither leaves the message alone. If
the header ever carries a `title`, that replaces the short id - `dsh-kit - Into the Unknown`.
It is not read from the session-title service, because that would add a dependency to the
notification path for cosmetics.

The row is **claimed, not negotiated**: each process creates `slot-<n>` exclusively
(`O_CREAT|O_EXCL`, `FileMode::CreateNew`) in `slotsDir` and removes it when it closes, so two
notifications racing for the same row cannot both win. All three geometries are fixed — 360x96
at a 104px pitch, 24px from the edge — which is what makes "no overlap" a property of the design
rather than a hope. A claim older than 45s (its process died without cleaning up) is pruned by
the next notification, so a killed popup cannot hold a row for ever. The stack is 8 rows deep;
beyond that a notification reuses row 8 rather than drawing off-screen.

`url` is what a click opens, and it defaults to **this** harness's own Web address, so a click
reuses the running `dsh web` instead of starting a second one. **What it does not do:** it does
not select the session the notification is about. The Web client has no session deep-link
(`searchParams` is only read for `parent` and `mode`) and no client API for activating a session
could be verified, so the click takes you to the running GUI — where, for a "finished" popup,
the chat you were just in is already the one on screen. Setting `url:` (or `DSH_NOTIFY_URL`)
overrides it entirely.

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
