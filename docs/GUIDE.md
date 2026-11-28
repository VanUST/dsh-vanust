# GUIDE — working in dsh-kit

One page, one owner. This is the guide a new session (human or agent) reads before touching the
repository: what the kit is, where things live, which tools exist, how deployment and acceptance
work, and the traps that already cost a retry. Everything here is a claim about the tree — when the
tree disagrees, the tree wins and this page is the bug.

Read next, in this order: `README.md` (what the kit is, per-plugin catalog), `rules/DEPLOYMENT.md`
(the normative operating procedure: fresh machine, update, rollback, checks, rules),
`docs/TERMINOLOGY.md` (the words a report must use). The rest of `docs/` owns one contract each
(see §2.3).

## 1. What dsh-kit is

`dsh-kit` installs a pinned **DeepSeek Harness** (`dsh`) and the 29 `@cc/dsh-*` / upstream plugins
this deployment needs, then composes them into a **web profile** whose sessions run as one of the
**agent presets**. It is a portable harness + workbench, not an application: there is no server of
the kit's own, no database, and no build step. The artefacts are:

- `profile/cordis.patch.yml` — the profile patch: host rows, one `preset-*` declaration per role, the
  tool-family allow lists and budgets, the model routes.
- `plugins/inventory.json` — the single source of truth for which plugins ship: 29 plugins; the
  mounted profile rows are 36 (some kit rows mount two plugins, some are host rows).
- `plugins/cc-dsh-*.tgz` — the packed tarballs the profile installs. One per package, latest version.
- `rules/DEPLOYMENT.md` — the procedure the operator follows; `make verify` reads it.
- `state/` — the project ledger (REQ / TASK / TEST / DECISION rows + `events.jsonl` + `views/`) shared
  across machines; `docs/analysis/` is the design record per initiative.

### 1.1 How the harness is composed

`dsh` is the upstream harness; this kit does not fork it. The running tree is a Cordis Loader
composition built from three layers at boot: the bundle layers (`@deepseek-ai/dsh-base`,
`@deepseek-ai/dsh-web-app`), the profile patch
(`$DSH_HOME/profiles/web/cordis.patch.yml`, written from `profile/cordis.patch.yml`), and zero or
more `--patch` overlays. Every layer is an entry list; later layers patch earlier ones.

Two kinds of rows exist in that tree. **Host rows** mount once for the whole process (taskboard,
test-cases, skills, research-first, proof-guard, rtk, Hindsight, tool-families, the orchestrator
policy, the MCP bridges). **Preset rows** are compositions: each `preset-*` declaration mounts its
own child plugins for sessions that select it. MCP tools are registered at the HOST before a preset
is chosen, which is why `@cc/dsh-tool-families` (a host row with per-preset allow lists) is the only
seam that can take them away from a role.

The system prompt is assembled from sections each plugin registers (persona, project instructions
from `AGENTS.md`, the root or child policy, the skill catalog, the state digest, the memory guide).
The root policy is rendered per session and frozen for a turn — a prompt change needs a new session
or a restart to be observed.


## 2. Map of the repository

### 2.1 Directories

| path | what it owns |
|---|---|
| `plugins/<name>/` | one plugin per directory (source, `client.js`, tests, README). Packed with `node scripts/pack-plugin.mjs --dir plugins/<name>`. |
| `profile/cordis.patch.yml` | the composition: host rows, role presets, tool families, model routes, MCP bridges. |
| `rules/` | `DEPLOYMENT.md`, the operating procedure. |
| `scripts/` | the tree gates (`check-*.mjs`), the proofs (`*-proof.mjs`), `pack-plugin.mjs`, `kit-update.mjs`, `state-merge.mjs`, `test-all.mjs`. |
| `docs/` | the durable contracts and guides (§2.3). |
| `docs/analysis/` | one JSON Analysis Record per initiative: business outcome, requirements, architecture, decisions, trace. |
| `docs/cases/` | the case library: one JSON per acceptance case, plus `runs/` artifacts (gitignored). |
| `designmap/pages/` | the system design map: one Excalidraw page per map; `designmap/logs`, `designmap/out` are agent scratch. |
| `state/` | the project ledger: `req/`, `task/`, `test/`, `views/`, `events.jsonl`. Generated views are not edited by hand. |
| `reports/` | agent evidence artifacts (gitignored); never a contract. |
| `tests/` | acceptance tests and drivers run by `make test` and the case library. |
| `.dsh/` | the workspace's runtime: `taskboard.json`, `rules.md`, session caches (gitignored except the board). |
| `Makefile` | `verify`, `test`, `cases`, `pull`, `provision*`, `session*`, `harness-guard*`. |

