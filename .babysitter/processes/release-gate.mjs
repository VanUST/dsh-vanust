/**
 * PURPOSE
 *   The kit's release gate as a babysitter process: two deterministic checks,
 *   each journaled as its own task, so a failing gate leaves a run a human can
 *   resume instead of a shell transcript nobody kept.
 *
 *   It exists because the adapter had no process to run on this machine: the
 *   CLI and the SDK are installed and the tools are mounted, but the plugin had
 *   never executed anything because nothing had a process file to point at.
 *
 * INPUTS
 *   None. Both checks read the kit relative to their own location.
 *
 * OUTPUTS
 *   `{ ok, results: [{ name, ok, lastLine }] }` plus one journal per run.
 *
 *   `ctx.task()` resolves to the task's result PAYLOAD — the command's stdout as
 *   a string — not the `{status, result}` envelope stored on disk. Two runs were
 *   spent learning that: the first read `outcome.ok`, the second read
 *   `outcome.status`, and both reported failure for tasks that had printed PASS
 *   lines. The probe in `probe-task-result.mjs` is that measurement.
 *
 *   A shell task that exits non-zero arrives as `ok: false` rather than as a
 *   crash, so the loop keeps going and the summary names every failure at once.
 *
 *   Verified against babysitter 6.0.0: a process exports `process(inputs, ctx)`,
 *   tasks come from `defineTask`, and `shell.command` is an executable with
 *   `shell.args` as its argv — a whole shell line in `command` fails.
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Tasks are defined at MODULE scope, never inside `process()`. The runtime
 *     replays the process after every resolved effect, so a `defineTask` call in
 *     the function body registers the same id twice and the run dies with
 *     "Task id ... is already registered" — measured on the first attempt here.
 *   - A non-zero check is a normal task result (`ok: false`), not an exception:
 *     both checks always run, and the summary names every failure at once.
 */

import { defineTask } from '@a5c-ai/babysitter-sdk'

const KIT = '/home/iustimov/dsh-kit'

/** One shell task that runs a node script and is journaled under its own id. */
const script = (id, title, file) => defineTask(id, () => ({
  kind: 'shell',
  title,
  shell: { command: 'node', args: [`${KIT}/${file}`] },
}))

const CHECKS = [
  { name: 'documentation', task: script('kit-documentation', 'kit documentation claims', 'scripts/check-documentation.mjs') },
  { name: 'portability', task: script('kit-portability', 'kit portability and packaging', 'scripts/check-portability.mjs') },
]

export async function process(inputs, ctx) {
  const results = []
  for (const { name, task } of CHECKS) {
    // `ctx.task` resolves to the task's RESULT payload — the command's stdout as
    // a string for a shell task — not to the on-disk `{status, result}` envelope
    // and not to `{ok, exitCode}`. Measured with probe-task-result.mjs.
    const text = String(await ctx.task(task, {}))
    const ok = text.trim() !== '' && !text.includes('[FAIL]')
    results.push({
      name,
      ok,
      lastLine: text.trim().split('\n').filter(Boolean).at(-1) ?? '',
    })
  }
  return { ok: results.every((result) => result.ok), results }
}
