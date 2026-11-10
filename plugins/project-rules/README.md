# @cc/dsh-project-rules — one cached rules section, edited from the client

`.dsh/rules.md` (gitignored) becomes ONE system-prompt section, `project:rules`, on every
agent and subagent in the workspace. The **Rules** sidebar panel edits that file through the
`/project-rules` host command.

## Who may change it: the human, nobody else

Every agent READS the file through the prompt section. No agent may WRITE it:

- a `tools/pre-execute` guard refuses `write` and `edit` when the REAL `file_path` is the
  rules file, with the code **`rules_human_only`**. "Real" means every component is followed
  with `lstat`/`readlink` before the comparison and a not-yet-existing target is resolved
  through its nearest existing ancestor, so all of these are refused:
  `./.dsh/rules.md`, `.dsh/../.dsh/rules.md`, `/ws/.dsh/../.dsh/rules.md`, an absolute path,
  `alias.md` where `alias.md -> .dsh/rules.md`, and a path under a symlinked parent directory.
  A hardlink is a second name for the same inode and is **not** detected: the guard compares
  paths, not inodes;
- the same guard refuses a `bash`/`pwsh` command whose text names the rules path or the
  `.dsh/rules` prefix, with the same code;
- nothing else is refused.

The human's Save is a COMMAND (`/project-rules`), not a tool, so the guard never sees it and
the panel keeps the pen.

**This is a guardrail, not a jail.** A command is a string, and a string match cannot follow a
path that is never spelled. Measured on 2026-11-10 (the delivery's adversarial test), these
shapes STILL WORK and are expected to:

| residual shape | why the guard cannot see it |
| --- | --- |
| `cd .dsh && printf x >> rules.md` | the command never contains `.dsh/rules` |
| a `bash` call with `workdir: ".dsh"` and `printf x >> rules.md` | `workdir` is not part of the command text |
| `p=$(printf LmRzaC9ydWxlcy5tZA== \| base64 -d); printf x >> "$p"` | a path built at run time |
| `printf x >> alias.md` where `alias.md` is a symlink to the rules file | the shell guard matches strings; only the `write`/`edit` half resolves symlinks |

What IS refused: a literal or `./`/`../`/absolute path in `write`/`edit` or in the command,
`tee`, `sed -i`, `node -e "<literal>"`, `cp`, `mv`, `rm`, `git checkout` on the path, a
variable whose ASSIGNMENT carries the literal, and `pwsh` with any of those. If you need a real
jail for an agent, take the shell away from that role's preset (the research and orchestrator
presets have no `write`/`edit`/`bash` at all) or wait for the sandbox work.

## A mangled file fails CLOSED

The section's renderer is on the prompt-assembly path, so it must not throw: one oversize or
invalid-UTF-8 `.dsh/rules.md` used to take the first turn of **every agent in the workspace**
down. Now a refused first read yields an **empty `project:rules` section** for that agent, logs
the reason once, and leaves the state re-readable, so a later turn picks the fixed file up
after the human corrects it. The panel's read is unaffected — it reports the refusal as an
error, which is what tells the human what to fix. `refresh()` keeps its old behaviour: the last
good text stays in force until the bytes change.

## The cache contract

- **The panel reads the exact bytes.** It asks the command for `{op:"raw"}`, which answers
  `{bytes, base64}` from a plain `readFileSync`; no line split, no join, no re-encoding. The
  line-based `workspaceFiles.read` cannot carry the final newline of a newline-terminated file
  (it splits on `\n` and rejoins), so an earlier panel showed **103 bytes for a 104-byte file
  and wrote 103 back** on an untouched save. `read` still answers line text for compatibility;
  an older host without `raw` is detected and the panel says so in the console instead of
  pretending the read is exact.
- The byte counter shows the HOST's count for the loaded file, and `${live} bytes · file
  ${loaded}` when they differ, so a one-byte drift is visible before a save.
- Typing is local React state; nothing reaches the host until **Save**.
- Save writes the file atomically and returns `{ok, bytes}`. It does **not** touch the
  in-memory section. The draft is written verbatim: no trim, no newline normalization, no
  re-encoding. Measured in a real browser: a 104-byte file loaded, saved untouched, sha256
  identical (`f23e9510…`); an edit saved at 126 bytes, trailing newline intact; restored, the
  hash returned to `f23e9510…`.
- The section text is a per-agent frozen string. It re-reads the file only at that agent's
  own `turn/start`. If the bytes are unchanged it **keeps the previous string**.
- An empty file renders no section (the prompt renderer drops empty sections).
- A refused read (invalid UTF-8, over `maxBytes`) renders an EMPTY section for that agent and
  logs once; the panel's `read` answers `{kind:"error", text:"project-rules: …"}` so the
  reason is visible where the file is fixed.
- The section carries no timestamp, size, hash, counter or turn number: its text is the
  file's text, byte for byte.

Measured on a real session: see the report the task produced; `system/message` events
(the harness's system re-render points) appear once when the prompt first changes and once
after a saved edit, never per step and never on a mid-turn save.

## API

- `/project-rules {"op":"read"}` → `{ok, text, bytes, path}`; a mangled or oversize file is
  `{kind:"error", text:"project-rules: … is not valid UTF-8 …"}` — an error result, never a
  thrown command
- `/project-rules {"op":"save","text":"…"}` → `{ok, bytes, path}` (exactly the text given,
  capped at 32 KB; invalid UTF-8 is refused on read)

## Files

- `index.js` — section registration (`agent/created`, both root and child), per-agent
  freeze (fail-closed first read), atomic read/write, the `rules_human_only` guard with real
  path resolution, command.
- `client.js` — the panel (`main` page + `sidebar.panellist` entry), `workspaceFiles` read,
  command save, dirty/byte state.
