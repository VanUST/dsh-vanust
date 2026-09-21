# The critic findings, and the three calls they force

An adversarial critic over the whole ratchet design produced twenty findings
(docs/CRITIC-RATCHET.md). Seventeen have one obvious correct answer: a check whose oracle
is the thing under test must derive its expectation independently, a law that names a
verification and has no test behind it must get the test, a note that describes a
mechanism the code does not contain must be corrected to the mechanism that exists, and a
production behaviour that contradicts its own law must be fixed in the code. Those need no
decision: the law already states the intended meaning, and the finding is a defect against
it.

Three do need a decision, because the law as written is satisfied by more than one
implementation and the corpus does not say which.

**1. Which authority wins when two records declare one law id.** The compiler merges two
declarations of an identical law id and statement into one law, unions their zones, and
keeps only the FIRST declarer's `approvedBy`. So a human-ratified declaration and an
unratified one of the same law produce opposite verdicts depending on which ADR file is
numbered lower: with the unratified declarer first, the merged law carries no ratification
and a later agent-authored record may retire it with no problem reported. The authority to
undo a ratification must not depend on file order. Of the candidate rules — first declarer
wins, last wins, the union refuses all removal, the most restrictive wins — the most
restrictive is the only one that cannot dilute a consent. A ratification is a human act;
an unratified twin of the same law is not evidence that the human changed their mind. So
the merged law carries the STRONGEST authority any declarer had: `approvedBy` is the
ratification if any declarer has one, and `authority` is `human` if any declarer is
human-authored. The consequence is deliberate and narrow: a law declared by both a ratified
and an unratified record can be removed only by a ratified or human-authored record. An
agent that wants the law gone must ask a human, which is the same answer the corpus already
gives for any ratified law.

**2. What a judge's contradiction block refuses.** The guard refuses a write when the
target's zone id is in the contradicted law's zone list. A zone is a coarse area; a law
inside it may govern a narrower set of paths. A law that governs `src/org/alpha/**` and is
judged contradicted therefore refuses `src/org/beta/**` as well, and a block that stops
work it has no finding about destroys the credibility of the block itself. The block is
scoped to the paths the law claims: when the contradicted law declares path-scoped checks
(`required_glob`, `forbidden_glob`, or `path_boundary`), only a target under those paths is
refused; when it declares none, the whole zone is the law's claim and the whole zone is
refused. The fallback is the zone, because a law with no path claim governs everywhere its
zone reaches, and a narrower fallback would let a finding be dodged by moving the file.

**3. Whether a non-reproducible suite may enforce a law.** The work-modes suite admits a
delegation, emits one start edge and waits a fixed 20 ms before asserting that the slot was
released. Four of five consecutive runs on one unchanged tree exit non-zero, and the
failing assertion alternates between the two that sit either side of the release race: "a
run whose turn settled releases its slot" and "a run that is still live keeps its slot".
Under either timing exactly one of the two can hold, so the suite is not measuring the
mechanism; it is measuring the clock. A gate whose colour is luck teaches people to re-run
it until it passes, which is worse than no gate. The decision is that the suite must await
the actual release — the harness emits `subagent/end` per activation epoch, and the test
must drive a real settlement and await the edge rather than sleep — and that a law is never
bound to a suite that cannot be made deterministic. If the seam cannot be awaited, the law
stays `unenforced` with the measurement recorded, because an honest gap is worth more than
a green light that depends on scheduling.

## Two notes that describe a mechanism the code does not contain

A ratified record is frozen, so a wrong note inside one cannot be edited: it ships as an
amendment that retires the law id and restates it under a new one. Two such notes are
restated here.

**`shipped-plugins.the-panel-records-no-consent-of-its-own`** says its mechanical half holds
today because "the bundle reads through `workspaceFiles.list`/`read` and writes nothing".
The shipped bundle (`plugins/dsh-adr-panel/client.js`) contains no `workspaceFiles` at all;
its only data paths are the three host routes `/adr-panel/state`, `/adr-panel/consent` and
`/adr-panel/resolve`. A note that names a mechanism the code does not have is worse than no
note: it is exactly what the next reader goes looking for, and finding nothing, distrusts the
law rather than the note. The restated note says what the bundle does instead.

**`shipped-plugins.the-question-seam-is-measured-from-the-panel-host`** says nothing has been
measured yet. Something has, and it is recorded in `docs/RATCHET-API-FACTS.md` §2.5 with its
reproduction: a plugin TOOL BODY reaches the Agent-scoped `ctx.userQuestions` with a live root
agent and gets an answer, which is the seam the ratification path uses. That is not the
panel's host half, which is the fact the law gates the UI on — but the panel host does not
need the seam directly, and that is the answer to the law's question: the consent route calls
the ratchet's `ratchetConsent` service, which calls the same `ratify` operation the
`ratchet_ratify` tool calls, and `ratify` is what asks. The panel host reaches the seam
indirectly and never reads `ctx.userQuestions` itself, so no agent-side companion is needed.
The restated note records that, and names the half still unenforced by a command: nothing
executes the panel host's route to prove it holds that shape.