### 2.2 Commands you will actually use

```bash
make verify                  # tree gates: packaging, docs, glossary, role table, playbooks, schema, budget, identity
make test                    # every plugin test, acceptance file and proof script (stops at the first failure)
make test ONLY=taskboard     # one plugin's tests
make cases                   # run the case library (TAG=..., ARGS=...)
node scripts/kit-update.mjs --check [--json]   # what the installed machine is missing
node scripts/kit-update.mjs --apply --keep-model-config   # converge a machine (stop dsh web first)
node scripts/pack-plugin.mjs --dir plugins/<name>         # bump + repack + remove the old tarball
make pull                    # git pull + merge the ledger (state-merge.mjs); never pick a side
make provision               # check the pinned external binaries; make provision-apply installs them
```

Measurement and repair tools (none is wired into a gate; each is documented here so it has an
owner):

```bash
node scripts/audit-preset-composition.mjs   # per-preset composition: stated task, granted tools, first-request bytes
node scripts/tail-pruner-savings.mjs [days] # what the tail pruner would have saved on the recorded sessions
node scripts/normalize-eol.mjs [--check]    # repair CRLF in shipped source (check-portability detects it)
node scripts/taskboard-flake-probe.mjs [n]  # rerun the taskboard suite in parallel and name a flaky test
```

Run a long command in the background (`bash` with `run_in_background`, then `job_output`):
`make verify` takes ~2 minutes and `make test` ~70 seconds on this machine, and the default
`run_code` budget is 120 s.

### 2.3 Documentation ownership (one fact, one page)

The repository used to keep durable contracts and runtime records side by side; this page is the
rule that replaced that mess. **If a fact is not in its owner below, it is not documented — add it
to the owner, not to a new page.**

| page | owns | never |
|---|---|---|
| `README.md` | what the kit is, install, the per-plugin catalog, the doc map | procedures, proofs, dates |
| `docs/GUIDE.md` (this) | how to work here: layout, commands, tools, presets, deployment/verification principles, traps | per-plugin specs, dated results |
| `rules/DEPLOYMENT.md` | the normative operating procedure: fresh machine, update, rollback, checks, the rules of operating | per-plugin catalog |
| `docs/TERMINOLOGY.md` | the words a report uses (Russian/English) | technical specs |
| `docs/PRESET-PLAYBOOKS.md` | the per-preset playbook texts and the anti-pattern classes | deployment procedure |
| `docs/CASE-LIBRARY-BEHAVIOUR-DESIGN.md` | the case library contract: record, run, red/green, gates, provenance | deployment procedure |
| `docs/DESIGNMAP-V2.md` | the design map: page format, tools, panel, editing rules | plans and evidence |
| `docs/PRESENTATION-TOOLCHAIN.md` | the presentation/dashboard/diagram toolchain and its contract | everything else |
| `docs/analysis/<initiative>.json` | the design record and evidence trail per initiative | general rules |
| `docs/cases/<id>.json` | the observed acceptance cases | general rules |

**Versions in force:** harness pin `@deepseek-ai/dsh@0.2.2-rc.3` · Node ≥ 24 · pnpm 11.7
(corepack). The installers and `rules/DEPLOYMENT.md` carry the same pin; `make verify` fails when
they disagree.

**Runtime records are not documentation.** Dated audits, handoffs, proofs, plans, measurement
reports and session reviews are deleted from the tree: their evidence lives in the case library
(`docs/cases/`), the analysis records (`docs/analysis/`), `reports/` (gitignored) and git history.
A page whose truth expires in a week does not belong in `docs/`.

## 3. Tools the harness gives an agent

The tool list is per preset (§4); the families are:

