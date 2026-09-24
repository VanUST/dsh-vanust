# Deduplicating the rules prompt without losing a rule

An analysis of the injected prompt measured it at 519 lines / 47,118 characters, delivered as a
55,647-character `system/message` (~13,900 tokens) on every request. Of that, 18 sections carry
the rules; roughly 30% is deployment-mechanism reference rather than instruction, and several
sections state the same thing more than once.

Two kinds of repetition were found, and only one of them is removable.

**The removable kind: a section restating itself.** A `Thought | Reality` table is a fine device
for naming the excuse a rule exists to answer. It is redundant when its "Reality" column only
paraphrases the paragraph immediately above it and its "Thought" column only paraphrases the
heading. §13 ("batch by context block") and §13a ("one gatherer, before the first write") are
both in that state: §13's table rows three times restate "one block, one subagent, one report",
which its own first paragraph and its "reason is not only cost" bullet already carry; §13a's
table restates the paragraph, the question list and the guardrail it sits under. Removing either
table removes no rule, no question and no limit.

The same test clears §1, §6, §9 and §10, whose tables name excuses the prose does not: §1's
"It compiled, so it works", §9's "I only restarted it", §10's "I found the bug, so I fixed it".
Those stay, because the excuse is information the bullet does not carry.

**The other removable kind: a rule stated twice in two places.** Two cases:

1. The file's own opening says "Follow those rules at all times." and then, on the next line,
   "You have to follow those instructions at all times." One sentence, written twice.
2. §0 tells an agent to read `$DSH_HOME/DEPLOYMENT.md` and enumerates what it carries —
   including the convergence check and apply and the one-time `dev-link` step — and §0a then
   restates the same two commands. The procedure is the source of truth for both; §0 already
   makes reading it mandatory, so the second copy is not a safety net, it is drift waiting to
   happen (the two copies can disagree and the prompt cannot tell which is right).

What is deliberately NOT touched, and why:

- **Section numbers and headings.** §14 is cited by frozen ratified records (ADR 0070 and its
  source, the README) and the drill files match headings by prefix, so a renumbering or a
  reworded heading would break a check or void a citation. Deduplication here is subtraction
  inside sections, never renumbering.
- **The `DEPLOYMENT.md` pointer.** A check asserts the rules file names it
  (`node scripts/check-instruction-routing.mjs`), so the pointer stays; only the second copy of
  the commands it points at goes.
- **The tables in §1, §6, §9 and §10.** Their "Thought" columns are the only statement of the
  excuses they answer.
- **§14's italic summary.** It is explicitly framed as the strongest true statement the
  mechanism supports; it is a deliberate summary of the two paragraphs above it, not an
  accidental repeat.

The purpose is not brevity for its own sake. The prompt is un-compactable — compaction shrinks
derived history, never the system prompt — so every line is paid on every request of every
session for the life of the deployment, and a rule stated twice is read twice and reconciled
twice. Removing a restatement makes the remaining statement the single place a reader has to
check.
