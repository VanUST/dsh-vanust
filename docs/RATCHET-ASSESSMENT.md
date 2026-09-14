# Ratchet v2 in dsh-kit — an assessment

**What this document is.** An assessment of the ratchet as a product and as an
engineering mechanism, using dsh-kit as the worked example, followed by an adversarial
review whose job is to show where the mechanism does not hold. It is a point-in-time
reading, not a contract: every claim below names the command that produced it, and where
a figure could go stale it says when it was taken. The artifacts remain authoritative
over this document.

**How it was produced.** Measurements were taken on 2026-09-14 at commit `702ad49` (panel
`0.1.7`, ratchet `0.2.8`, harness `0.1.5-rc.1`, Node 24.20.0), on the Linux machine
described in `REVIEW.md`. The adversarial half was run twice over: by the author, and by
three independent breaker agents given one named claim and a declared scope each. Every
counterexample names its exact input, command, and observed-versus-expected result.

**What has happened since.** Findings 1, 2 and 3 were put to a human as ADR `0012` and
ratified by `0013`; they are now laws with behavioural enforcement points, and ratchet is
`0.2.9` (`f8a01d8`). A fourth defect was found while implementing them and is recorded
below as Finding 6. The readings in Parts 1 and 2 that the fixes did not touch — the
concentration of checks behind four commands, the advisory dynamic layer, the inert guard,
and the text-check weakness — still stand, and are the reason Finding 4 remains open.

---

## Part 1 — The product: the problem, the logic, and the interface

### 1.1 The problem it claims to solve

An architecture decision exists in three places at once, and they drift apart:

1. **the prose a human reads** — an ADR, a design note, a README sentence;
2. **the rule the code actually obeys** — a test, a lint, a boundary convention;
3. **the claim of enforcement** — the sentence "the adapter is the only module that
   imports the harness".

Nothing keeps the three in agreement. When the third sentence is written it is usually
true; a year later a second import has appeared and the sentence is still there, still
confident, and nothing fails. The failure is quiet by construction, because prose and
behaviour have no shared representation.

Call the observable symptom **spec drift**: the document that describes the system and the
system no longer describe each other, and the project cannot tell.

### 1.2 The mechanism, as designed

The ratchet's answer is to remove the second representation. A decision record carries its
enforcement with it:

- An ADR declares `laws`; each law has a `statement` and one or more `checks`
  (`command`, `required_text`, `required_text_glob`, `required_file`, `forbidden_text`,
  `forbidden_file`, `forbidden_text_glob`).
- `ratchet compile` turns the corpus into generated documents under `docs/specs/` that
  carry the record's content hash. The spec is derived, not written, so it cannot disagree
  with the decision it came from — it can only be out of date, which is a state the
  verifier can detect.
- `ratchet verify` evaluates every law deterministically and exits 0/1/2.
- **Zones** decide *who may decide*: each zone in `.dsh/project.json` names paths and an
  `agentAuthority` of `activeIfNoConflict`, `proposeOnly` or `humanOnly`.
- **Consent** covers the case the zone reserves: the harness user-questions channel puts
  the record's own text to a human, and the approval binds a hash of exactly the text that
  was shown. Editing the approved record afterwards voids the consent
  (`RATIFICATION_STALE`) rather than inheriting it.
- **Falsification** is the part most systems omit: `ratchet falsify` breaks a generic
  invariant on purpose and *requires* the gate to go red, so a check that cannot fail is
  reported `missed` instead of being counted as a guarantee.
- The **ADR panel** puts the corpus in the web GUI as a read-only window, with approval
  routed to the agent so that exactly one consent channel exists.

### 1.3 What it actually solves, and what it does not

**It does solve** the third-versus-second gap, inside the scope of the laws. Because the
spec is generated and each law names the command that fails, the sentence a human reads and
the command that enforces it are the same object. That is a real improvement over "there
are tests somewhere": the claim of enforcement is compiled, hashed, and evaluated.

