# An agent's proposal is enough to work and not enough to become law

Date: 2026-09-15. Operator decision, taken in a session working on the ADR panel.
Scope: `plugins/ratchet/ratchet-guard.mjs` — the `tools/pre-execute` guard that makes
`requiresDecisionRecord` an enforced rule.

This file is the reasoning behind ADR 0017. It records the decision, the state the code
was in, and why the alternative was rejected.

## The problem, in the operator's words

> Agent proposed adr's should not be blocking (waiting for approval and blocking the
> workflow). Agent is allowed to implement outside the specs if that does not contradicts
> them (verified via ratchet), but its decisions do not become specs. This is crucial for
> autonomy. Agent can work for hour, and later dev comes and approves/changes agent adr's
> which then become laws in specs. But autonomy ends where agent proposes contradiction to
> the existing specs.

## What the code did instead

`loadDecisionState` built the set of zones that satisfy `requiresDecisionRecord` from
`resolved.active` only, with this comment on the line above it:

> Only decisions IN FORCE satisfy the requirement. A proposal is intent, not law:
> accepting it would let an agent write the ADR and then proceed unilaterally, which is
> the override the whole authority model exists to prevent.

So in a zone that declared `requiresDecisionRecord: true` and `agentAuthority:
proposeOnly`, an agent could write the decision record and then be refused every write
into the zone it named, until a human ratified. The record itself was cheap; the work it
described could not start. For a session that runs for an hour, that is the difference
between an agent that proposes and continues and an agent that proposes and waits.

Two facts made the reversal smaller than it looks:

- **A proposal already contributed nothing.** `compileLaws(resolved.active, config)` is
  called with the in-force set alone, so a proposed record adds no law, no check and no
  generated spec. "Its decisions do not become specs" was already true, mechanically, and
  remains true after this change — the guard's licence is not a force state.
- **Nothing detected a contradiction.** Compiling only the in-force set meant a proposal
  that contradicted a law already in force produced no signal at all until a human
  ratified it. "Autonomy ends where an agent proposes contradiction to the existing
  specs" had no enforcement point, so it was prose.

## The decision

A **proposed** decision naming a zone satisfies that zone's `requiresDecisionRecord`, with
two boundaries:

1. **Never in a `humanOnly` zone.** The compiler refuses an agent-authored record there
   even when a human ratifies it (`ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE`), so a proposal
   could never become law there. Letting it license a write would let an agent govern a
   zone the manifest reserved to humans by writing a file the ratchet then declines to
   activate — the override the old comment was right about, in the one place it applies.
2. **Never while it contradicts law in force.** A proposal that removes a law in force,
   or redeclares one under a different statement, refuses writes into the zones it names —
   including zones a decision already covers, because the point is to ask a human before
   working against what they ratified, and an existing decision does not make the
   contradiction go away.

The contradiction check is the **decidable** subset only. The guard runs before every
write and asks no model, so it cannot classify a contradiction that only a reader can see.
That residue is where the judge belongs, and `review_proposal`'s question was extended to
ask it explicitly. **That half is asked, not enforced**: a judge's answer is advisory and
is not persisted into anything the guard reads, so a semantic contradiction does not stop
a write today. This is recorded here rather than presented as done.

## Why the denial is recomputed rather than recorded

The first design kept a conflict file and cleared it when the proposal changed. Recomputing
the contradiction from the corpus on every write removes the state, removes the staleness
rule, and makes the stop self-clearing: editing a proposal so it no longer contradicts law
in force lifts the denial with no other action. A recorded conflict would also have needed
a rule for who may clear it, and that rule would have been the ratchet deciding a question
it exists to put to a human.

## The defect this work found on the way

The guard's decision-state cache was keyed on the decisions directory's own `mtime`, on the
reasoning that a record being "added, removed or replaced" moves it. Rewriting a file in
place does not touch its directory. So an agent that EDITED a proposal to remove the
contradiction it had just introduced stayed refused until something unrelated altered the
directory or the session restarted — a denial that the documented cure did not cure. The
signature is now the directory's entry listing, each name with its size and `mtime`, and
the guard suite fails if the in-place edit stops being noticed.

## Rejected alternative

**Require ratification for a governed zone, but let the agent keep writing elsewhere.**
Rejected because it is the same block with a narrower boundary: the zones an agent most
needs to change are the ones a decision already describes, so this would leave the rule
enforced exactly where it costs the most autonomy and useless exactly where it would
matter. The chosen rule lets the work proceed everywhere it does not fight a ratified
decision, which is what "implement outside the specs if that does not contradict them"
asks for.

