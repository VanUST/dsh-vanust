# Design session: human ratification for the ratchet

Date: 2026-09-14. Participants: the user (who owns the deployment) and an agent
working in the kit.

## The problem

The ratchet compiled agent-authored decisions into laws without ever asking the
human. Worse, the refusal was only a report: a record that declared itself
`status: active` in a zone whose policy says `proposeOnly` was listed as a problem
*and* enforced anyway, so the gate told the reader the decision had no authority
and then checked the code against it. ADR 0001 has sat in `proposed` since it was
written, because it governs `plugins/**` where agents may only propose, and no path
existed for a human to say yes.

The deeper problem is that a file cannot prove who wrote it. An agent can write
`authority: human` into an ADR, and no reader can tell that from a decision a human
typed. "A human approved this" was an assertion the ratchet printed and nobody could
check.

## What was considered, and rejected

**The harness approval seam (`ctx.approval`).** The harness ships a real one-shot,
fail-closed approval channel with an audit pair and a Web client that renders a
prompt. It was rejected as the mint because the deployment's permission preset is
`danger-full-access`, whose bundled approval policy is `never`: in the sessions
where this work happens, an approval request is rejected deterministically before
any answerer is consulted, and the mechanism would have been inert exactly where it
was needed. Making it work would have meant changing the permission preset of every
machine, and the seam carries no tool arguments — the human would see a tool name
and a reason string rather than the record being approved.

**Signing the consent with a key.** A machine-local key the human unlocks would
close the forgery gap completely, and it was rejected because the key lives on the
same machine as the agent, so the protection reduces to a passphrase prompt, at the
cost of key creation, storage and rotation on three machines.

**Letting the shell mint.** `ratchet ratify` from a shell was rejected outright: an
agent can run a shell command, so a CLI mint is an agent mint with extra steps. The
CLI can list what is waiting and nothing else.

**Trusting a hand-written approval record.** This was the state before the change:
an approval ADR that named a decision put it into force, and an approval ADR is a
file anyone can write. It is now refused unless it carries a ratification block,
and a hand-written one carries nothing.

## The decision

A decision enters force only through a human consent that is **recorded against the
exact text that was approved**.

The decision is put to the human as a quiz through the harness user-questions
channel: one question per waiting record, whose detail is that record's own file
text, offering exactly two options. The answer is derived from the selected label
by exact comparison — a label equal to the question's approve label is an approval,
equal to its reject label is a rejection, and anything else is unreadable and mints
nothing. An unreadable answer is re-asked once in a different shape, and a machine
that keeps rephrasing a question until it gets the answer it expected has stopped
asking.

The consent is written as an ordinary ADR of `type: approval` carrying a
`ratification` block: the channel, the moment, who asked, and one content hash per
approved record. The compiler honours the approval only while the file still hashes
to that value, so editing an approved decision voids the consent instead of
silently inheriting it — a decision cannot be substituted past the person who read
it. The transcript of the questions and the answers is written under the sources
directory and cited as the approval's source, so the existing source-hash machinery
covers the evidence too.

Two consequences follow. A record the zone does not authorise is no longer in
force: reporting a self-declared active decision while enforcing it was the worst
of both worlds. And consent does not transfer authorship, so a ratified agent
record still cannot govern a zone reserved to humans.

## What this does not prove

A deliberately forged ratification block is indistinguishable from a real one: an
agent that writes a well-formed block with a matching hash produces a file a reader
cannot tell from the artifact this mechanism writes. The protections that remain
are that the tool path cannot produce a consent without an `allowed-once` answer
from the human channel, that the gate reports what it cannot corroborate, and that
the transcript and the approval are committed together where a reviewer sees them.
The residual gap is recorded rather than papered over.