- **Shell and files**: `bash` (or `pwsh`), `read`/`write`/`edit`, `glob`/`grep`, `outline` (a code
  skeleton: symbols with line ranges, first-line docstrings — use it before reading a big file),
  `working_directory`, `job_*` (background jobs), `read_image`.
- **Web**: `web_search`, `web_fetch` (resources only where the preset allows).
- **Skills**: `skill` loads a `SKILL.md` procedure; `skill_inventory`/`skill_grow`/`skill_evolve`
  manage the machine-wide library. A skill is a procedure, not a fact: facts live in the tree.
- **Taskboard**: `task_create`/`task_update`/`task_get`/`task_list`/`task_note`/`task_link`/
  `task_close`/`task_cancel`/`task_pause`/`task_resume`/`task_stop`, and `task_batch` for a set of
  operations in one step — the ledger of work in flight (§6).
- **Analysis** (root only): `analysis_read`/`analysis_upsert`/`analysis_check`/`analysis_impact` —
  the design record and its gates (§7.1).
- **Test cases** (per role): `case_record`/`case_update`/`case_run`/`case_suite`/`case_gate`/
  `case_list`/`case_get`/`case_verify`/`case_supersede`/`case_deprecate`/`case_drift` (§7.2).
- **Delegation** (root only): `delegate_task`, `delegate_review`, `subagent`, `send_message`,
  `list_agents`, `wait_agent`.
- **Design map** (orchestrator and architect): `map_list`/`map_read`/`map_lint`/`map_edit`/`map_render`.
- **Hindsight memory**: `hindsight_search_pages`/`hindsight_read_page`/`hindsight_reflect`
  (recall) and `hindsight_ingest_document`/`hindsight_capture_initiative` (write). Memory is a past
  record, not a live reading — check a claim against the code before relying on it.
- **Kit extras**: `codex_signin_start`/`status`/`cancel` (the ChatGPT subscription route),
  `delegation_brief` (renders a brief), `present` (declares deliverables), `ask_user_question`,
  `todo_write`, `create_goal`/`update_goal`, `skill_*`.

`run_code` runs a TypeScript program against those tools: it can call several tools, filter their
output and print only what matters. Its output is still a tool result — keep it small. The SDK
declarations are not printed in the prompt: a short header lists the visible modules and MCP
servers, and `sdk_api({ module } | { server } | { names })` called from inside a program returns
the exact declaration (the answer the prompt used to carry), so an unfamiliar tool is one call
away. There is no "show me everything" form: one reply is capped, and a larger selection is
refused with the sizes it would have cost.

## 4. Roles and presets

A **preset** is a tool list plus a persona; a **role** is a name the orchestrator resolves to a
preset (`ROLE_PRESETS`). Twelve declarations exist: `orchestrator` plus eleven working roles.

| preset | role names | what it is for | shell | notable tools |
|---|---|---|---|---|
| `orchestrator` | Orchestrator | root: shapes work, delegates, accepts | no | write/edit, taskboard, analysis, delegation, design map, cases (intake) |
| `architect` | ARCHITECT, SYSTEM-DESIGNER | one design decision on the expensive route (`gpt-6.2-sol`) | no | read/grep, web, design map, delegation (as root) |
| `ux` | UX/UI, DESIGNER | designs and proves an interface in a browser | yes | Playwright, present, PTC |
| `presenter` | PRESENTER, SLIDES | decks, boards, diagrams for a non-specialist | yes | presentation, dashboard, diagram, Playwright, PTC |
| `backend` | BACKEND, API | implements the change, proves with the product | yes | shell, case runner, PTC |
| `devops` | DEVOPS, DEPLOYMENT, OPS, SRE | owns the running deployment; one live task per chat | yes | jobs, web, case runner, no browser |
| `research` | RESEARCH | finds what exists outside the repo, cites it | no | papers, web, write |
| `gatherer` | CONTEXT, GATHERER | reads the current system, returns a `file:line` report | yes | read/grep/glob, no write/edit |
| `reviewer` | REVIEWER | judges a diff, runs it | yes | case gate, no write/edit tools |
| `critic` | CRITIC | attacks a running behaviour on a disposable copy | yes | no browser, no fix |
| `tester` | TESTER, QA | authors and measures the acceptance case | yes | full case surface, scoped write |
| `docs` | DOCS | keeps documentation true | yes | write/edit, web, cases |

