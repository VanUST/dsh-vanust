/**
 * PURPOSE
 *   Open a generated report in whatever the platform uses as its default browser,
 *   so `make usage` ends with the page on screen instead of a path to copy.
 *
 *   The opener differs per platform and each one has a trap: Linux has `xdg-open`
 *   but no such binary is guaranteed to be installed, macOS has `open`, and
 *   Windows has no `start` executable at all because `start` is a `cmd` builtin.
 *   Naming the command per platform here keeps that knowledge in one tested place
 *   rather than spreading a shell conditional through a build file.
 *
 * INPUTS
 *   `browserCommand(platform, path)` takes a `process.platform` string and an
 *   absolute path. `openInBrowser(path)` takes an absolute path and uses the
 *   running platform.
 *
 * OUTPUTS
 *   `browserCommand(platform, path)` → `{command, args}`, the argv to spawn.
 *   `openInBrowser(path)` → `{opened, command, guidance}`. `opened` is false and
 *   `guidance` names what to do by hand when the platform has no opener this
 *   function recognises or the spawn fails; the caller reports it and continues.
 *
 * KEYWORDS
 *   browser, xdg-open, open, start, platform, detached, report
 *
 * BEHAVIOUR ON EDGE CASES
 *   - An unrecognised platform yields `{command: null, args: []}`, so the caller
 *     prints the path instead of spawning something arbitrary.
 *   - The opener is spawned detached with its output ignored: a viewer that blocks
 *     or writes to stdout must not hold the analytics run open.
 *   - A spawn that fails to start (no `xdg-open` on a minimal Linux image) returns
 *     `opened: false` with the reason rather than throwing, because the report on
 *     disk is still correct and the caller can still tell the user where it is.
 */

import { spawn } from 'node:child_process'

/**
 * Choose the command that opens a path in the platform's default application.
 *
 * @param platform - A `process.platform` value (`linux`, `darwin`, `win32`, …).
 * @param path - Absolute path to open.
 * @returns `{command, args}`; `command` is `null` when the platform is unknown.
 */
export function browserCommand(platform, path) {
  if (platform === 'darwin') return { command: 'open', args: [path] }
  if (platform === 'win32') {
    // `start` is a cmd builtin, not an executable, and its first argument is the
    // window title: an empty title keeps a quoted path from being read as one.
    return { command: 'cmd', args: ['/c', 'start', '', path] }
  }
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd' || platform === 'sunos') {
    return { command: 'xdg-open', args: [path] }
  }
  return { command: null, args: [] }
}

/**
 * Open a path in the platform's default application, without blocking.
 *
 * @param path - Absolute path to open.
 * @returns `{opened, command, guidance}`; `opened` is false when nothing was
 *   spawned, and `guidance` is then a sentence naming the path to open by hand.
 */
export function openInBrowser(path) {
  const { command, args } = browserCommand(process.platform, path)
  if (command === null) {
    return {
      opened: false,
      command: null,
      guidance: `no browser opener is known for platform ${process.platform}; open ${path} by hand`,
    }
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return { opened: true, command, guidance: null }
  } catch (error) {
    return {
      opened: false,
      command,
      guidance: `could not run ${command} (${String(error?.message ?? error)}); open ${path} by hand`,
    }
  }
}
