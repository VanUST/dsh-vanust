# @cc/dsh-babysitter

Drive the real [babysitter](https://github.com/a5c-ai/babysitter) CLI from DSH.
This is a client of the CLI, not a babysitter harness: babysitter has no DSH
adapter, so the plugin shells out, reads the event journal, and maps each run to
one taskboard task.

## The gap, stated first

- **DSH is not a babysitter harness.** Babysitter's harness list does not include
  DSH. `--harness internal` means genty's built-in agent-core loop, not DSH.
  This plugin never claims otherwise.
- **The taskboard remains the outer ledger.** A run is mapped to one taskboard
  task, but the human/orchestrator accepts that task. This plugin ends it at
  `review`, never `done`.
- **The journal remains the run authority.** `status` reads `journal/*.json`
  directly; `state/state.json` is only a cache. A CLI exit code of 0 is not
  treated as success by itself.

## Install and resolution

```sh
npm install -g @a5c-ai/babysitter
babysitter --version   # 6.0.0
```

The metapackage installs everything this plugin needs. `@a5c-ai/genty-platform`
did **not** need a separate install; it is already a dependency of
`@a5c-ai/babysitter`. The `genty` command is nested inside that package and is
not on PATH in this layout; the plugin derives it from the `babysitter` install:

```
babysitter  .../@a5c-ai/babysitter/bin/babysitter.js
genty       .../@a5c-ai/babysitter/node_modules/@a5c-ai/genty/dist/cli/main.js
```

If either command is elsewhere, set `babysitterPath` / `gentyPath` in the plugin
config. With no CLI on PATH and no absolute path configured, every tool returns
one install message and no stack trace:

> The babysitter CLI is not available. Install it with: npm install -g @a5c-ai/babysitter (Node 24+), then verify with: babysitter --version. …

## Tools

| Tool | What it does |
|---|---|
| `babysitter_run` | Runs a process module, or a prompt that genty turns into one. Modes: `call` (default), `plan`, `yolo`. Harness defaults to `internal`. Creates one taskboard task and leaves it in `review`. |
| `babysitter_status` | Reads one run by id, or lists recent runs, from the journal under the workspace `.a5c/runs` (walking up to a repo root) and `~/.a5c/runs`. Reports the linked task id/revision. |
| `babysitter_resume` | Calls `genty resume-run` for a run id. This path needs the same model provider as an LLM-backed run. |
| `babysitter_doctor` | Calls `genty doctor --json` and probes both CLI versions. Reports the exact failure; it does not fix credentials. |

Every spawn is bounded. `timeoutMs` defaults to **600000 ms** and is settable per
call or in plugin config. A timeout kills the child and returns a failure that
names the timeout, not a hang. `stdout` and `stderr` are captured separately and
tail-capped (`maxOutputBytes`, default 24000) so a huge log cannot flood the
context. The exit code is returned verbatim, and the run id is returned whenever
the CLI prints one.

## What the CLI's own `--help` says

`babysitter --help` (exit 0) lists its run/task/session commands:

```
babysitter run:create --process-id <id> [--entry <path#export>] ...
babysitter run:status <runDir> [--json]
babysitter run:events <runDir> [--json] ...
babysitter task:post <runDir> <effectId> --status <ok|error> ...
```

`genty --help` (exit 0) owns the agent-facing commands:

```
genty create-run [...]        genty call [...]        (alias)
genty yolo [...]              genty plan [...]
genty resume-run [...]        genty resume [...]       (alias)
genty doctor [...]            genty start-server [...] genty tui [...]
```

This split is why the plugin resolves two commands, not one. It does **not** run
the MCP server.

## What works, and how it was proved

The selftest is the proof; it is not an autotest:

```sh
node scripts/babysitter-selftest.mjs
```

It proves, in order:

1. The `babysitter` and `genty` CLIs resolve (the latter derived from the
   former in this layout).
2. Both `--version` commands exit 0 and both print `6.0.0`.
3. `babysitter --help` exits 0 and names `run:create` / `run:status`.
4. `genty --help` exits 0 and names `genty call`, `genty resume`, `genty doctor`.
5. One real process runs end to end with `--harness internal`:
   `RUN_CREATED → EFFECT_REQUESTED → EFFECT_RESOLVED → RUN_COMPLETED`, state
   `completed`, no failed task results.
6. The taskboard task exists, is in `review`, and its timeline has the start
   note, the run-id note, the finish note and one note per journal transition.
7. `babysitter_status` reads that same journal and finds the linked task.
8. `genty doctor` returns the exact provider-credential failure in this
   environment (the CLI exits 1).
9. A 500 ms timeout is returned as `timedOut: true` with the text
   `genty call timed out after 500 ms`; no process is left running.
10. The tail cap keeps only the last 1000 characters of a real help output and
    reports truncation.
11. With PATH cleared and no absolute path configured, all four tools return the
    same install message and no stack trace.

It exits 0 only when the end-to-end run produced journal evidence and the task
really reached `review`; otherwise it exits 1 with the missing piece named.

## What needs a model provider or an external harness

Deterministic `shell` tasks under `--harness internal` need no model provider.
Everything that plans, interprets, or resumes needs one:

- **`prompt` instead of `process`**: genty first authors a process with an LLM.
- **Agent/LLM tasks inside any process**: the internal harness still calls a
  model through agent-core.
- **`genty doctor`**: in this environment it exits 1 with
  `No API credentials found. Set one of: AGENT_MUX_PROVIDER + AGENT_MUX_API_BASE + AZURE_API_KEY …, OPENAI_API_KEY …, ANTHROPIC_API_KEY …, or AGENT_MUX_API_BASE + AGENT_MUX_API_KEY …`.
  The plugin returns that message verbatim in `doctor.stderr`/`error`.
- **`genty resume-run`**: the same credential requirement. A completed
  shell-only run usually has nothing to resume; a successful resume was **not**
  proved in this environment because no provider is configured.

To route LLM work through an installed agent CLI instead of an API key, use the
genty harness name for that CLI (the doctor message names `claude-code` as an
example). DSH itself is not one of those harnesses.

## Taskboard mapping, explicitly

One babysitter run maps to exactly one taskboard task:

| Babysitter | Taskboard |
|---|---|
| run starts | `create` with title from the process name or prompt, objective from the prompt/process, scope containing `workspace:<abs>`, status `active` |
| run id printed | one `note`: `babysitter run id: <id>; journal: <dir>` |
| each journal transition | one `note` per transition, capped by `maxTransitionNotes` |
| run finishes, fails or times out | one `note` with exit code, timeout flag, journal state and journal path |
| failed task results | one `note` naming each failed task and its exit code |
| run finished | `update` to status **`review`**, never `done` |
| human/orchestrator | reads the task and accepts it; the plugin does not |

The taskboard service is bound with `ctx.inject(['taskboard'], …)`, so this
plugin still loads and its tools still work where no taskboard is mounted. In
that case the result says `taskboard.mounted: false` and the run is tracked only
in the journal. Every taskboard call is wrapped: a bookkeeping error becomes a
property of the result, never a failed run.

`.dsh/babysitter-links.json` is a lookup index from run id to task id, not a
second ledger. `.dsh/taskboard.json` is the ledger; the run journal is the run
authority.

## Status details

- A specific run is found under the workspace `.a5c/runs`, a `.a5c/runs` higher
  up the tree, `~/.a5c/runs`, or a configured `runsDir`.
- `journal/*.json` is read in sequence order. The last event type maps to
  `completed`, `failed`, `halted`, `cancelled`, `created` or `running`.
- `state/output.json` is previewed; `state/state.json` supplies pending effects.
- `tasks/<effect>/result.json` is read on every `EFFECT_RESOLVED`. `genty call`
  can exit 0 while a shell task failed; in that case the result is
  `ok: false` with `failedTasks`, even though the journal says `completed`.

## Process files

A process file exports `process(inputs, ctx)` and defines tasks with
`defineTask` from `@a5c-ai/babysitter-sdk`:

```js
import { defineTask } from '@a5c-ai/babysitter-sdk';

const sayHello = defineTask('say-hello', () => ({
  kind: 'shell',
  title: 'say hello',
  shell: { command: 'node', args: ['-e', "process.stdout.write('hello')"] },
}));

export async function process(inputs, ctx) {
  const said = await ctx.task(sayHello, {});
  return { ok: true, said };
}
```

Two requirements matter on this host:

1. **The SDK must resolve from the process file or the workspace.** The global
   metapackage nests it at `@a5c-ai/babysitter/node_modules/@a5c-ai/babysitter-sdk`;
   it is not resolvable from an arbitrary temp directory. The adapter detects the
   import and refuses early with the exact `node_modules` symlink command,
   instead of letting the CLI retry the import until the timeout. A workspace
   install of `@a5c-ai/babysitter-sdk` works too.
2. **`shell.command` is an executable, and `shell.args` is the argument array.**
   The internal host executes `execFileSync(command, args)`; a whole shell line
   in `command` is treated as one executable name and fails. Use
   `command: 'node', args: [...]` or `command: '/bin/sh', args: ['-c', '...']`.

`#export` is optional; the CLI defaults to the `process` export.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `600000` | Bound for `run` / `resume` spawns. |
| `doctorTimeoutMs` | `60000` | Bound for `genty doctor`. |
| `maxOutputBytes` | `24000` | Tail cap for each of stdout and stderr. |
| `maxRecentRuns` | `10` | Recent-list size. |
| `maxTransitionNotes` | `20` | Journal transitions copied to the task timeline. |
| `maxJournalScan` | `500` | Journal entries scanned per run. |
| `babysitterPath` | `''` | Absolute `bin/babysitter.js` when not on PATH. |
| `gentyPath` | `''` | Absolute genty CLI when it cannot be derived. |
| `runsDir` | `''` | Extra runs directory to scan. |
| `linksFile` | `.dsh/babysitter-links.json` | Run → task lookup index. |
| `taskboard` | `true` | Set false to disable task mapping. |

## Not proved here

- A successful `genty resume-run`: no model provider is configured.
- A passing `genty doctor`: same reason.
- Prompt-authored processes and agent/LLM tasks: same reason.
- A successful run on Windows: the selftest was run on Linux. The plugin avoids
  shell spawning and uses Node for JS entries, but that path was not exercised.

No autotest was added. The selftest is the product run requested by the task, and
its full output is the evidence.