Rules of the roster: a role label keeps ONE preset (`preset_conflict` otherwise); one role reuses
ONE live child session, so close a task (or attach with `taskId`) before the next brief; a role
outside the table needs an explicit `preset`; `AUDIT` is refused as a name (choose REVIEWER or
CRITIC). Tool families are enforced by `@cc/dsh-tool-families` allow lists in the profile, so a role
cannot use a family it was not granted — the brief cannot talk around it.

## 5. Deployment principles

### 5.1 The profile is composed at boot

`dsh web` composes the profile from bundle layers + `$DSH_HOME/profiles/web/cordis.patch.yml` at
boot. A plugin, a preset or a profile row is **not visible to an already-running server**: a change
needs a restart. Never edit the installed profile while `dsh web` runs — a re-compose can half-mount
the host and kill the session that is editing it.

`./start.sh` is the sanctioned boot: it runs `scripts/kit-update.mjs --check --fetch` and, with an
interactive stdin, applies the pending kit change before booting. `--apply` writes the profile files,
installs the packed tarballs and writes `rules/DEPLOYMENT.md` into `$DSH_HOME`. The boot wrapper
adds `--keep-model-config`, which preserves the machine's `agent-default-model` row
(provider/model/effort); a plain `--apply` overwrites it with the kit's values.

### 5.2 Tarballs, versions, and the old one

`node scripts/pack-plugin.mjs --dir plugins/<name>` bumps the patch version, packs
`plugins/cc-dsh-<name>-<version>.tgz`, **deletes the previous tarball** and updates the source
`package.json`. The installed profile's `package.json` keeps a `file:` reference to the version it
was installed with, so after a repack a machine must be converged (`kit-update --apply`) before its
next restart; the running server uses its installed `node_modules` until then.

`make verify` checks `tarball:matches-source` for every shipped package: a packed file that differs
from its source fails the gate. Test files are packed only if the plugin's `package.json` `files`
lists them (the orchestrator packs only the module and README).

### 5.3 What the gates can and cannot see

`make verify` reads the tree (paths, packaging, documentation, schema bytes); `make test` executes
it (plugin tests, acceptance tests, proof scripts). Neither boots a web profile. A preset that
composes in `--dump-config` can still fail to mount, and the only proof is a booted server whose
roster is read (§10, trap 1).

### 5.4 The live server and the second server

Rules for a change that must not break the live `:3080` deployment: never restart it from inside a
session it hosts; prove composition on a second server on a spare port with a copy of the profile
(or a `--patch` overlay); kill the proof server by PID, never `pkill -f "port <n>"` from the same
shell command (the pattern matches the shell itself). `script -qec "node ... --no-open" /tmp/log`
gives the process a TTY so the launch URL is printed; without one the URL never reaches the log.

## 6. The taskboard — the ledger of work

- Every change is a task: `task_create` (objective, scope, non-scope, acceptance, `steps`, `reqIds`
  or `reqId`), `active`, then `review` and `task_close` with `resultSummary` + `resultEvidence`.
  The close is refused without both, and refuses a task that is not in `review`.
- A task's **scope is a file claim**: entries that start with a path token (a file with its
  extension, a directory with its trailing slash) are checked; `delegate_task` refuses
  `scope_overlap` when an ACTIVE task claims the same file or a containing directory. Prose entries
  claim nothing, so write the paths first and the prose after them.
- Each chat has its own board. The workspace history is one paged read (`task_list` scope
  `workspace`); another chat's rows are read-only.
- A role reuses one child session. Close or attach before the next brief; a second role name for
  the same preset is a naming error, not a second seat.
- `DEVOPS` runs one live deployment task per chat (`devops_lane_busy`): a deployment is accepted
  before the next one replaces the runtime it measured.
- Acceptance evidence is the command, its output and the exit code (or one browser observation),
  not a child's summary. `task_close` on a child's word is how the board starts lying.

## 7. Acceptance: analysis, cases, and what counts as proof

### 7.1 The Analysis Record and its gates