## What a human still has to decide

The ADR is proposed. The laws it declares enter force only through a ratification, which
is the same route every other `shipped-plugins` decision here took — and the same route
the operator described for this very change: the agent proposes, a human later approves or
changes the record, and it becomes law then.

## What an independent breaker found afterwards (2026-09-15)

The guard change above was handed to a breaker with one named claim — that the guard returns
the correct verdict for every input. It falsified two things, both now fixed and both covered
by a test re-run against a reverted copy to prove the test fails without the fix.

**The law set was a second implementation of the compiler's.** `loadDecisionState` built its
in-force law map from a local loop over the active records that skipped `op: remove` and knew
nothing about the rule that an agent record may not retire a human-ratified law. Fixture: an
active human ADR declaring law `k`, a second active human ADR removing `k`, and a proposed
agent ADR redeclaring `k` with a different statement. `compileLaws` reports zero laws;
the guard refused the write for contradicting "law in force". The guard now reads
`compileLaws(resolved.active, config).bundle.laws`, so it cannot drift from the compiler —
the whole class of divergence disappears with the duplicate implementation.

**The decision-state cache did not key on the manifest.** It hashed the decisions directory
only, and re-read the manifest just to find `decisionsDir`. So an operator editing a zone's
`requiresDecisionRecord`, its `agentAuthority`, or `defaultAgentAuthority` got the previous
answer until something unrelated touched the corpus: a stale allow after asking for a denial,
a stale denial after lifting one. The cache key now carries the parsed config, which is exact
because `stateNow` had already parsed the file.

A third, latent gap was reported as out of scope and fixed anyway: `str_replace_editor` is a
real writer in this harness with a `path` argument, and it was absent from `WRITE_TOOLS`, so a
governed zone was open to it. A name-based allow-list only governs the names somebody wrote
down; a tool that is opt-in and not mounted in every profile is exactly the one whose omission
goes unnoticed.

## The four findings a second breaker made against the FIXED guard (2026-09-15)

**Zone membership was a prefix test while file selection used the project's glob matcher.** The
manifest accepted a zone path and then the guard ignored it: `paths: ["**"]` governed NOTHING
(the whole point of the zone), a wildcard in the middle of a path (`src/*/api/**`) matched no
file, and a wildcard inside a segment (`src/api/*.ts`) matched none either — while a trailing
single-star zone (`src/api/*`) DENIED a deeper path that glob does not cover. The matcher
therefore moved into `ratchet-schema.mjs`, the lowest module, where `zoneFor` and the
verifier's file selection can share it, and the verifier re-exports it so existing callers
keep working. Ranking is now the length of the literal run before the first wildcard, so
`src/auth/**` still beats `src/**`; a whole-repository zone has no literal run and ranks below
every named one — ranking it `-1` as well left it never winning, which is the same "declared
but governs nothing" failure in a new place, and the test caught it.

**A symlink made a governed zone reachable from a path that read as ungoverned.** `changedPath`
compared strings, so `staging/link` pointing at `src/auth` turned a write to
`staging/link/session.ts` into an ALLOW while the bypassed filesystem wrote through the link to
`src/auth/session.ts`. The path is now resolved — the deepest EXISTING ancestor through
`realpathSync`, with the tail re-appended, because a write creates its target and the target
usually does not exist yet — and a real location outside the project is "not the guard's
business", the same answer a lexically-outside path gets.

**A same-size rewrite with a restored mtime was invisible to the cache.** The key was
`name:size:mtimeMs`; a fixture that forced the mtime back made a proposal that contradicted law
in force stay allowed, and without any manipulation 400 same-size rewrites produced 30 stale
ALLOWs and 29 stale DENYs on this host. The key now carries `mtimeNs` for resolution and
`ctimeNs` because it is the one field a writer cannot set: restoring the mtime still moves the
inode's change time.

**A read through `str_replace_editor` was refused.** Governing the tool NAME denied
`{command: "view"}`, which is the one thing the guard's own decision 4 says must never be
refused. `view` is exempt; an unrecognised or missing command is still treated as a write,
because the safe reading of a command nobody recognises is that it might change the file.

Each fix has a test taken from the counterexample that motivated it, and each was re-run against
a copy with the fix reverted to confirm the test fails without it.