**It does not solve**, and does not claim to:

- **Product behaviour.** These are architectural constraints. There is no requirement
  traceability to a ticket or an acceptance criterion; "the feature does what was asked"
  is outside the model entirely.
- **The strength of a check.** A law is only as strong as the command or the string
  behind it. A `required_text` check asserts a string is present, which is not the same
  as the behaviour it describes.
- **The substance of the reasoning.** The schema requires `## Context`, `## Decision`,
  `## Reasoning` and `## Consequences` to *exist*; nothing reads them. Boilerplate passes.
- **Being run.** Verification is pull-based. Nothing in this deployment executes `verify`
  unless a human, an agent, or a release gate chooses to. The guard that would force a
  decision record before a change is switched off in every zone — deliberately, and
  documented.
- **The law set shrinking.** See Part 3, Finding 1.

### 1.4 The interface

The panel's information architecture, read from the shipped bundle and the screenshots:

- A session-header button opens a frame-wide overlay. The header carries the title, the
  project name, the **bundle version chip**, a non-zero-only summary, `Reload`, `Close`.
- A **legend** keyed by family — `STATE`, `IN FORCE BY`, `RECORD` — drawn in the same shape
  the rows use, so it is a key rather than a separate vocabulary.
- **Decisions**: one card per record with its state, its provenance, a one-line summary,
  and expansion to the four sections plus the laws it decided.
- **Consents**: one card per approval record; deliberately offers no ratify action.
- **Specs**: one card per zone, with a check-kind histogram and a law card per law.

**What the design gets right.**

- The distinction that matters most — *what state is this record in* versus *how did it get
  there* — is encoded in **form**, not only colour: states are filled, provenance is
  outlined, derived states are dashed and italic. That survives a colour-blind reader and
  a theme change, which a colour-only encoding would not.
- Provenance is a **link** to the record it names when that record exists, and plain text
  when it does not — it never offers a link that goes nowhere.
- The chrome never leaks the parser: section headings are the reader's words with the
  resolved directory beneath, not the glob the directory was scanned with.
- The **version chip** is product-level thinking about a real failure mode: a
  revision-addressed client bundle served from a stale process is indistinguishable from a
  bug, and the chip is the only way a user in the GUI can tell them apart.
- The approve affordance is honest about what it does: it is labelled "Ask the agent to
  ratify", and the message it composes says *"Do not record a consent on my behalf."*

**Where the interface is weak.**

- **Scale.** It is one long scroll with no search, filter, or grouping. At nine decisions
  that is fine; at a hundred it is unusable, and this is the shape a project reaches after
  a year of decisions.
- **Scale, and reaching the actionable set.** It is one long scroll with no search, filter,
  or grouping. At nine decisions that is fine; at a hundred it is unusable, and this is the
  shape a project reaches after a year of decisions. The design does order awaiting-human
  records first and does render "N awaiting a human" as its own warn pill in the header, so
  the actionable set is not hidden — but there is no way to *filter* to it, and no way to
  jump to a record, which is what a reader with fifty decisions will want.
- **Approval is a detour.** Click → a chat message → the agent calls `ratchet_ratify` → a
  quiz in the conversation. The single-channel rule is right, but the user is not told
  where they are in that journey from inside the panel.
- **No diff, no "changed since you approved".** The system's central safety property is
  that editing an approved record voids its consent. The panel shows state and provenance
  but never shows *that a record was edited after approval* — the one condition the whole
  consent design exists to catch.
- **Two implementations of "in force".** The panel recomputes state by parsing the corpus
  client-side; the CLI is authoritative. The panel says so in its subtitle, which is
  honest, but a divergence is possible, and this is not hypothetical: the colour defect
  fixed in `49e1f61` shipped precisely because a rendering assertion passed on a token
  *name* while the rendered result was wrong.

---

## Part 2 — dsh-kit as a worked example

### 2.1 The corpus

Measured with the commands in §2.7.