An L1/L2 change starts with ONE record in `docs/analysis/<initiative>.json` (`analysis_upsert`):
business outcome (separate from the requested solution), process, requirements (BR/FR/NFR with
acceptance), architecture (components with an owner, contract impact), data, contracts, invariants,
decisions, trace. `analysis_check` must pass before `delegate_task` accepts a delegation with
`changeClass` + `analysisId` + `requirementIds` (the FR/NFR ids, not the REQ ids).

The record mirrors every requirement into the project ledger as a `REQ` row with criteria. A
requirement can be marked `proven` only when a `TEST` row covering it carries a passed red and
green run (`<runId>:red:fail` + `<runId>:green:pass`) — a green-only measurement is not a
verification. If the case surface is not mounted in your session, delegate the case to TESTER
rather than hand-editing the ledger.

### 7.2 The case library

A case is one observed behaviour, stored as `docs/cases/<id>.json`: `source: human` for a
requirement the owner stated (status unverified until a run measures it), `automated: true` with a
`testPath` + `runCommand` when it can be a test, `automated: false` + a named reason when it cannot.
`case_run` executes the stored command and records exit code, duration, command hash, the driver's
`CASE_SUMMARY` metrics and artifacts under `docs/cases/runs/`. A red run needs a negative control
(`CASE_NEGATIVE_CONTROL`) and, for acceptance, the **wrong product**: a copy of the previous
version, not the current tree with a flag flipped.

`case_gate` closes a task only when a case is automated, measured, not stale, and its author and
runner are not the preset that implemented the task — an agent cannot sign off its own work. The
gate reads the implementer preset from the case's own linked task row: a TESTER row that authors
and runs its case is refused `SELF_AUTHORED` even when the implementer was another seat.

### 7.3 What to run, per change class

| class | what it means | proof |
|---|---|---|
| L0 | a local fix with no contract/architecture/data change | run the product once, quote it |
| L1 | a contained feature inside the existing components | `make verify` + `make test`, a case when the behaviour is worth pinning |
| L2 | cross-component, contract, data, security, money, migration, concurrency | everything above plus an independent acceptance case (TESTER), red on the wrong product, then green |

## 8. Working rules

The rules are not written on this page. Their one owner is the `Development rules` paragraph of
`ROOT_POLICY` in `plugins/orchestrator/orchestrator.mjs`: every root session reads it on every step,
and it covers one owner per rule, a registered tool that is not yet a behaviour, a defect found by
running rather than reading, the smallest change that is complete, what you skipped, and the rule
that a change in the kit only counts once the machine is converged and restarted. A second copy here
would drift, and the copy nobody reads is the one that wins — so this page keeps §9 instead: the
traps each rule prevents. The long form of the smallest-change discipline is the `ponytail` skill,
loaded when the work is a code change. The orchestration half of the same policy (the taskboard,
batching, the runtime lane, scope as a claim) is in that text too, and is not restated here.

## 9. Traps measured here (each cost a retry)

These are the failures this repository produced in one day. The rule beside each is what prevents
the next one — they are the reason §8 points at the rules instead of restating them.

1. **A preset composes but never mounts.** `--dump-config` showed the row, the boot log was silent,
   the composer picker simply lacked it. Cause: `tool-todo` requires its config (`allowParallelInProgress`)
   with no default; a preset row missing a required plugin config fails the WHOLE preset mount.
   Rule: copy a neighbouring preset's rows verbatim (configs included), check the module's schema
   when writing from memory, and prove a preset by booting a profile copy and reading the roster
   (`[role=menuitem]`), not by `--dump-config`. If absent, bisect the plugin rows.
2. **A role spelling in the requirement was not a spelling in the code.** `OPS` resolved to
   `undefined` although the requirement named it; the independent case caught it in a green run.
   Rule: every spelling a requirement lists becomes a unit-test assertion; grep the role table.
3. **The case could not close its own verifying task.** `case_gate` reads the implementer preset
   from the case's linked task row; when TESTER authors AND runs the case, its own row is refused
   `SELF_AUTHORED`/`SELF_RUN`. Rule: link the case to the task that implemented the change (the
   `case_update` surface has no `linkedTaskId` today — propose it in §10 or close the verification
   row through the owner).
4. **A red measured on the current tree is not a red.** Acceptance evidence needs the wrong
   product: a copy of the previous version (`git archive HEAD` into `/tmp`, byte-verified), the same
   driver, exit 1. Rule: `case_run --red` against that copy with a negative control; never a flag
   that makes the current code fail.
