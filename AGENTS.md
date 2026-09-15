# AGENTS.md — dsh-kit

Deployment kit for **DeepSeek Harness (dsh)** plus the **five plugins** this
deployment adds beyond upstream, across the user's machines (2× Linux, 1× Windows):
`@deepseek-ai/dsh-model-gate`, `@cc/dsh-context`, `@cc/dsh-kit-rules`,
`@cc/dsh-ratchet` and `@cc/dsh-adr-panel`. `plugins/inventory.json` is the single source of truth for that
set and for each plugin's provenance; `scripts/check-portability.mjs` fails when a
tarball, a mounted profile row, a source directory or a packing entry point disagrees
with it. Read `USERGUIDE.md` (per-machine setup/startup) and `COMPAT.md` (upgrade
gate + upstream API watchlist) before changing anything.

The kit ships each plugin's tarball and, for every plugin whose owning project is not
this repository, a read-only **source snapshot** beside a `SOURCE-NOTICE.md` that pins
what it was copied from. The build may still run in the owning project (the harness
checkout for `model-gate`); the snapshot is what makes the plugin reviewable here.

## What each artifact is and when to update it

The kit declares itself in `.dsh/project.json`: its languages, its verification
commands, the rules it claims with the command that fails when each is broken, and
the thirty-one records under `docs/adrs/` — as `node plugins/ratchet/ratchet-cli.mjs
compile` reports them: fifteen decisions in force, six proposed decisions awaiting a
human, nine approval records, and the superseded ADR 0007. Those figures are the
compiler's and they move every time a decision is made, so read them there rather
than here. Two tools read the manifest —
the `context_*` tools answer questions about the kit, and the ratchet checks the kit
against its own decisions.