- **11 records**: 8 decisions in force (0001–0006, 0009, 0010), 2 approval records (0008,
  0011), and 1 superseded (0007, retired by the human-ratified 0010).
- **19 laws, 20 checks**: 17 `command`, 1 `required_text`, 1 `required_text_glob`,
  1 `forbidden_text_glob`.
- **4 distinct commands** behind those 17 command checks: the test suite ×10,
  `check-gate-invariants.mjs` ×5, `check-portability.mjs` ×1,
  `check-consent-surface.mjs` ×1, memoised to one execution each.
- **Two zones carry laws**: `kit-tooling` (12 laws) and `shipped-plugins` (7).
- **Zone authority**: `shipped-plugins` is `proposeOnly`, `kit-tooling` is
  `activeIfNoConflict`, `deployment-rules` is `humanOnly`. Six of the eight in-force
  decisions were activated by an agent without a human ever seeing them — the kit states
  this itself, and it is the configured policy rather than an accident.

### 2.2 Verification works

```
node plugins/ratchet/ratchet-cli.mjs verify --root .
  → OK, 19 law(s), 20 check(s), 20 evaluated, 0 pending, 0 problems, wall 8.48s
```

Deterministic, offline, no model, no credentials, fast enough to run on every change.
`status` and `pending` behave as documented; `pending` reports "nothing is waiting for a
human" and refuses to offer a shell mint, with the reason.

**With one qualification that Part 3 establishes:** `verify` evaluates the laws, but in
this project it does not check that the generated specs still match the decisions they were
compiled from — so "verify is green" does not mean "the corpus and its documents agree".

### 2.3 Falsification works, and is the strongest part of the design

```
node plugins/ratchet/ratchet-cli.mjs falsify --root .
  → 3 detected, 0 missed, 3 skipped, 0 error
node scripts/falsify-kit-gate.mjs
  → 6/6 invariants failed the gate when broken
```

The three skips are honest: this project declares no `required_file`, `forbidden_file` or
`forbidden_text` law, so the generic breaker has nothing to break for them and says so
rather than reporting a pass. That is more than most test suites manage, and it is the
mechanism most systems lack — a check that cannot fail is the normal way a guarantee
quietly becomes a comment.

The best evidence for the whole thesis is this session's own work. The panel test asserted
that the "awaiting a human" pill used the warn *token*; the token name was right, the check
passed, and the rendered interface was broken — the error pill was filled with the same red
as its own label, so `rejected / withdrawn` and the `forbidden_text_glob` chips were solid
blocks with invisible text, visible in the user's screenshot. Only a check that resolves
the theme's *values* found it. That is exactly the failure the ratchet is built to make
loud, demonstrated on the ratchet's own product.

### 2.4 Consent works, and is testable

The ratification seam is proven end to end through its production code
(`--ratchet-ratify`), and the behavioural invariants are asserted in
`scripts/check-gate-invariants.mjs`: the question carries the record's own file text, only
the exact approve label mints consent, and editing an approved record voids it
(`RATIFICATION_STALE`) so its law leaves force. The CLI has no `ratify` verb and no
argument that accepts a caller-composed answer; `scripts/check-consent-surface.mjs` fails
if that stops being true.

### 2.5 The panel works

`node scripts/test-adr-panel.mjs`: 24 assertions, executing the shipped bundle offline and
resolving its colours through the installed theme in both variants.

### 2.6 The documentation has drifted, in the documents that say figures drift

`AGENTS.md` states of the design doc: *"It deliberately carries no build status or test
counts — those drift."* That claim is now false of `docs/RATCHET-V2-DESIGN.md` §10, which
carries exactly those figures — and they have drifted:

| §10 "Running the evidence" says | measured |
|---|---|
| 248 tests | **263** |
| portability and packaging: 13/13 | **15/15** |
| consent surface: 7 claims | 7 ✓ |
| instruction routing: 8 claims | **19** |
| gate invariants: 12 verdicts | **16** |
| 19 laws in force, **21 checks (18 command**, 4 distinct) | 19 laws, **20 checks (17 command**, 4 distinct) |