5. **`make verify` exceeds the 120 s `run_code` budget.** It takes ~2 minutes. Rule: run it as a
   background job and read `job_output`; same for `make test`.
6. **`pkill -f "port 3082"` killed the shell that ran it** (the pattern matches the shell's own
   command line). Rule: `pgrep -f` then kill by PID.
7. **A proof server printed no launch URL** because its stdout was not a TTY. Rule: start it under
   `script -qec "node ... --no-open" /tmp/log`.
8. **The installed model default is machine-owned.** `kit-update --keep-model-config` preserves
   the installed `agent-default-model` row; plain `kit-update --apply` (and `./start.sh`) writes the
   kit's value. Rule: a per-role effort default belongs in `role-model` rules, not in that row, and
   a machine that must keep its route is converged with the flag.
9. **The same list lives in several files.** A new role touched `PRESET_IDS`, `ROLE_PRESETS`,
   `DEFAULT_ROLE_TOOLS`, `KNOWN_PRESETS`, the tool-families proof copy, `KIT_PRESETS`,
   `check-prompt-playbooks.mjs`, the role table and the procedure. Rule: when adding a role, grep
   for one existing preset id across the tree; every hit is a place to update.
10. **The packed tarball and the installed profile disagree after a repack.** The running server
    keeps its installed `node_modules`; the installed `package.json` still points at a deleted
    tarball until a convergence. Rule: repack, then `kit-update --apply` before the next restart.
11. **Another workstream's uncommitted changes sit in the same tree.** Rule: commit by explicit
    path and read back the staged set; never stage the whole tree, never revert a sibling's file.
12. **The root session may not receive the case tools** even though the policy describes them.
    Rule: check the tool surface (`typeof tools.case_record` in `run_code`); if it is absent, the
    case belongs to a TESTER delegation — do not hand-edit `docs/cases/` or `state/test/`.
13. **A prompt or persona change does not reach a running session** (its system prompt is frozen
    for the turn/session). Rule: activate with a restart; prove the new text on a second server.
14. **`analysis_upsert` arrays replace wholesale.** Sending `requirements` without the other rows
    drops them, and a trace task link cannot be removed from a ready record. Rule: always resend
    every row, keep the task links, and prove per milestone.
15. **`task_update` to `review` is refused `steps_incomplete`** unless `stepsDone` equals the
    number of `steps`. Rule: set `stepsDone` to the full count, then close.

## 10. Orchestrator proposals for this class of defect

The owner asked how the orchestrator preset should prevent this class: a rule that lives in two
places, a tool that exists while the behaviour does not, and a root that starts work without the
context it needs. Only some of it can be a prompt rule; the rest needs a deterministic gate. Each
proposal names its cost and the decision it needs.

**Deterministic (a script or a refusal can enforce it):**

1. **A preset-config schema gate (ADOPTED, 2026-11-27).** `scripts/check-preset-configs.mjs`, run
   by `make verify`: it parses the profile, resolves every preset plugin module from the installed
   harness and validates each row's `config` against the module's own schemastery `Config` without
   booting. It catches the required-config class of trap 1 (147 rows validated, 1 unverifiable,
   0 refused on the current tree; a profile with the devops `tool-todo` config removed is refused
   with `$.allowParallelInProgress missing required value`). It does NOT replace a real boot: a
   preset can still fail to mount for a reason no config schema sees. A full mount proof (copy the
   profile into a throwaway `DSH_HOME`, boot on a free port, read the roster, assert 12 presets, kill
   it) remains the stronger form and is still an open decision (cost: one server boot, ~20-30 s).
2. **A rule-ownership scan (proposed; the script does not exist yet).**
   `scripts/check-rule-owners.mjs`: for a short list of literals that must
   agree (preset ids, role spellings, model effort defaults, role tables), report every file that
   states them; a difference is a named finding. Cost: a list of owners to maintain + false
   positives; run as a warning first, then as a failure. Decision: which literals are worth
   guarding.
3. **Every documented role spelling is a test (ADOPTED, 2026-11-27).**
   `plugins/orchestrator/test/role-spellings.test.mjs` parses the §4 table and asserts that every
   spelling resolves to its row's preset, and that every child preset owns a row. It catches trap 2
   (the `OPS` class) on the next rename.
