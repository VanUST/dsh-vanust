# SUPERPOWERS-COMPARISON.md — what obra/superpowers does that this kit does not

A reading of [`obra/superpowers`](https://github.com/obra/superpowers) (MIT) against
this kit, and the additions it argues for. **It is a reading, not a contract**: the
artifacts win wherever they disagree, and its figures are dated. It exists because the
two systems are strong in opposite places, and the kit has been borrowing its
enforcement from one half while leaving the other half unbuilt.

Sources read for this comparison: `README.md`, `CLAUDE.md`, `docs/testing.md`,
`skills/using-superpowers/SKILL.md`, `skills/brainstorming/SKILL.md`,
`skills/writing-plans/SKILL.md`, `skills/executing-plans/SKILL.md`,
`skills/subagent-driven-development/SKILL.md`, `skills/dispatching-parallel-agents/SKILL.md`,
`skills/test-driven-development/SKILL.md`, `skills/systematic-debugging/SKILL.md`,
`skills/requesting-code-review/SKILL.md`, `skills/receiving-code-review/SKILL.md`,
`skills/finishing-a-development-branch/SKILL.md`,
`skills/verification-before-completion/SKILL.md`, and
`skills/writing-skills/testing-skills-with-subagents.md`.

## 1. The two systems are complements, and each is weak where the other is strong

**Superpowers is an execution methodology.** Fourteen skills, injected at session
start and re-injected after compaction, that say how work proceeds from an idea to a
merged branch: brainstorm → spec → plan → fresh-subagent TDD execution → task review →
broad review → finish the branch. It is explicit that these are *mandatory workflows,
not suggestions*, and it has a serious apparatus for making prose stick: an
`<EXTREMELY-IMPORTANT>` bootstrap, "Red Flags" lists, rationalization tables that name
the exact excuse next to its rebuttal, and an eval harness that pressure-tests a skill
against an agent that wants to break it.

**This kit is a governance layer for the prompt, not for the build.** It states operating
rules that must not be diluted by whichever repository the agent sits in, and it reports
what a project declares: `context_rules` answers which rules bind a path, each with the
command that fails when it is broken, and which of them name no such command. Its defining
rule (§3) is that *a rule is real only where a command fails when it is broken* — a rule
whose enforcement point is missing is reported as an unverified claim rather than quietly
relied on.

The consequence runs both ways:

- Superpowers has **no enforcement point anywhere**. A skill that says "you MUST"
  changes nothing about what the harness will accept; compliance is measured by an LLM
  verifier over a real session (`evals/`, drill). Its own `docs/testing.md` says those
  evals "are not part of CI today", and scenarios are "3-30+ minutes each". Every
  guarantee in Superpowers is therefore a claim about model behaviour, not a check —
  precisely the unverified rule this kit's §3 tells the agent to report rather than
  rely on.
- This kit has **no execution methodology**. It governs the artifact but
  not the process: there is nothing about how a request becomes a spec, how a spec
  becomes tasks, how a task is executed and reviewed, how a bug is diagnosed, or
  whether a change is finished. §6 covers architectural consultation and §7 offers
  grilling, but both are narrower than a workflow, and neither is what an agent
  actually follows on an ordinary task.

The useful move is therefore **not** to port the skills. It is to take the *practices*
Superpowers has found to change agent behaviour, and give them the enforcement points
this kit requires — plus take its *rhetorical* devices (rationalization tables, red
flags, pressure scenarios), which are cheap and are the missing complement to our
prose rules.

## 2. What the kit already has, so it is not duplicated

| Superpowers concern | Kit's existing answer | Gap |
|---|---|---|
| architectural design before implementation | ADRs as plain documents under `docs/adrs/`, §6 | no path classification; approval gate not universal |
| design doc / spec artifact | human-authored `docs/specs/*.md`, injected by `@cc/dsh-specs` | a *requirement* artifact, not a *work plan* |
| plan + task list | `context_specs` work orders (paths it may write, completion command, lifecycle) | no authoring format, no lint, not routinely created |
| TDD | none | entire gap |
| systematic debugging | §10 breaker (adversarial *verification*, after the fact) | no diagnosis protocol |
| code review | none | no per-task review protocol, no reception discipline |
| subagent execution | `subagent`/`subagent_fork`/`workflow` | no fresh-per-task + two-stage review protocol |
| worktrees | none | this kit has already hit the collision it prevents |
| verification before completion | §1 LDD + §11's evidence rule | the *claim* discipline in a skill form is absent |
| skill testing with subagents | differential drill scenarios under `rules/drills/` | rules injected as prose are never tested behaviourally |
| bootstrap re-injection after compaction | `kit-rules` re-reads `$DSH_HOME/AGENTS.md` per prompt assembly | strictly stronger than a cached one-shot; do not regress |

## 3. Proposed additions, ranked by value and by whether they can be enforced

### Tier 1 — closes a gap the kit already admits

**1. A rule drill: test a prompt rule the way a check is tested.**

Superpowers' strongest idea is `testing-skills-with-subagents.md`: process
documentation is TDD'd. RED — run a pressure scenario *without* the rule, record the
agent's rationalizations word-for-word; GREEN — write the rule to address exactly those
failures, run it again; REFACTOR — add an explicit counter for each new excuse and
re-test. The scenarios combine 3+ pressures (time, sunk cost, authority, exhaustion)
and force a concrete A/B/C choice, because a single pressure is resisted and multiple
pressures are not.

The kit has never done this. It checks that `kit-rules` *reaches* the prompt
(`scripts/check-instruction-routing.mjs`), which is delivery, not obedience.
Nothing tests that §8 stops an agent choosing a non-Flash model or that §9 stops it
mutating a remote host — those two are prompt rules whose only enforcement point sits
outside the prompt (the model-gate plugin's veto; a human's permission), and a drill is how
a prompt rule is tested at all.

Addition: a drill runner plus `rules/drills/*.json` scenarios.
Each drill dispatches a subagent through the harness's own `subagent` seam with a
pressure prompt and asserts an **action**, never a recited answer: did it attempt a
non-Flash model, did it write outside the workspace, did it claim completion without a
fresh command, did it keep code written before its test.

Honest design constraints, which decide where it runs:

- It needs a live model, so it is **not hermetic** and cannot be a check a bare command
  runs on every change. It is a probe-tier check, run deliberately, and it
  is skipped (never passed) when no model is configured.
- It costs tokens and wall-clock. Run a small RED/GREEN pair per rule, not a sweep.
- A drill is evidence about a *prompt*, so it is the one place where an LLM judgement is
  admissible — and it must be paired with a deterministic assertion wherever one exists
  (the transcripts are logged, so the model id and the shell command are both
  checkable).

This is the highest-value addition: it is the missing enforcement point for the rules
that can never have a shell check, and it is the mechanism by which every other
proposal below can claim it works.

**2. Rationalization tables and red flags in `rules/AGENTS.md`.**

Superpowers ships, for each discipline, a two-column table of *the excuse* vs *the
reality* ("Too simple to test" → "Simple code breaks"; "I already manually tested it"
→ "Manual testing is ad-hoc…"), a "Red Flags — STOP" list of the thoughts that precede
a violation, and a `description` naming the *symptoms of being about to violate*.
The kit's rules state the constraint and never name the dodge, so the agent must
recognise the dodge unaided.

Addition: append a rationalization table to the sections that have known dodges — §1
("it compiled, so it worked"; "I'll check the logs later"), §3 ("it's a doc, not a
rule"; "nothing enforces it so it's optional"), §6 ("the change is small enough to just
do"), §9 ("read-only access is harmless"; "I only restarted it"), §10 ("I found the bug
so I fixed it"). Keep it to the excuses actually observed in this kit's own history,
because a fabricated excuse is not a test case. These entries are also the literal
scenario corpus for proposal 1 — the drill's RED phase should elicit the excuse before
the table names it.

**3. Verification before completion, as an explicit claim discipline.**

Superpowers' `verification-before-completion` is one rule: no completion claim without
fresh verification evidence; a claim without a command run in this turn is not a claim.
The kit has the *evidence production* (`check-portability.mjs`, `check-model-gate.mjs`) and §1's
"read the success logs", but it does not state the claim rule, and the failure mode it
prevents is the exact one this kit has already suffered — a green `fail 0` printed by a
suite whose covering test had been emptied, which is why the test-quality lint exists.

Addition: a short section stating that a completion claim names the command and its
observed output; that a command not run in the current turn makes the claim
provisional; and that a check whose assertion is a test *name* is not evidence. The
deterministic half already exists; proposal 1 gives the behavioural half. This is the
cheapest behavioural improvement in the set.

**4. A test-workflow rule: tests verify product behaviour, not shape.** Superpowers'
`writing-good-tests` states two principles — every test names the break it catches, and
every test exercises the real thing — and then names the shapes that violate them: a
*change detector* (`expect(MAX_RETRIES).toBe(5)`), a *mirror assertion* whose expected
value is computed by the code under test (`expect(build(x)).toBe(build(x))`), an
assertion that only proves the mock exists or was called, and tests of constructors,
getters or constants that validate, normalize, derive or enforce nothing. The kit has
no rule about tests at all: its own suite is behavioural (`assert.equal(typeof
result.problems[0].code, 'string')` on a real return value), but nothing stops a test
that only asserts an export has a method — `assert.equal(typeof bundle.apply,
'function')`, `'field' in object`, `Object.keys(fixture)`, `toHaveProperty`.

Addition, in two halves — **superseded**: the deterministic half described below (the
`scripts/check-test-quality.mjs` lint) and the test suite it policed were both removed when
rule 12 changed to prohibit agents from writing automated tests at all. The paragraph is kept
as the record of what was argued and built, not as a description of what the kit does now.

- **The deterministic half** is a lint, `scripts/check-test-quality.mjs`. It scans the test files (`scripts/test-*.mjs`, `plugins/*/test-*.mjs`) and
  reports: a structural assertion whose subject is a module or fixture binding whose
  property is never *called* in the same test; a test whose only assertions are about a
  mock or fake; a mirror assertion; and a test file that never calls an exported product
  symbol. It is a heuristic and must say so — an explicit exception list, an `[SKIP]`
  when a file cannot be parsed, and a finding reported per test with the file and line,
  never a silent pass. Run it in report mode over the existing suite before it becomes
  a required check, because turning the suite red on pre-existing tests is a change the
  human should see.
- **The process half** is the drill from proposal 1: the scenario gives the child a
  failing product and a `claim_complete` tool, and asserts the child ran the suite and
  saw it fail before writing product code — the tool order is deterministic, so no model
  has to grade it. The same discipline applies to a check itself: name the mutation that
  makes it fail and confirm it fails, which is exactly "name the break the test catches".

### Tier 2 — the missing execution layer (adds an artifact or a protocol; needs a decision)

**5. A plan artifact with a lint.** Superpowers writes implementation plans to
`docs/superpowers/plans/YYYY-MM-DD-<topic>.md`: bite-sized 2–5 minute steps, the exact
file paths and the exact code, the test that proves each step, no placeholders, a
self-review pass, then a separate plan-document reviewer. The kit's `context_specs`
work orders are the same idea (declared write paths, a completion command, a lifecycle)
but there is no format, no checker, and the agent does not reliably create them.
Addition: a `docs/plans/` convention (distinct from `docs/specs/`, which holds the
human-authored specs) and a hermetic `scripts/check-plan.mjs` that
fails on `TBD`/placeholder text, a task with no file path, a task with no verification
command, and two active plans whose write paths overlap — the last being exactly the
collision `context_specs` detects for work orders. A command binds the convention. Cost: one
more artifact class; benefit: write-scope is decided before the edit and two agents can
no longer land on the same file.

**6. The brainstorming approval gate, folded into §6/§7.** Superpowers classifies every
request as spike / bounded / architectural, announces the classification so the human
can override it, and **never implements before an explicit approval** — the artifact
scales with the task (two sentences in chat for a bounded change), the gate does not.
Its own anti-pattern list is the argument: "'Too simple to need approval' — simple
means a short design, not no design". The kit honours this for architectural decisions
(§6, ADRs) and offers Socratic grilling on request (§7), but an ordinary "add a flag"
has no gate at all. Addition: adopt the three paths and make the approval gate
universal, using the ADR for the architectural artifact rather than inventing a second
spec format. Fold into §6, do not add a file.

**7. Systematic debugging as a bug-work rule.** Four phases — root cause, pattern,
hypothesis, implementation — with the Iron Law "no fixes without root cause
investigation first", a single-hypothesis minimal test, and a hard stop when a third
fix fails: at that point the architecture is wrong, not the hypothesis. §10's breaker is
different: it falsifies a finished guarantee. Addition: a rule section (plus the three
supporting techniques — backward data-flow tracing, defense in depth, condition-based
waiting instead of timeouts). Enforcement is proposal 1 only; say so rather than
implying a check exists.

**8. A subagent review protocol.** Superpowers dispatches a fresh implementer per
task, reviews each task in two stages (*spec compliance* first, then *code quality*),
takes findings triaged Important/Minor, runs bounded fix rounds, and finishes with one
broad whole-branch review. It also fixes the facts the kit relies on: multiple
dispatches in one block run in parallel, one per response runs sequentially. The kit
delegates heavily with no standard, which is how this session's repack race happened.
Addition: a short protocol in the rules — fresh child per task, a spec-compliance pass
against the plan's declared scope before a quality pass, a review pass whose findings are
written down, and a cap on fix rounds. Enforcement: partially deterministic (a review
record is machine-readable), partially proposal 1.

**9. Worktree isolation per workstream.** Superpowers creates a git worktree per
branch so concurrent agents cannot touch each other's tree; it is a documented skill
precisely because parallel agents collide otherwise. This kit already hit that failure
— two subagents racing on `pack-plugin.mjs` and `package.json`, resolved by serialising
the repacks — and the mitigation was manual. Addition: either the worktree rule or the
`check-plan.mjs` overlap refusal from proposal 5. The overlap check is the cheaper half
and the one that matches the kit's existing vocabulary.

### Tier 3 — contribution discipline (borrow nearly verbatim, low cost)

**10. How a change is proposed.** Superpowers' `CLAUDE.md` is a contribution contract an
agent must read before opening a PR, and it is unusually specific because its failure
costs a human reputation: search the existing attempts first (open *and* closed);
verify the problem is real before fixing it; one problem per change; no bundled
unrelated changes; no fabricated claims; disclose the model, harness, harness version
and installed plugins; show the human the complete diff and get explicit approval
before submitting. The kit pushes straight to `main` rather than opening PRs, but the
substance maps onto its commit discipline, its decision records, and `REVIEW.md`.
Addition: a short "how a change is proposed and landed" section — the diff is shown to
the human before it lands, unrelated changes are split, and an agent-authored
contribution says so.

**11. Voice.** "Your human partner" is deliberate in Superpowers and it changes how the
approval gate reads; it is more legible than "the user" for a rule that only works if
the agent treats the human as a party to the change rather than an input. Minor, and
optional.

## 4. What not to borrow

- **The skills layer as a second rule system.** Fourteen skills are fourteen prose
  constraints with no failure point. Adding them beside the kit's rules would manufacture
  exactly the unverified-rule problem §3 exists to prevent. Take the practices, give
  them checks; if a practice cannot be checked, say so and name the reason rather than
  asserting it.
- **The shouting.** `<EXTREMELY-IMPORTANT>`, "you do not have a choice", "1% chance"
  maximise compliance in the prompt but are unreviewable and unmeasurable. The kit's
  instrument is a failing command and a rationalization table; the table does the work
  the shouting is trying to do.
- **The eval harness as-is.** `evals/`/drill drives tmux sessions of other harnesses
  with Python and an API key. This kit already has an in-process `subagent` seam that
  is paid for; the drill should use it.
- **The bootstrap's cached injection.** Superpowers re-injects after compaction because
  its bootstrap is otherwise lost; `kit-rules` re-reads per prompt assembly, which is
  strictly better. Do not copy the caching.
- **Zero-dependency, no-plugin core.** Not this deployment's model; it ships plugins
  deliberately.

## 5. Recommendation

Do **1, 2, 3 and 4** first. They are cheap, they close gaps the kit itself reports, and 1
is the only way the kit can honestly claim that a prompt rule like §8 or §9 is enforced.
Add **7 and 8** as rule sections with drill coverage, since they cost only prose and
their enforcement story is already stated. Hold **5, 6 and 9** for a decision: they add
an artifact class or a layer and should be decided deliberately rather than slipped in. Take **10**
as a small edit and **11** only if the wording settles.

Two properties must survive whatever is adopted: a drill is a deliberate probe and
never a plain hermetic check (it needs a model and a port), and every rule that gains a
table also gains the drill entry that proves the table names a real dodge.

## 6. Implementability — the seams this rests on

Every proposal above was checked against a capability the kit has already measured, so
none of it needs a new harness fact:

- **Spawn a child and read its result.** `ctx.subagents.start('spawn', {label,
  prompt, parent, signal, outputSchema})` runs a real child and returns `output` and
  `structured`; `run.dispose()` reaches quiescence. Measured 2.4–6.5 s per child
  under `node scripts/probe-dsh-api.mjs`.
- **Control the injected rules.** `--kit-rules` already builds two scratch homes, writes
  an arbitrary `$DSH_HOME/AGENTS.md` into each, applies the shipped plugin and asserts
  the exact text reaches the assembled prompt by nonce. RED is therefore "the real
  `rules/AGENTS.md` minus the section under test"; GREEN is the file unchanged. This is
  the mechanism that makes the drill a *differential* test rather than a mood.
- **Observe an action deterministically.** The drill's probe plugin registers the tools
  the rule governs — `delegate(task, model)`, `run_shell(cmd)`, `remote_exec(target,
  mutation)`, `claim_complete(evidence)` — and each body appends one JSON line to a
  journal. The result is read from the journal, so the assertion is on what the child
  *did*, not on what it said; the model id, the shell command and the tool order are all
  deterministic. This is why the drill can cover TDD order and claim discipline without
  a grading model.
- **Where it runs.** A deliberate probe run, not a per-change check: it needs a live
  model and a port. Credentials are required and the drill
  is skipped — never passed — without them.
- **Its honest limit.** A RED run may fail to elicit the violation. That is useful
  information (the scenario does
  not tempt the agent, so it proves nothing) and must be reported, not swallowed. A
  drill is evidence about a prompt under one scenario, not proof of compliance.

## 7. Grounding (as of this reading)

- `context_rules` reports **11 enforced, 2 pending**: `flash-only-models` and
  `pin-the-harness`, each with an unbuilt check named. These are the concrete targets of
  proposal 1.
- The kit's injected rules are `rules/AGENTS.md`; §0a already states the kit's
  usage and how a project's specs are injected. Proposals 2, 3, 4, 6, 7, 8
  and 10 are edits to that file, not new files.
- Work orders already carry write paths and a completion command via the
  `context_specs` tool; proposal 5 is the authoring format and lint for what they
  describe.
- `docs/specs/` holds the human-authored specs an agent reads; a plan artifact must
  live elsewhere (`docs/plans/`), so the plan lint and the spec editor never touch the
  same files.