| File | Role | Update when |
|---|---|---|
| `LIMITATIONS.md` | the state a new agent must read before changing anything: what is red and why, the decisions taken but unstarted, the limits of the mechanisms themselves, and the platform facts that explain surprising behaviour. A reading, not a contract — the artifacts win where they disagree | the gate's state changes, a decision is taken or landed, or a limitation is found or fixed |
| `.dsh/project.json` | the kit's self-declaration: languages, rules with `enforcedBy`, verification commands, scopes, zones | a rule, a verification command or a zone changes |
| `docs/adrs/*.adr.md` | the kit's architecture decisions: nine approval records, the superseded 0007, and — as `node plugins/ratchet/ratchet-cli.mjs compile` reports at the time of writing — fifteen decisions in force and six proposed decisions awaiting a human. **The per-record ids and counts are deliberately not maintained here**: they change every time a decision is made, and that command reads the compiled bundle, which is authoritative where this table is not. What matters is the RULE. A record whose zone lets an agent self-activate (0002–0006, 0009 in `kit-tooling`) enters force by its own declaration. A record governing `shipped-plugins`, which the manifest restricts to `proposeOnly`, enters force ONLY through a human ratification, and its frontmatter says `proposed` even then — which is why the count is read from the compiler and never from the frontmatter. An approval record binds one content hash per approved record: editing a ratified record or its approval voids the consent (`RATIFICATION_STALE`) and the law leaves force, so a change to either ships as a new amendment ADR for a human to ratify, never as an edit. A proposed decision is not blocking — it licenses the work it describes and adds no law | a decision is made; a human ratifies a proposed record |
| `docs/ratchet/sources/` | the reasoning each ADR cites, with a sha256 the ratchet verifies, plus the transcript of every ratification session | a decision's reasoning is added or changed (then update the ADR's hash with `ratchet hash`) |
| `plugins/*.tgz` | the built plugin tarballs (`model-gate`, `cc-dsh-kit-rules`, `cc-dsh-context`, `cc-dsh-ratchet`, `cc-dsh-adr-panel`). `cc-dsh-context` is packed from `plugins/dsh-context/` — the owning project is unreachable, see that directory's `SOURCE-NOTICE.md` | every shipped plugin change — rebuild/repack, then **commit** |
| `plugins/inventory.json` | the single source of truth for the shipped plugin set: one row per plugin with its package name, tarball prefix, provenance (`in-repo`, `reconstruction` or `snapshot`), source directory, optional `SOURCE-NOTICE.md`, packing entry point and whether it is mounted in the profile patch | a plugin is added, renamed, repacked elsewhere, or its provenance changes |
| `plugins/model-gate/` | **read-only source snapshot** of `@deepseek-ai/dsh-model-gate`, copied from the harness checkout and pinned by its `SOURCE-NOTICE.md`. It carries the authoring source AND the built `lib/` output the tarball ships, so `main` resolves and the package can be imported and packed here with no build step; regenerating `lib/` from `src/` is upstream's build and needs the harness toolchain. Read-only in the strict sense: the tarball is still produced by `scripts/rebuild-plugins.sh`, and an edit here is overwritten by the next re-copy | a harness upgrade moves the pinned ref (then re-copy src, tests and lib, and update the notice) |
| `plugins/kit-rules/` | source of `@cc/dsh-kit-rules`: contributes `$DSH_HOME/AGENTS.md` to the system prompt as a binding section, re-read per prompt assembly | the rules must reach the prompt differently (framing, precedence, source) |
| `plugins/ratchet/` | source of `@cc/dsh-ratchet`: the Ratchet v2 static layer (ADR schema, law compiler, deterministic verifier, state/reports/ledger, bootstrap, the `requiresDecisionRecord` guard) plus the dynamic layer (review, grilling agenda, ingestion, **batch extraction**, the advisory duplicate report) plus the **decision lifecycle** (the two decidable duplicate rules, the resolution a duplicate is drafted into, the resolution/retirement audits, and the deterministic contradiction-staleness fact) plus **ratification** (the human quiz, the transcription of its answer, and the hash-bound approval it writes), the `ratchetConsent` cordis service a non-agent surface reaches the same `ratify` operation through, and the `ratchet` CLI. The schema admits a `resolves: [id, id]` list on an ORDINARY record — there is no `type: resolution` — and the compiler audits it and requires a record a decision retired to say so (`validateResolutions`, `validateRetirement`). A resolution takes away force in exactly ONE of two ways — `op: remove` for a named law while its record keeps governing, or `supersedes` for a whole record, which then carries a terminal status — and a record asking for both is refused as `RESOLUTION_AMBIGUOUS`. `ratchet-dedupe.mjs` holds both the decidable duplicate rules the gate runs and the drafted `proposed` resolution that settles one, so the report and the draft cannot disagree. The tool surface is ten tools: `ratchet_ingest` is the entry point that measures the source, splits it on its headings when the cap requires it and drives one extraction per chunk, while `ratchet_ingest_batch` and `ratchet_ingest_source` stay registered because the two carry different attribution guarantees and a caller who needs the stronger per-sentence one asks for it by name; `ratchet_deduplicate` drafts a resolution and puts nothing into force. **Shipped since 2026-09-14: tarball `plugins/cc-dsh-ratchet-*.tgz` and a `ratchet` row in `profile/cordis.patch.yml`** | any ratchet behaviour changes (bump the version, repack, reinstall) |
| `plugins/ratchet/ratchet-falsify.mjs` | the **project-agnostic breaker**: `ratchet falsify --root <project>` breaks one generic invariant at a time (a hand-written approval, a law with no check, and the four file/text check kinds), runs the real verifier, and requires the expected problem code. It writes only inside the project's declared scopes plus the ratchet's own record dirs, reports an out-of-scope target without touching it (including one that escapes through a symlink, which `realpath` containment refuses), restores every mutation and the persisted verdict, and handles SIGINT/SIGTERM. A SIGKILL cannot be caught, so every mutation is journaled before it is written and `ratchet falsify --recover` (or the next run) repairs what a hard kill left behind. A check that cannot fail is reported `missed`. Exit 0 all detected, 1 any missed or errored, 2 unusable | a generic invariant or check kind is added, or the scoping model changes |
| `plugins/dsh-context/` | source of `@cc/dsh-context`, **reconstructed from the shipped tarball** — the owning project is not on this machine and the package is not on npm. Read its `SOURCE-NOTICE.md` before editing; if the owning project becomes reachable, it owns this package again | a change to the context plugin (then `node scripts/pack-plugin.mjs --dir plugins/dsh-context`) |
| `plugins/dsh-adr-panel/` | source of `@cc/dsh-adr-panel`, the deployment's web-UI window on ADRs and specs. The host `index.js` registers ONE route, `/adr-panel/consent`, on the `webServer` service, guards every request with the harness browser trust fence (`connection.requestRejection`) and a 32-byte capability minted per activation and published only as an index global, and calls the ratchet's `ratchetConsent` service — it builds no question and writes no file. The hand-written closure-factory bundle registers a session-header button, a `shell.overlay` window and a claim on the `conversation.composer` chain seat, and reads `docs/adrs` and `docs/specs` through the workspace file API — each record through the WHOLE-FILE read (`readAll`), because the API's paged `read` rebuilds a file's text by joining its lines and drops a final newline, so hashing it made seven ratified decisions whose last line ends in a plain LF read as `awaiting a human` while the ratchet had them in force; a record the whole-file read cannot serve is given no content hash and reported as unverifiable, never as unpaid. **Approve and Decline record the decision silently**: the row asks the route for the ratchet's own question, renders it with the record's own bytes and both of its labels, and posts back the label it was shown paired with that same question — no chat message, no model turn, no agent. For a question the ratchet asks through ANOTHER path (an agent calling `ratchet_ratify`) it claims the composer seat to SUPPRESS the harness's chat card and renders a pointer there — the decision's name and a way into the window — never the question, its record text or either answer label, which appear only in the window; a grilling session's question declares no panel intent, is not claimed, and is answered in the Conversation. No build step and no dependencies. Its README records the exact contracts and what was unverified without a browser | the panel's UI, its data path, its host route or its injected services change (bump the version and repack) |
| `scripts/pack-plugin.mjs` | the repack step for any in-repo plugin: derives the tarball prefix from the package name, bumps the patch version, packs, removes every other tarball for the package, prints the sha256. Refuses to overwrite an existing version, because pnpm serves an unchanged filename from the lockfile. `--dir plugins/<name>` selects the plugin; `--dry-run` reports without writing | the packing rule changes |
| `scripts/test-ratchet.mjs` | the ratchet's tests: schema, compiler, verifier, state, bootstrap, dynamic prompts, grilling agendas, ingestion, derived checks, **the decision lifecycle** (`resolves` and its three refusals, a resolution's removal authority, a resolution that removes a law or supersedes a record and never both, a standing block lifting when the challenged law leaves force, retirement statuses), **duplicate detection** (the deterministic command failing on a duplicate and staying silent on a merge and on many decisions from one source, the drafted resolution a duplicate becomes, that ratifying the draft settles it and the losing record keeps its other laws, a finding it cannot draft being reported, the advisory judge report over a corpus the command calls clean, and that neither the command nor the drafter loads a judge), **auto-ingestion** (the single entry point reading a one-chunk source in one call, a source above the cap being split on its headings and driven chunk by chunk, a span located only in another chunk being refused so the chunk is the scope, and the no-judge path returning the split unrun for the answers to resume), **batch extraction** (located spans, a refusal costing one record, the cap with its headings, proposed-only records, the distinct tool surface), **ratification and its falsifications** (including that a ratification leaves the generated law cards in step and that it does NOT overwrite a hand-edited one), verdict breaker regressions, verdict validation, tool declarations, and the gate's exit codes. Needs no RUNNING harness, no credentials and no model — but the tool-surface tests import `@deepseek-ai/dsh-tools`, so the checkout must be linked (`node scripts/dev-link.mjs`); without it the suite fails with one line naming that command rather than a module-not-found stack | any ratchet behaviour changes |
| `scripts/test-ratchet-guard.mjs` | the `requiresDecisionRecord` guard: what it refuses, what is exempt, what satisfies it, and that the cache notices a new ADR without a restart | the guard's rule changes |
| `scripts/check-portability.mjs` | mechanical cross-platform checks over shipped source — Windows-only paths, separator assumptions, CRLF in `.sh`/`.mjs`, bare-binary spawns — plus packaging: every module a plugin imports must be in its `files` list, every `plugins/inventory.json` row must agree with the tarballs, sources, `SOURCE-NOTICE.md`s, packing entry points, mounted profile rows and `README.md`, and every packed file must still match the source it was packed from (byte for byte, except a manifest, which is compared as a JSON document so a packer resolving `workspace:` ranges and reordering keys is not a defect), and a tarball whose bytes changed must carry a new version compared with the copy committed at HEAD (skipped, never passed, when git or the committed copy is unavailable) | the kit gains a platform assumption, a plugin gains a module, the plugin inventory changes, or a plugin is repacked |
| `scripts/check-consent-surface.mjs` | the consent surface as an enforcement point: no shell mint, no tool argument that accepts an answer, blocked decisions reported with their reason, retired decisions not queued. The answer-argument claim scans EVERY tool the plugin registers, not two named ones, and refuses an answer-shaped property unless it is the boolean `ratify` trigger; the route claim scans the whole registry for the consent route, its service, its header and its capability global, asserts the panel, its host half and the ratchet agree on all four, and DRIVES the provided consent service: a label with no quiz, a foreign quiz, a `humanOnly` zone, a replay and a stale text each mint nothing, and the question's own approve label writes the approval and its transcript. Prints `consent surface ok` | a consent-shaped claim moves from a function into the tool, CLI, service or route surface |
| `scripts/check-duplicate-decisions.mjs` | the DETERMINISTIC half of duplicate detection, as a repository-owned command the gate runs (ADR 0032): it reads the corpus and fails — exit 1, with a stable code — on one law statement text declared under two different law ids, and on one `source.hash` cited by two records that also declare a law id in common. A re-declared law with an IDENTICAL statement under one id is deliberately NOT reported (the compiler merges it into one law bound to the union of both records' zones) and neither are several decisions drawn from one source with disjoint laws, which is the shape batch extraction produces. A law an active record retires with `op: remove` is not counted, so settling a duplicate turns the gate green instead of red-forever. The two RULES live in `plugins/ratchet/ratchet-dedupe.mjs` and the drafting half applies the same ones, so the report and the draft cannot disagree about what a duplicate is. Exit 0 prints `duplicate decisions ok`; exit 2 when the corpus cannot be read, so "nothing was checked" is never reported as "nothing is wrong". It loads no review or judge module: duplicates that only meaning reveals are `ratchet_review --job review_duplicates`, an advisory report whose findings never reach this exit code, and a test pins that separation | a decidable duplicate rule is added or narrowed |
| `scripts/dev-link.mjs` | links the harness packages (`@deepseek-ai/dsh-tools`) beside `plugins/ratchet` and `probes/api-probe`, which is what lets the kit's own tests and gate run from a fresh clone. The DEPLOYMENT never needs it — an installed plugin resolves its peers through the profile — so it is setup, not a gate. `--check` reports without writing, and both installers run it | a module gains a harness import, or the harness layout changes |
| `scripts/normalize-eol.mjs` | repair for the detector above: a Windows editing pass (`Set-Content`, `WriteAllText`) writes CRLF into shipped source, and this rewrites it as LF. `--check` reports without writing | shipped source was edited on Windows |
| `scripts/check-gate-invariants.mjs` | the gate's own invariants, asserted **behaviourally**: a law nothing checks is reported, a check that cannot fail is refused where the decision is compiled, a deny is called inert only when disjointness is proven, a module does not "ship" because a list names it, output assertions read each stream as written, a hand-written approval mints nothing, editing an approved record voids its consent (`RATIFICATION_STALE`) and its law leaves force, the ratification question carries the record's own file text with only the exact approve label minting consent, a law removal is still reported after the ledger that recorded the law set is deleted, and the code hash moves when the code does. Prints `gate invariants ok`. It exists because a law's `outputContains: "fail 0"` was satisfied by a green run of a suite whose covering test had been emptied — a test name is not an assertion | an invariant's verdict changes, or another wrong verdict is found |
| `scripts/test-adr-panel.mjs` | the ADR panel's browser half, executed rather than merely parsed: it loads the shipped `plugins/dsh-adr-panel/client.js` through a stub module loader with a minimal React, drives `apply` with a fake client context, renders the overlay over the kit's real `docs/adrs` and `docs/specs`, and asserts the UX contract — the three reader-facing sections, states filled, provenance outlined, the awaiting-a-human state in the warn tone, no glob pattern in the chrome, and the `decided in` chip taking the tone of the record it names. It then drives the CONSENT PATH against a stub host for the panel's route and requires that a row's Approve and Decline ask the route for the ratchet's own question, render it with the record's own text and both labels, post back the ratchet's own label paired with that same question, show the outcome, report a refusal rather than a false success, fall back to the CLI command with no capability, and compose **no composer message in any scenario** (a spy on the only prop that could carry one). A synthetic corpus covers the states the real one lacks (a superseded decision, an unknown id). Both corpora are driven through the REAL transport shape — a paged `read` that rebuilds a file's text from its lines and drops a final newline, and a `readAll` that returns the exact bytes — and the test REQUIRES the waiting set the panel derives over the kit's own `docs/adrs` to EQUAL the set `ratificationQueue` reports, which is the function `ratchet pending` calls: the fixture cases are examples of the equality, the equality is the requirement, and it is what fails when a content hash stops being computed over the file's own bytes. Where the shell's theme can be found it also RESOLVES every toned pill's colours through it, in both variants, and refuses one whose text is painted in its own fill — a token name can be right while the theme's value for it makes the label invisible, which is how a solid `state-error-secondary` background hid the error label until this check existed. No browser and no model; the theme is read only if an installed harness carries one, and its absence is a `[SKIP]`, not a pass. Prints `adr panel render ok` | the panel's UI contract, its consent path, its colour palette or its bundle layout changes |
| `scripts/falsify-kit-gate.mjs` | the breaker: breaks one kit invariant at a time and requires the ratchet gate to fail. Six cases, each verified to have actually broken something before the gate runs — including a hand-written approval ADR, which must mint nothing. A release-gate command: it runs the whole gate once per case | an invariant is added, or the gate stops catching one |
| `probes/api-probe/` | throwaway plugin the API probe mounts over a scratch `DSH_HOME`; never shipped, and its `node_modules/` is a local junction to the harness packages. `review-probe.mjs` drives the ratchet's real review path against a fixture project; `ratify-probe.mjs` drives the ratification quiz through the user-questions channel with a stub answerer standing in for the human; `panel-consent-probe.mjs` drives the ADR panel's consent route over real HTTP, with a stub human posting the label the ratchet's own question offered | a harness API fact needs re-measuring, or a production path needs proving end to end |
| `scripts/probe-dsh-api.mjs` | API discovery and integration: builds a scratch home, mounts the probe rows, asserts the harness facts the ratchet rests on. `--probe-judge` spawns a judge child; `--ratchet-review` runs the ratchet's own review end to end; `--ratchet-ratify` runs the ratification quiz end to end; `--adr-panel-consent` mounts the real webserver, the real browser fence, the panel's host half and the ratchet, then drives the consent route over real HTTP (16/16, prints `adr panel consent route ok`); `--ratchet` boots the shipped plugin | a harness fact changes, or a new capability must be proven before it is designed against |
| `docs/RATCHET-API-FACTS.md` | the measured harness facts, each with its reproduction and the command producing it — including, in §2.7, that a host plugin serves a browser through a `webServer` route behind the connection trust fence, that a browser plugin cannot invoke a registered tool at all, that a consent names the surface that carried it, and the consent route's own 16/16 measurement | a probe result changes (then the quoted figures change with it) |
| `docs/RATCHET-V2-DESIGN.md` | the living design: module contracts, the one-way boundary rule, rejected alternatives, open questions. It deliberately carries no build status or test counts — those drift, and `scripts/ratchet-cli.mjs verify` and the suite are the current answer | a contract or the static/dynamic boundary changes |
| `docs/RATCHET-ASSESSMENT.md` | a point-in-time assessment of the ratchet as a product and as a mechanism, using this kit as the worked example: the business logic and the panel's UX, then an adversarial review whose findings are counterexamples with reproductions — the spec-drift guarantee disabled by this project's own `specsRequired: false`, a law removable in silence, a `humanOnly` zone escapable by declaring a different zone, a text check satisfied by prose, the documentation figures no command reads, the release gate never running `ratchet verify`, and the fix for the first three itself carrying two evasions an independent breaker found. **Findings 1–3 and 6 are fixed, and 7 records the two evasions in that fix and their correction** (ADR 0012, ratified by 0013; ratchet 0.2.11); 4 and 5 remain. **It is a reading, not a contract, and it is not maintained as one:** its figures are dated, and the artifacts win wherever they disagree. Its §3.11 lists the changes that would change its answers; each is a candidate decision record, not a patch | a new adversarial pass is run, or one of its findings is fixed |
| `profile/cordis.patch.yml` | canonical profile patch: the `agent-instructions` disable, `kit-rules`, `model-gate`, the `llm-deepseek` catalog row, `dsh-context`, `ratchet` and `adr-panel` | plugin ids/names, instruction routing, or the model policy change |
| `profile/package.json` | canonical profile manifest (bundles; **no deps** — installers add machine-local tarball paths) | bundle list changes |
| `profile/pnpm-workspace.yaml` | pnpm policy incl. `allowBuilds: node-pty: true` (pre-approves its build script) | pnpm policy changes |
| `rules/AGENTS.md` | the deployment's mandatory rules, installed to `$DSH_HOME/AGENTS.md` and injected by `kit-rules`. **Section 0 points at `$DSH_HOME/DEPLOYMENT.md`** as the procedure for setup, update, verification and troubleshooting, because the operator is an agent and a user guide is a file nobody opens | the rules themselves change (mirror `~/vibecoding/INSTRUCTIONS.md`) |
| `rules/DEPLOYMENT.md` | the agent-facing operating procedure, installed to `$DSH_HOME/DEPLOYMENT.md`: what this deployment is, the clone URL, fresh-machine setup, `kit-update.mjs --check/--apply`, running the kit's own gate (`dev-link`, the suite, `ratchet verify`), the rules that must not be broken while operating, and troubleshooting. `check-instruction-routing.mjs` fails when a script it names is missing, when the pin it quotes disagrees with the installers, or when the clone URL disagrees with `README.md` | a setup, update or verification step changes |
| `install.sh` / `install.ps1` | fresh-machine setup (Node ≥ 24 → pinned dsh → profile → plugins → rules → the dev links the kit's own gate needs) | harness pin, Node requirement, or setup steps change |
| `scripts/kit-update.mjs` | update path for an installed machine: content-hash drift check, profile/rules/rules write, tarball reinstall with a lockfile drop, pinned-harness install, machine state record in `$DSH_HOME/.dsh-kit-state.json`. A runtime older than Node 24 is refused before any read or write, because `start.sh` runs this script each boot with stderr swallowed and an old runtime made the failure silent | kit artifact layout or the convergence contract changes |
| `start.sh` / `start.ps1` | one-command startup (`dsh web --port 3080`) | port/launch changes |
| `scripts/verify-upgrade.sh` | upgrade gate: throwaway instance + composition/boot/installed-artifact policy probes | probe surface changes with the protocol |
| `scripts/probe-ratchet.mjs` | evidence for the ratchet brief: builds synthetic decision directories and prints what `ratchet_reconcile` hands the agent | the plugin's record reading changes (then `docs/RATCHET-DESIGN.md` quotes change with it) |
| `docs/RATCHET-DESIGN.md` | supervisor brief: harness/plugin/system-prompt context, the ratchet as built, its defects with reproductions, open design questions | the ratchet is redesigned, or a defect in Part IV is fixed |
| `scripts/session/session-log.mjs` | shared reader for stored session logs (concatenated zstd frames; usage on `assistant/message`) | the session file format or usage accounting changes |
| `scripts/session/session-report.mjs` | session diagnostics: record mix, prompt-size curve, cache share, compaction events, largest cache miss | session accounting changes, or the report needs another figure |
| `docs/SESSION-CONTEXT.md` | what the GUI's token counter means, how prefix caching makes long sessions affordable, what compaction this profile actually runs, and what long sessions do to cost, latency and quality | the profile's compaction wiring changes, or the model's window/pricing changes (then the quoted figures must be re-measured) |
| `scripts/rebuild-plugins.sh` | rebuild + repack from `~/deepseek-harness` (env `HARNESS_DIR`) | nothing — it is the update loop's front door |
| `COMPAT.md` | upstream watchlist (12 touchpoints, G10–G12 added for the ratification seam) + upgrade procedure | upstream API churn is detected (run its greps each upgrade) |
| `USERGUIDE.md` | per-machine setup, first-run checks, Windows notes, troubleshooting | any user-facing step changes |
| `REVIEW.md` | the out-of-repo context a reviewer needs: the machine it was verified on, the harness as an external dependency, the layout facts that explain apparent failures, this review cycle's decisions, the reproduction commands, and every remaining limitation. Not a contract — where it and an artifact disagree, the artifact wins | a review cycle changes the environment, the open items, or the reproduction steps |

## Hard rules

1. **Pins:** harness version exact (`@deepseek-ai/dsh@0.1.5-rc.1` in both
   installers), Node ≥ 24 on every machine.
   Bump all pins together and re-run the gate.
2. **The gate is mandatory:** `npm i -g @deepseek-ai/dsh@<candidate>` →
   `scripts/rebuild-plugins.sh` (checkout pinned to the candidate) →
   `scripts/verify-upgrade.sh` → only on PASS touch the live profile +
   restart. Never upgrade an unpinned dsh on a live machine.
3. **Do not commit machine-local state:** `$DSH_HOME/sessions`,
   `$DSH_HOME/storages`, `.credentials.yaml`, `settings.yaml`,
   `node_modules` — sessions are format-v0 with no compatibility promise.
4. **The kit's `profile/` files are canonical templates.** Machine profiles
   get absolute tarball paths written by the installer; never edit the
   machine profile and forget to mirror it here (and vice versa).
   `scripts/kit-update.mjs --check` is what detects the resulting drift: it
   compares content hashes, not version numbers, and refuses to let a machine
   that disagrees with the kit look converged.
5. **Tarballs live in this repo** — the deployment profile references
   `file:<kit>/plugins/*.tgz` paths; `/tmp`-only tarballs are how this broke
   before.
6. **Bump a plugin's version before repacking it.** pnpm resolves a `file:`
   dependency by path string, so an unchanged filename is served from the
   profile lockfile and the new bytes never land. The updater drops the
   lockfile and verifies installed bytes against the tarball, so a violation is
   reported as a warning instead of shipping quietly — but the fix is upstream
   of it, in the version bump. **The enforcement point is
   `node scripts/check-portability.mjs`**: its `tarball:matches-source` check
   fails when any packed file no longer matches the source tree, which is what a
   source edit without a repack leaves behind.
7. **The deployment rules come from this kit and nowhere else.** The profile
   patch disables the harness's workspace-instruction loader and mounts
   `kit-rules`, which reads only `$DSH_HOME/AGENTS.md`. Never re-enable that
   loader to "also pick up project instructions": its precedence model lets a
   repository override the rules that carry cost policy and remote-change
   permission. Project facts belong in `.dsh/project.json` and the `context_*`
   tools, where a rule names the command that fails when it is broken.
8. **Verify prompt-affecting changes on a throwaway profile before the live
   one.** A `kit-rules` change is invisible in `--dump-config` beyond the row
   itself; run a headless turn against a scratch profile and ask what the model
   received, because the failure mode (rules silently absent, or a stale plugin
   installed under an unchanged version) produces a boot that looks healthy.
9. **A gate is real only where a command fails.** Before claiming the ratchet
   (or anything else in this kit) enforces a rule, name the command that exits
   non-zero when the rule is broken. `node --test scripts/test-ratchet.mjs`,
   `node plugins/ratchet/ratchet-cli.mjs verify` and
   `node plugins/ratchet/ratchet-cli.mjs falsify` are the current answers for the
   ratchet; where there is no such command, the rule is an unverified claim and
   `docs/RATCHET-V2-DESIGN.md` §6.4 lists it as one.
10. **`plugins/dsh-context/` is a reconstruction, not the owning project's
    tree.** Edit it only through `scripts/pack-plugin.mjs --dir plugins/dsh-context`,
    which bumps the version (hard rule 6) and leaves one tarball behind. If the owning
    project becomes reachable, it takes the package back — see the directory's
    `SOURCE-NOTICE.md`.
11. **The kit is authored on Windows and deployed to Linux.** Run
    `node scripts/check-portability.mjs` before shipping any change to shipped
    source; it catches the assumptions that work everywhere the author looks. A
    module added to a plugin must also be added to that plugin's `files` list, or
    the checkout works and the installed copy does not.
12. **A decision enters force through a recorded human consent, and nothing else.**
    The ratchet asks the human through the harness user-questions channel, showing
    the record's own text, and writes an approval ADR whose `ratification` block
    binds one content hash per approved record. The consent covers the text the human
    was SHOWN: editing an approved record voids it (`RATIFICATION_STALE`), and so does
    editing it while the question is open. An approval with **no well-formed
    ratification block** confers nothing (`RATIFICATION_UNPROVEN`). There is
    deliberately no argument, no tool parameter and no shell command that accepts an
    answer you composed — a consent the ratchet cannot pair with a question it asked
    is one it cannot tell from a sentence an agent typed — so `ratchet pending` only
    lists what waits and the quiz runs in a session; `scripts/check-consent-surface.mjs`
    is what fails when any of that stops holding. **The residual gap, stated plainly:**
    a hand-written approval that reproduces the block correctly — channel, time, and a
    matching hash — is indistinguishable from a generated one, so an agent that writes
    that file can forge a consent. The same is true of one word in a record's
    frontmatter: `authority: human` makes an agent's decision self-activate in any zone,
    including one the manifest reserves to humans, because nothing verifies who wrote
    the file. Never do either, and never ask an agent to.

## Common workflows

- **Ratify a proposed decision:** `node plugins/ratchet/ratchet-cli.mjs pending --root .`
  lists what waits, with the content hash each "yes" would cover. The ratification
  itself happens in a session — call `ratchet_ratify`, answer the quiz, and the tool
  writes the approval ADR plus its transcript. Then compile, verify and **commit the
  approved record together with its approval**: an edit to either one afterwards
  voids the consent, so they are only meaningful as a pair.
- **Ship a plugin change:** for `model-gate`,
  `HARNESS_DIR=~/deepseek-harness ./scripts/rebuild-plugins.sh`; for any in-repo
  plugin (`dsh-context`, `kit-rules`, `ratchet`, `adr-panel`),
  `node scripts/pack-plugin.mjs --dir plugins/<name>`. Then reinstall on the machine
  (`cd $DSH_HOME/profiles/web && corepack pnpm add <kit>/plugins/*.tgz`) → restart
  `dsh web` → commit the new tarballs. `plugins/inventory.json` names each plugin's
  packing entry point.
- **Falsify a project's laws:** `node plugins/ratchet/ratchet-cli.mjs falsify --root <project>`
  breaks one generic invariant at a time and requires the gate to fail, then restores
  every mutation and the persisted verdict. It writes only inside the project's declared
  scopes; an out-of-scope target is reported, not touched. About a minute on this kit,
  because every applicable case runs the real gate.
- **Upgrade the harness:** follow COMPAT.md §2 (snapshot → candidate →
  rebuild → greps → gate → roll).
- **New machine:** clone → `./install.sh` (or `install.ps1`) → `./start.sh`
  → configure credentials in the onboarding → run USERGUIDE §3 first-run
  checks.
- **Existing machine (migration):** USERGUIDE §5 — re-add tarballs from the
  kit, refresh patch + rules, restart.