`AGENTS.md` quotes gate invariants as `16/16`, which is correct — so two documents in the
same repository disagree, and **nothing fails**. No law requires a document's figures to be
backed by a command, and no check reads them. The kit's own rule — *a rule is real only
where a command fails when it is broken* — is violated by its own documentation, which is
the precise failure mode the kit exists to prevent.

### 2.7 Two declared rules are unenforced, and one reason is stale

`.dsh/project.json` marks `flash-only-models` and `pin-the-harness` with `enforcedBy: null`
and a `pendingReason` saying the check is unbuilt. For `flash-only-models` that reason
looks out of date: `scripts/verify-upgrade.sh` already probes precisely this, and reports
`[ok] disallowed model vetoed, Flash model admitted` in a passing gate. So either the rule
should cite that command, or the reason is wrong — as written, `context_rules` reports the
policy as unenforced while the release gate enforces it.

### 2.8 Verdict on Part 2

The proposed functionality works — compilation, verification, falsification, consent and the
read-only panel all do what they say, on real data, with commands a reviewer can run. But
the drift guarantee it exists to provide is **switched off in this project**, and its own
documentation has drifted while saying that figures drift. Part 3 shows both, with
reproductions. The mechanism is sound; as deployed here it is a verification framework, not
an enforcement system.

---

## Part 3 — The critic

### 3.1 Method

The breaker role, applied as three independent assignments plus the author's own. Each
breaker was given **one named claim**, a **declared scope** (a copy of the repository under
`/tmp`, never the original), and the requirement to return **reproducible counterexamples**
— exact input, exact command, observed versus expected — or to report that it could not
falsify the claim and list what it tried. Breakers do not fix; they report.

*(Findings below.)*

### 3.2 Finding 1 — the spec-drift guarantee is disabled by this project's own manifest

**Claim attacked:** "A decision record edited without regenerating its compiled spec is
caught, so a generated spec cannot silently drift from the decision it was compiled from."

**Verdict: counterexample, and it is the most consequential one here.**

```bash
cp -a /home/iustimov/dsh-kit /tmp/br-repro && cd /tmp/br-repro
sed -i 's/at a call site is a defect\./at a call site is always a defect\./' \
  docs/adrs/0002-problem-codes-are-stable.adr.md
grep -c 'at a call site is a defect' docs/specs/kit-tooling.spec.md   # 1 — the doc is now stale
node plugins/ratchet/ratchet-cli.mjs verify --root . ; echo "EXIT=$?"
#   ratchet verify: OK ... no problems ; EXIT=0        <-- expected SPEC_OUT_OF_DATE, exit 1
```

`ratchet status` *does* report `SPEC_OUT_OF_DATE`, exit 1 — so the information exists and
`verify`, the gate, ignores it. Deleting a spec entirely is equally silent (verify exit 0),
which contradicts `docs/RATCHET-V2-DESIGN.md` §6.6 verbatim: *"Deleting a tracked spec is
still `SPEC_OUT_OF_DATE`."*

The strongest variant needs no deletion at all: edit an ADR, then run
`ratchet compile --root .` **without** `--write`. The new bundle is persisted while the
document is not regenerated, after which **both `verify` and `status` exit 0** over a spec
that visibly disagrees with its decision.

**Root cause** (read, not patched): `plugins/ratchet/ratchet-state.mjs` — `tracksSpecDocuments`
returns false as soon as `ratchet.specsRequired === false`, so the on-disk clause §6.6
describes is unreachable. `plugins/ratchet/ratchet-ops.mjs` then hands `specDriftProblems` a
substitute object that drops both `missing` and `stale`, and `verify()` never calls
`comparePersistedBundle` at all — only `status()` does.

**It is a configuration bug with a one-line fix, and the fix is measured:** with
`"specsRequired": true`, the same ADR edit produces two `SPEC_OUT_OF_DATE` problems and exit
1; with the key removed entirely, likewise. The mechanism works. This project sets it to
`false` while committing two generated specs.

