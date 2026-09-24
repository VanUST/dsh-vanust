# Gather the context you do not have, before the first write

A session that starts a task with less context than the task needs does not fail loudly. It
writes a plausible change against the wrong contract, and the error surfaces later as a diff that
has to be unwound. The cost of unwinding is paid by whoever has to do it, and it is strictly
larger than the reconnaissance that would have prevented it, because the reconnaissance is read
and the unwinding is written.

The facts a task needs are knowable before the first write and are usually not in the prompt:

- the contract — the file, module or manifest that defines the behaviour being changed and what
  it promises its callers;
- the enforcement point — the test, check or law that covers it today, and the input that would
  make it fail;
- the decision — the ADR, rule or comment that governs the area, and whether it is in force;
- the other dependants — the callers, the second implementation, the generated artifact;
- the gaps — what could not be determined, named as gaps.

The delegation tool this deployment provides is the right instrument for that reconnaissance: it
reads and reports without editing, it runs in its own context, and its report is bounded. The
alternative — the parent reading the same files inline — spends the parent's context on facts it
will not need again, and delays the decision the task actually is.

This has to be stated carefully, because §13 already forbids the shape it could easily become.
§13 says to delegate by context block, one subagent per block, and to delegate only what is
independent of the next step. A rule that said "delegate before every task" would contradict it
outright. Therefore:

- the reconnaissance is ONE delegation and it is the FIRST one, before a work delegation rather
  than beside it;
- when the task is already a delegated block, the reconnaissance goes INTO that delegation's
  prompt, so the block still has one subagent and not two;
- the gate is the first WRITE, not the first thought. A task that only answers a question never
  reaches it, and neither does a continuation whose context is already in the conversation;
- the report is evidence, not authority. It is verified like any other claim, and a claim about
  code is quoted as `path:line` so the parent can check it rather than inherit it.

That last point is what keeps the gatherer from becoming an oracle: a subagent report is a
model's output about a repository it read, and this deployment already treats unverified model
output as a claim rather than a fact.

The enforcement is a rule drill, because a prompt rule has no shell command that fails when it is
broken. The scenario offers both actions — a delegation and a write — and asks for both, so the
unruled run performs them in the wrong ORDER rather than not at all, which is what makes the
comparison observable. With the section present the delegation comes first and there is at most
one; with the section stripped the write comes first. `node scripts/drill-kit-rules.mjs --root .`
proves the scenario names a section the file really carries, and the behavioural half needs the
live run, which is release-gate evidence rather than a law check.

The residual: the drill measures the ORDER when a task is new. It does not measure the skip
cases, because "the context is already on screen" is a property of a conversation rather than of
an action, and no offered tool can distinguish them. The skip cases are stated for the reader,
not enforced by a command, and this record says so rather than implying the drill covers them.
