/**
 * PURPOSE
 *   The host row of the Project state panel. The panel is a read-only LENS over files the
 *   state core already writes: this row owns no file, no tool and no command. It exists so
 *   the profile can mount the client half (the loader discovers a client bundle through the
 *   package's `dsh.client` declaration, and a client bundle needs an active loader row).
 *
 * WHAT IT DOES
 *   No `tools` injection, no `provide`, no `inject`: nothing in the agent's turn changes
 *   because this panel is mounted. The four modes read `state/views/index.json` plus the
 *   entity frontmatter through the read-only workspaceFiles API of the browser session, and
 *   the design map mode calls designmap's read-only `views` command. The one write the owner
 *   gets is the task status: the panel sends the taskboard's `owner-status` op through the
 *   command Remote, and the board owns that write (it mirrors the TASK, regenerates the
 *   projections and records the override in the state journal). The panel writes no file.
 */

export const name = '@cc/dsh-project-state-panel'
export const inject = []

/** Nothing to start: the client half is the whole plugin. */
export function apply() {}

export default { name, inject, apply }