### 3.3 Finding 2 — a law can be removed, silently, and the whole release gate stays green

**Claim attacked:** "The law set is the agreed set of constraints; removing one is a change
that requires a decision."

```bash
cp -a /home/iustimov/dsh-kit /tmp/law-removal-gate && cd /tmp/law-removal-gate
# delete the second law block from docs/adrs/0006-… (an agent-activated record)
node plugins/ratchet/ratchet-cli.mjs compile --root . --write
node plugins/ratchet/ratchet-cli.mjs verify --root .    # OK, 18 laws, 0 problems
PORT=3099 bash scripts/verify-upgrade.sh                # GATE PASS — all 15 probes green
```

Nineteen laws became eighteen, a constraint that the code must satisfy simply stopped
existing, and nothing in the kit — not `verify`, not the release gate, not the ledger —
reports it. The ledger records `checksEvaluated` and a `specHash`, both of which change, but
nothing *fails* and nothing records *what* changed; the previous law set is not retained, so
a retirement and a deletion are indistinguishable in every artifact.

**Scope, measured both ways.** Removing a law from a **human-ratified** record is caught:
`RATIFICATION_STALE`, exit 1, because the edit changes the text the human consented to.
Removing one from an **agent-activated** record is silent — and six of this project's eight
in-force decisions are agent-activated. The protection tracks *ratification*, not
lawhood, so precisely the six decisions no human ever saw are the six whose constraints can
be removed without trace. The declared `op: remove` path produces the same artifacts as the
deletion, so the auditable route and the silent one leave identical evidence.

**Fixed by ADR 0012, with two limits worth stating.** Compile and verify now record the law
ids they observed in the append-only ledger and report any id that was in force and is gone
without an explicit `op: remove`; the recorded set is held rather than advanced while an
unexplained removal stands, so the problem persists across runs rather than being certified
one command later. The limits: the guarantee starts from the first run that records a set,
so a clone with no ledger has no history to compare against until it has verified once; and
the ledger is a single shared file, so two interleaved runs could observe a law set
mid-flight — the same "no single runner" limitation `ratchet falsify` already carries. The
check makes that visible rather than silent: `ratchet falsify` now reports an extra
`LAW_REMOVED_WITHOUT_DECISION` during its own run, because its harness restores the record
it created before it restores the ledger, and the transient disappearance is real.

### 3.4 Finding 3 — a human-only zone is escapable by declaring a different zone

**Claim attacked:** "A zone the manifest reserves to humans is genuinely reserved: an agent
cannot put a decision into force that governs `deployment-rules` without a human consenting."

**Verdict: counterexample — and not the already-admitted `authority: human` gap.**

Authority is decided *only* by the `zones:` list an ADR declares in its own frontmatter
(`ratchet-compiler.mjs`, `zonesForRecord`). Nothing cross-checks the paths a law actually
enforces against the zone its record declares, so an agent-authored record can declare the
permissive `kit-tooling` zone and ship a check that governs a `humanOnly` path:

```yaml
author: { authority: agent }
zones: [kit-tooling]                      # activeIfNoConflict
laws:
  - op: upsert
    id: breaker.reserved-path-probe
    checks:
      - { type: forbidden_text, paths: [rules/AGENTS.md], pattern: "…" }
```

`verify` exits 0, the law is in force with `approvedBy: null`, and it genuinely governs the
reserved path — appending the forbidden token to `rules/AGENTS.md` then turns the gate red
with `CODE_TEXT_FORBIDDEN_PRESENT`. The same record declaring `zones: [deployment-rules]`
is correctly refused with `ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE`.

### 3.5 Finding 4 — a text check can be satisfied by prose, and evaded by a spelling

**Claim attacked:** "Every law in force is a real constraint: if the behaviour a law
describes is violated, `verify` exits non-zero."