4. **A case can be linked after recording (ADOPTED, 2026-11-27).** `case_update` accepts
   `linkedTaskId`: the write keeps the compare-and-set, drops the recorded verification (the green
   artifact named the previous task, `RUN_MISMATCH`) and KEEPS the wrong-product red, so one fresh
   green re-verifies the case against the implementing task. Fixes trap 3 without hand-editing a
   case or a TEST row. Proof: `plugins/test-cases/test/relink.test.mjs`.
5. **A read-the-guide gate.** The first `delegate_task` or product `write` in a workspace that has
   `docs/GUIDE.md`/`AGENTS.md` is refused until that file has been read in the session (the read
   tool's event is the evidence). Cost: a small pre-execute guard, an escape hatch for a typo fix,
   and the risk of a refusal when the guide is not the missing context. Decision: enforce, or keep
   it a prompt rule.

**Prompt rules (cheap, not enforceable):**

6. **The guide is named in the root policy.** One line: before touching a repository you have not
   worked in this session, read its `AGENTS.md` and `docs/GUIDE.md`; name the rule you are following
   in the task note. Cost: a few hundred bytes per root; no enforcement.
7. **A context question before the first change.** The root states, in the task note, the three
   facts it relies on (which doc/contract owns the rule, which command proves the behaviour, which
   resource is shared). A missing fact becomes a CONTEXT brief instead of an edit. Cost: one extra
   sentence per task; no enforcement.
8. **The defect class is named in the development rules (ADOPTED, 2026-11-27).** The
   `Development rules` block in `ROOT_POLICY` carries one-owner, tool-is-not-behaviour,
   prove-by-running, the smallest complete change, what you skipped, and rule (f): a change in the
   kit is not in force until the machine is converged and the server restarted. Rules (a)-(c) name
   the measured shapes (a preset that mounted nothing, a role alias, a self-authored case). The
   guide keeps neither list: §8 is a pointer, and `scripts/check-documentation.mjs` refuses a copy.

**Where the current design already prevents it:** the tool-families allow list (a role cannot use
what it was not granted), the proof-guard write scope, the analysis gate (L1/L2 needs a record),
the case gate (independence and provenance), `tarball:matches-source`, and the one-live-deployment
lane. The proposals above are the missing half: context, mount, and the duplicate-rule scan.

## 11. Extending the kit

- **A plugin**: add `plugins/<name>/` with `package.json` + `README.md`; add an inventory row; mount
  it in `profile/cordis.patch.yml`; pack it; `make verify` (it checks the tarball agrees with the
  source, the inventory matches disk, and the mount is documented).
- **A preset/role**: load the machine skill `add-a-kit-agent-preset` — it carries the four places
  (profile declaration, orchestrator registry, analysis readOnly, docs/gates), the packed docs, the
  mount trap and the two-server proof.
- **A gate**: `scripts/check-*.mjs` and wire it into `make verify`; a gate must fail on a real
  defect (name the production change it catches) and pass on the current tree.
- **A case**: see §7.2; record one behaviour per case, prove it red on the wrong product, link it to
  the implementing task.
- **A skill**: `skill_evolve` with the exact steps, the failure it prevents and the session evidence;
  `skill_inventory` first so the library does not grow a duplicate.

## 12. Fresh machine, upgrade, rollback

The normative steps live in `rules/DEPLOYMENT.md`: §2 fresh machine (`./install.sh`, then
`./start.sh`), §3 update (`git pull`, `node scripts/kit-update.mjs --check`, `--apply`,
restart), §4 rollback (find the commit, check it out, converge on it, prove `drift: null`), §5
the checks, §6 the rules you must not break, §7 the first-run checks, §8 troubleshooting. This
guide deliberately does not repeat them.

**`dsh web` is the one command.** The `dsh` on `PATH` is the kit's wrapper
(`scripts/dsh-wrapper.sh`, installed as `$DSH_HOME/bin/dsh`): it converges the machine when the
port is free, refuses to boot a stale profile when a server is already up, and `dsh web --restart`
stops, converges when the kit differs, and starts. §3 of the procedure has the three paths and the
log file.

