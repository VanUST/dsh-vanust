/**
 * PURPOSE
 *   The worker-thread half of the ratchet's decisions service: it derives one project's
 *   decision view and returns it already capped. It exists so parsing a corpus, hashing
 *   every record and serialising the result happen on a thread other than the event loop
 *   that serves the harness — a synchronous derivation of a few hundred records already
 *   blocks that loop for more than a second, and of a few thousand for several, which is
 *   an unanswerable window while it runs. `ratchet-decisions.mjs` owns the contract; this
 *   file only carries it across the thread boundary.
 *
 * INPUTS
 *   `workerData` — `{ root }`, the absolute project root (string) to derive for. Any other
 *   value reaches `deriveDecisions`, which turns it into the empty, unusable view.
 *
 * OUTPUTS
 *   One `parentPort` message: `{ ok: true, view }` with the capped view model, or
 *   `{ ok: false, error }` with the failure's stack or message. It never throws out of the
 *   worker, because an uncaught throw would reach the caller only as an opaque `error`
 *   event and lose the sentence that says what failed.
 *
 * KEYWORDS
 *   worker thread, decisions service, off the event loop, response cap, parentPort
 */
import { parentPort, workerData } from 'node:worker_threads'
import { capDecisionsView, deriveDecisions } from './ratchet-decisions.mjs'

try {
  const view = capDecisionsView(deriveDecisions({ root: workerData?.root }))
  parentPort.postMessage({ ok: true, view })
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) })
}