`shipped-plugins.no-harness-import-in-logic` forbids any module under `plugins/ratchet`
except `ratchet-tools.mjs` from importing the harness. Appending this to
`ratchet-dynamic.mjs` leaves the gate green:

```js
export async function reachHarnessDirectly() {
  return import('@deepseek-ai/' + 'dsh-tools')
}
```

The module genuinely loads the harness (23 exports, proven at runtime), the law's intent is
false, and the `forbidden_text_glob` pattern never matches because the specifier is
assembled from two literals. The companion law's check is worse: its
`required_text_glob` pattern is the *phrase* `"never imports the harness"`, which the file
satisfies by containing that sentence **as prose in a comment**. A check satisfied by a
comment is not a check.

### 3.6 Finding 5 — the documents that carry figures cannot fail

`docs/RATCHET-V2-DESIGN.md` §10 quotes counts that no longer hold (rendered in Part 2 §2.6:
248 tests against 263, 13/13 against 15/15, 8 claims against 19, 12 verdicts against 16,
21 checks against 20). `AGENTS.md` quotes the correct figure for the same checker, so two
documents in one repository disagree — and no law requires a document's figures to be
backed by a command, so nothing fails. Separately, the `pendingReason` for
`flash-only-models` says the check is "unbuilt" while `verify-upgrade.sh` probes exactly
that and reports it green.

### 3.7 What survived

Reported because a breaker that only lists failures cannot tell a weak check from a strong
one:

- **Hand-editing a generated spec** → `SPEC_HASH_MISMATCH`, exit 1.
- **Zone authority, when declared honestly** → an agent record declaring `humanOnly` is
  refused; an unknown or deleted zone falls back to the safe default (`proposeOnly`); an
  agent record removing a human-ratified law is refused (`LAW_REMOVE_UNAUTHORISED`).
- **Consent binding** → editing an approved record voids the consent (`RATIFICATION_STALE`)
  and its law leaves force.
- **The verifier's anti-vacuous guards** → a glob that matches nothing, and a path set
  reduced to nothing, are both reported rather than passed. This closes the most obvious
  way to defeat a filesystem check, and it held under direct attack.
- **`shipped-plugins.judge-is-injected` end-to-end** → renaming the injected parameter
  (leaving the doc comment intact) satisfies the text check, but six tests fail and the
  gate goes red, because the law also carries a command check. **The text half is weak; the
  law is not reducible to it.** This is the pattern the other text checks lack.
- **The falsification machinery itself** → `falsify` reports `missed` rather than a pass,
  and `falsify-kit-gate` turns the gate red in 6/6 cases.

### 3.8 Finding 6 — the release gate never ran the verification it was the gate for

Found while confirming that Finding 2's fix held end to end. `scripts/verify-upgrade.sh`
probed fifteen things — portability, the consent surface, instruction routing, the panel,
the gate's own invariants, the suite, the CLI's exit codes, composition, boot, the model
gate — and **never once ran `ratchet verify`**. So a corpus with a law deleted still
produced `GATE PASS`, one command after `verify` called the same corpus a problem:

```bash
cp -a /home/iustimov/dsh-kit /tmp/law-gate2 && cd /tmp/law-gate2
# delete a law block from an agent-activated record, then
node plugins/ratchet/ratchet-cli.mjs compile --root . --write   # exit 1, LAW_REMOVED_WITHOUT_DECISION
PORT=3097 bash scripts/verify-upgrade.sh                        # GATE PASS   <- before the fix
```

The design document's §6.5 says "the kit ratchets itself, with 19 laws in force and a
passing gate". Those were two facts about two different commands, presented as one, and
nothing tied them together. The gate now runs `verify` over the kit's own corpus and fails
with the same deletion (`GATE FAIL`), which is what makes the sentence true.

The finding generalises past the omission: **a gate composed of probes does not verify the
thing the probes enforce.** Everything the gate asserted was a command in `scripts/`, while
the laws those commands back were checked only by a command nobody had wired in.

### 3.9 Why it does not work — the synthesis

