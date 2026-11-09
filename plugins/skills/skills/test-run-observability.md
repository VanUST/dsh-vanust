# Test-run observability

A red run with one screenshot is a mystery. A red run with a structured event
log, a Playwright trace and the failing step's id is a two-minute read. The
difference is not tooling budget; it is deciding, before the run, what evidence
the run will leave.

`ui-testing` decides pass or fail; this skill decides what a failed run leaves
behind. Log-driven development: every step emits one machine-readable event, and
the first thing a failing job does is read the events, not the console.

## One JSON object per line

```json
{"ts":"2026-11-09T10:22:41.320Z","runId":"ci-4812","step":"axe.broken","status":"error","ids":[]}
```

The fields that earn their place:

| Field | Why |
|---|---|
| `ts` | order events without trusting print buffering |
| `runId` | join the log to the trace, the screenshot and the CI job |
| `step` | a stable name you can grep and count |
| `status` | `ok`, `error` or `skip` — a gate can act on it |
| data | ids, counts, selectors, duration — never a whole DOM |

Append; do not rewrite. A log that is rewritten on failure has already lost the
events that explain it.

```js
import { appendFileSync, mkdirSync } from 'node:fs'

const RAW_RUN_ID = process.env.RUN_ID ?? new Date().toISOString().replace(/[:.]/g, '-')
// Keep the id legal as a directory name on every OS; keep the raw value in events.
const RUN_ID = RAW_RUN_ID.replace(/[^A-Za-z0-9._-]/g, '-')
const WORKER = process.env.TEST_WORKER_INDEX ?? '0'
mkdirSync('artifacts', { recursive: true })

export function event(step, status, data = {}) {
  const record = { ts: new Date().toISOString(), runId: RAW_RUN_ID, step, status, ...data }
  // One writer per file: parallel workers must not append to one JSONL.
  appendFileSync('artifacts/run-' + WORKER + '.jsonl', JSON.stringify(record) + '\n')
}
```

Set `RUN_ID` from CI (commit plus job number) so an artifact found in a bucket
points back at a job, and a job points at one log file. Per shell: `RUN_ID=ci-4812`
(bash), `$env:RUN_ID = "ci-4812"` (PowerShell), `set RUN_ID=ci-4812` (cmd); Node
reads it the same way on all three.

## Summarize before you read

```js
import { readFileSync, readdirSync } from 'node:fs'

const rows = readdirSync('artifacts')
  .filter((name) => /^run-\d+\.jsonl$/.test(name))
  .flatMap((name) => readFileSync('artifacts/' + name, 'utf8')
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)))
const errors = rows.filter((row) => row.status === 'error').map((row) => row.step)
const required = (process.env.REQUIRED_STEPS ?? 'bridge.read,axe.clean')
  .split(',').map((step) => step.trim()).filter(Boolean)
const seen = new Set(rows.map((row) => row.step))
const missing = required.filter((step) => !seen.has(step))
console.log(JSON.stringify({ events: rows.length, errors, missing }))
process.exit(errors.length > 0 || missing.length > 0 ? 1 : 0)
```

The gate does two jobs: it fails the build on an error event even when the test
runner exited 0, and it makes a silent skip visible. A run with no events for a
step that should have happened is a failure too — count the expected steps, do
not just look for red.

## Playwright traces

```js
// playwright.config.mjs
export default defineConfig({
  use: { trace: 'retain-on-failure' },
})
```

- `retain-on-failure` records every run and keeps the trace only when the test
  fails. `on-first-retry` keeps nothing when `retries` is 0: it records on the
  first *retry*, not the first failure.
- For a local repro, record unconditionally: `npx playwright test --trace on`.
- Open it with `npx playwright show-trace test-results/<test>/trace.zip`, or drag
  the zip into trace.playwright.dev.
- A trace holds DOM snapshots per action, network requests, console logs,
  sources and a screencast. It is evidence, not a video: you can inspect the page
  at the exact action before the failure.

Inspect what you are about to trust:

```bash
# macOS / Linux / WSL
unzip -l test-results/ui-bridge-*/trace.zip | head
# Windows: cmd/PowerShell do not expand * for a native exe — resolve the path first
$zip = (Get-ChildItem test-results -Recurse -Filter trace.zip |
  Select-Object -First 1).FullName
tar -tf $zip
# Names vary by version/retry: trace.trace or <n>-trace.trace, <n>-trace.network,
# screencast/*.jpeg, sources — inspect, do not assert the exact set.
```

Upload `test-results/` on failure only. Traces are large and a green run's trace
is stale the moment it is written.

## The failure bundle

For each failing test keep four things together under
`artifacts/<runId>/<test>/`: the JSONL slice, the trace zip, the screenshot
(either the runner's failure shot or a golden diff), and the failing assertion's
message. A bundle with three of the four is still a hunt. Build the directory
name with `path.join`, not string concatenation, so Windows separators and drive
letters do not leak into artifact names.

## Pitfalls

- **Prose logs.** `console.log('clicked')` cannot be counted, filtered or gated.
- **Logging everything.** Every mouse move turns the log into a second trace and
  buries the twelve events that matter.
- **Secrets and people.** Never log tokens, cookies, emails or full request
  bodies. Allowlist the fields; logging is a data-egress path.
- **Logs as the oracle.** The assertion decides pass or fail; the log explains
  it. A test that greps its own log can pass without the UI working.
- **No run id.** Artifacts without a run id cannot be joined across systems.
- **Trace always on.** Disk and upload cost, and a stale trace is read as if it
  were the current run.

## Sources

Playwright [trace viewer](https://playwright.dev/docs/trace-viewer) and
[test configuration](https://playwright.dev/docs/test-use-options). The event
schema is this deployment's; it pairs with `ui-testing` and `visual-golden-tests`.
