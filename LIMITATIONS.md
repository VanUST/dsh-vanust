# What this kit does not do

**This file is the ledger of gaps.** Every entry is either a guarantee that stops short, a
rule nothing enforces, or a capability that does not exist yet. A papered-over gap is worse
than a reported one, so an entry here is a fact about the kit rather than an apology for it.

Read it before trusting anything the rest of the repository says. Where a claim elsewhere
and an entry here disagree, this file is the one written to be uncomfortable.

## 1. The concurrency cap

**The cap counts the `subagent` tool, and a `workflow` fan-out is deliberately outside it.**
The human chose that knowingly. It means the cap is **not** a ceiling on concurrent work:
one `workflow` call can still fan a session out wider than two agents, and nothing refuses
it. `node --test scripts/test-work-modes.mjs` asserts this rather than leaving it implied —
an uncapped tool is exercised with the delegation cap already saturated.

**The cap is per session, and enforced only while this process holds the ledger.** Nothing
is persisted. A restart forgets which children were running, so the first two delegations
after a restart are admitted even if two children are in fact still running. The cap is
therefore a limit on *admissions in this process*, not a distributed quota.

**A lost terminal edge is bounded by age, not resolved.** A start edge that never arrives
leaves its slot held until `staleAfterMs` (15 minutes by default) sweeps it. That is
fail-closed with a bound: a child that legitimately runs longer than the window releases
its slot while still working, and a phantom slot refuses delegation for up to the window.
Measured while building this: a stub provider settles its result and emits **no**
`subagent/end`, so a design that released only on that edge would hold every slot forever.

**The attribution is by time order, not by identity.** A start edge carries the child id and
no parent (measured: the delegating parent is the scoped dispatch receiver, not a listener
argument), so an admission is matched to the oldest unmatched one. Two delegations racing
in one session could therefore be attributed to each other. The count is unaffected; the
*name* in a refusal could be.

**A delegation the `subagent` tool did not place is not counted by name but is counted by
root** only when its parent chain was already recorded. The ADR panel's own resolver
(`dispatchResolver`, a continuable child started outside the tool) is one such case.

## 2. Work modes

**The mode is session state in memory.** A restart resets every session to the default
(`research`). Nothing about the mode is durable, by decision: a stale policy resurrected
from disk is worse than a default.

**The ADR panel does not yet render the mode toggle.** The route is served, fenced by the
panel's own capability shape, and tested (`node --test scripts/test-work-modes.mjs` drives
the real handler: a wrong or absent capability is refused, an unknown mode is refused, a
known one is stored, and the stored mode changes what the NEXT prompt assembly renders).
What is **not** built is the button in the shipped browser bundle: `plugins/dsh-adr-panel/client.js`
is a packed bundle with no generator in this repository, and a hand-edit to a packed bundle
cannot be verified without a browser. A human reaching the mode today would have to call
the route. **This is the largest gap in the two features and it is reported, not hidden.**

**The mode rule is prose in the prompt.** What enforces it is the record/measure/guard
chain below, not the sentence. An agent that ignores the injected section is not stopped by
it.

## 3. The meaning guarantee, exactly

**The system can deterministically require that a judgement has been MADE and RECORDED. It
cannot deterministically PRODUCE the judgement.** That is the whole boundary.

* **Deterministic about whether a judgement was made:** `ratchet compile` and
  `ratchet verify` report `contradictionReview.stale` by comparing the ledger's last review
  hash against the hash of the laws now in force (`contradictionReviewStatus`,
  `plugins/ratchet/ratchet-ops.mjs`). Falsified by hand: a fresh project reports
  `reviewed: false, stale: true`; a review appended with the matching hash reports
  `stale: false`; the same review against a different hash reports `stale: true` again; a
  corrupt ledger reports `reviewed: false` rather than a pass. `node --test scripts/test-ratchet-guard.mjs`.
* **Enforced about what the judgement concluded:** a recorded blocking finding makes the
  write guard refuse writes in the zones the contradicted law governs
  (`plugins/ratchet/ratchet-guard.mjs`, ledger-backed). The judgement is a model's; the
  block is the system's.
* **Never a shell check.** A meaning check cannot be a law's `checks` entry: a check is a
  shell command and a shell cannot spawn a judge. Nothing here claims otherwise.

**Residual limits, named:** a block is only as good as the judge that raised it — a
law-bound finding must quote the law it judges, and a quote that does not match the compiled
law makes the finding **unusable** rather than blocking (`BLOCKING_FINDING_KINDS` plus the
quote check); a false positive refuses writes in the governed zones until it is rebutted, and
a false negative lets a contradiction through; the block binds writes in the governed zones,
**not every write**.

**The review requirement is not itself a law check.** Making "a fresh review exists" a law
whose `command` asserts freshness is impossible: the law's own text is part of the spec hash
the check would compare against, so adding it makes the review stale and the check can never
pass. This is a genuine self-reference, not an implementation shortcut. The requirement
therefore lives in the mode's rule, in the deterministic CLI fact, and in the guard — not in
a `checks` entry.

## 4. Rules with no enforcement point

From `.dsh/project.json`, reported by `context_rules` and by the ratchet:

* **`flash-only-models`** — the model-gate plugin vetoes a non-Flash `llm/stream` dispatch
  and `scripts/verify-upgrade.sh` probes exactly that inside a throwaway profile. Nothing
  checks that the gate is ENABLED and MOUNTED on a machine's live profile.
* **`pin-the-harness`** — the version is pinned in both installers. No command compares the
  pins, and nothing refuses an unpinned harness.

Every other claimed rule names a command that fails when it is broken; `context_rules`
prints the list.

## 5. Checks that cannot run everywhere

* **The drill's live half is non-hermetic.** `node scripts/drill-kit-rules.mjs --root .
  --live` runs a model twice per scenario, so it belongs in `verify-upgrade.sh` and never in
  a law's `checks`. What runs hermetically is the plan (`--plan`, proving each scenario
  strips a section the rules file really carries) and the verdict logic
  (`node --test scripts/test-drill-kit-rules.mjs`). **A rule drill is evidence, not a
  guarantee**: it measures what an agent DID under a pressure prompt, which is a sample, not
  an enforcement point.
* **`probes/api-probe` needs a linked harness.** `node scripts/dev-link.mjs` links
  `@deepseek-ai/dsh-tools` beside it; the harness classes the work-modes probe imports are
  resolved through each package's own manifest, so a harness that moves an entry point is
  reported rather than silently unloadable.

## 6. A defect found while building this, and fixed

`scripts/test-drill-kit-rules.mjs` derived the kit root from
`new URL('.', import.meta.url).pathname`, which on Windows is `/C:/…` — a path `path.join`
cannot walk up from. The scenario directory therefore resolved to nothing and the test read
**zero** scenarios while its `>= 3` assertion was the only thing that noticed. It now uses
`fileURLToPath`. The lesson worth keeping: on this kit, any path derived from a URL is a
portability defect until a Linux machine runs it.