The findings are not five unrelated bugs. They are one property, seen five times:

> **Every guarantee in the ratchet is self-declared by the artifact it governs, and nothing
> cross-checks the declaration against the thing declared.**

- A record declares its own zone, and the zone is trusted over the paths its laws touch.
- A law declares its own check, and the check's strength is never questioned — a phrase in
  a comment counts the same as a behavioural assertion.
- A spec's tracking is declared by a manifest flag, and the flag is trusted over the
  generated specs committed beside it.
- The law set declares itself complete, and no artifact remembers what it used to contain.

On top of that, enforcement is **pull-based and unguarded**: every zone sets
`requiresDecisionRecord: false`, so nothing compels a decision record; nothing schedules
`verify`; and the guard that would make the ratchet a gate rather than a habit is inert by
configuration.

So the honest answer to "does it solve spec drift?" is: **the mechanism can, and in this
project it does not.** With `specsRequired` left unset or true, a stale or deleted spec is
caught (measured). With it false — as shipped — `verify` passes over a spec that visibly
disagrees with the decision, and the release gate passes. The ratchet reliably answers *"is
this claim false right now?"*. It cannot answer *"is this still the claim we agreed to?"*
or *"was a claim removed?"*, because nothing it stores carries that.

**The residual trust is a human reading the diff** — which is exactly the thing the project
set out to mechanise. The design doc half-admits this ("an agent editing both the module and
the script that checks it still passes"). The findings above show the admission is too
narrow: the agent need not touch the module or the script at all. It can remove the law, or
re-aim a law at a reserved path by relabelling its zone.

### 3.10 What would change the answer

Ordered by effect per unit of effort, each one a candidate decision record rather than a
patch to apply blindly. **Items 1, 2 and 3 were put to a human as ADR `0012`, ratified as
`0013`, and are now law with behavioural enforcement points (ratchet `0.2.9`, `f8a01d8`),
together with Finding 6's missing gate probe; item 6 was corrected as a stale statement
rather than decided; items 4 and 5 remain open.**

1. ~~**Turn spec tracking on** (`ratchet.specsRequired: true`), or implement §6.6's on-disk
   clause in `tracksSpecDocuments`.~~ **Done both ways:** the clause is implemented, a stale
   or edited document is always reported, and the kit requires specs so that deleting the
   last one is drift too.
2. ~~**Derive a law's zone from the paths it governs**, or refuse a law whose check targets a
   path outside the zone its record declares.~~ **Done:** the cross-check refuses the
   escape, and the corpus was audited first so it stayed green.
3. ~~**Make the law set itself a tracked artifact** — fail when a law that was in force
   disappears without an explicit `remove` recorded in a decision.~~ **Done**, in the
   append-only ledger, with the recorded set deliberately held while an unexplained removal
   stands.
4. **Treat `required_text` as a smell in review.** `judge-is-injected` shows the good
   pattern: the text check is a hint, the command check is the constraint. A `required_text`
   whose pattern is a sentence is not a check at all. **Open by choice:** the operator's
   reading is that the semantic verification for "violates the intent where no check catches
   it" is the dynamic layer's `review_change` job, which exists and is confirmed by
   execution but is advisory by construction, so this class is mitigated by review rather
   than by a rule.
5. **Give the figures an enforcement point, or delete them.** No document count should be
   in prose that no command reads. **Partly done:** the design document no longer quotes a
   figure it cannot own, but nothing yet fails when a document's numbers go stale.
6. ~~**Decide `flash-only-models`:** cite the gate probe that already enforces it, or say
   plainly that the policy is unenforced.~~ **Corrected:** the `pendingReason` now names the
   gate probe that exists and says what is still missing, which is a check that the veto is
   installed outside the throwaway profile.
7. **Run `verify` inside the release gate** (Finding 6). Done — the probe now exists, and
   the gate fails on a deleted law.

None of these was a rewrite. The framework underneath them is sound, and the falsification
discipline that found them is the reason to believe that.

