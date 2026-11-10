# @cc/dsh-project-rules — one cached rules section, edited from the client

`.dsh/rules.md` (gitignored) becomes ONE system-prompt section, `project:rules`, on every
agent and subagent in the workspace. The **Rules** sidebar panel edits that file through the
`/project-rules` host command.

## Who may change it: the human, nobody else

Every agent READS the file through the prompt section. No agent may WRITE it:

- a `tools/pre-execute` guard refuses `write` and `edit` when the resolved `file_path` is the
  rules file (`./.dsh/rules.md`, `.dsh/../.dsh/rules.md` and an absolute path are the same
  file), with the code **`rules_human_only`**;
- the same guard refuses a `bash`/`pwsh` command whose text names the rules path or the
  `.dsh/rules` prefix, with the same code;
- nothing else is refused.

The human's Save is a COMMAND (`/project-rules`), not a tool, so the guard never sees it and
the panel keeps the pen.

**This is a guardrail, not a jail.** A command is a string, so a path assembled from a
variable, split across arguments, reached through a symlink or written by another program is
outside what this guard can see. It makes the boundary explicit and stops the ordinary
attempt; the human's review is what makes the boundary true. If you need a real jail for an
agent, take the shell away from that role's preset (the research and orchestrator presets have
no `write`/`edit`/`bash` at all) or wait for the sandbox work.

## The cache contract

- Typing is local React state; nothing reaches the host until **Save**.
- Save writes the file atomically and returns `{ok, bytes}`. It does **not** touch the
  in-memory section.
- The section text is a per-agent frozen string. It re-reads the file only at that agent's
  own `turn/start`. If the bytes are unchanged it **keeps the previous string**.
- An empty file renders no section (the prompt renderer drops empty sections).
- The section carries no timestamp, size, hash, counter or turn number: its text is the
  file's text, byte for byte.

Measured on a real session: see the report the task produced; `system/message` events
(the harness's system re-render points) appear once when the prompt first changes and once
after a saved edit, never per step and never on a mid-turn save.

## API

- `/project-rules {"op":"read"}` → `{ok, text, bytes, path}`
- `/project-rules {"op":"save","text":"…"}` → `{ok, bytes, path}` (exactly the text given,
  capped at 32 KB; invalid UTF-8 is refused on read)

## Files

- `index.js` — section registration (`agent/created`, both root and child), per-agent
  freeze, atomic read/write, command.
- `client.js` — the panel (`main` page + `sidebar.panellist` entry), `workspaceFiles` read,
  command save, dirty/byte state.
