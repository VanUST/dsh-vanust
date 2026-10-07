# @cc/dsh-notify — desktop notifications for agent events

Tells a human who walked away that the agent **finished** or is **asking them something**.

| Platform | Mechanism | Notes |
|---|---|---|
| Linux | `notify-send` (libnotify) | path overridable with `notifySendPath` |
| Windows | WinRT toast via `powershell.exe -NoProfile -NonInteractive -Command …` | falls back to a tray balloon when WinRT is unavailable; text arrives in environment variables and is XML-escaped in-script |
| macOS | `osascript -e 'display notification …'` | AppleScript string escaping, one argv element |

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
        # notifySendPath: /usr/bin/notify-send
        # powershellPath: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
```

Silence it without editing the profile: `DSH_NOTIFY_DISABLED=1`, or raise the threshold with `DSH_NOTIFY_MIN_RUN_MS`.

## What it will not do

- **No shell.** Every argument is an argv element of a direct spawn; the text travels in environment variables on Windows. A question containing `"`, `'`, `;` or `$(…)` is text, not syntax.
- **No blocking.** The notifier is spawned detached, with `stdio: 'ignore'`, and unref'd. Nothing waits for it.
- **No failure path into the agent.** A missing `notify-send`, a hanging daemon or a throwing listener costs the popup and nothing else. The question listener always calls `next()`.
- **No prompt cost.** No tools, no system-prompt section, no service.
