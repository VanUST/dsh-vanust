# AGENTS.md — shared instructions for every agent in this workspace

These instructions apply to every agent here: the orchestrator, every delegated specialist, and
any ad-hoc session. They are requirements, not style advice. A report that ignores them is wrong
even when its facts are right.

## Terminology is mandatory

**Use the project's words, never a term you invented.**

- The canonical vocabulary is [`docs/TERMINOLOGY.md`](docs/TERMINOLOGY.md). Read it before you
  write a report, an answer, a task note the human will read, or a commit message.
- Every message the human reads uses those terms, or the human's own words for the human's
  concepts. The same thing has the same name in every report: do not rotate synonyms to sound
  varied, and never rename a concept the human already named.
- **Do not coin terms.** No new names, abbreviations, acronyms, compounds or metaphors for a
  concept. If a needed concept is missing from the glossary, either describe it in one plain
  sentence, or add the term to the glossary in the same task — definition plus the wording the
  human will read — before you use it. A term that exists only in the current task is a bug.
- **Internal identifiers are evidence, not subjects.** File paths, function names, tool ids,
  statuses and error codes describe the code; the sentence describes the human's situation.
  State the plain fact first, then cite the identifier: "the run is refused because the stored
  command changed (`COMMAND_MISMATCH`)", not "`COMMAND_MISMATCH` means the case is red".
- **No decoder needed.** Before sending, read the report once and replace every noun a reader who
  has not seen the code would not understand. Prefer the concrete subject and the active verb:
  "the panel sorts tasks by last activity" beats "list-mode ordering was reversed".
- The prose is in the human's language; identifiers, paths and codes stay verbatim in their own
  language. Do not calque an identifier into an invented local word.

## The project ledger across machines

`state/` is the project ledger, not one machine's notebook: rows are identified by what they
are (`boardId`, `caseId`, `analysisRef`) and the journal is merged across machines. A `git pull`
that stops on `state/` is not resolved by picking a side.

1. `node scripts/state-merge.mjs --check` prints the plan — which rows would be renumbered,
   which are one row under two numbers, which were edited on both sides. Nothing is written.
2. `node scripts/state-merge.mjs` writes the merged ledger from git (`HEAD`, `MERGE_HEAD`, the
   merge base), regenerates `state/views/`, stages `state/` and prints the same report.
3. Read the collisions to the owner, then finish the merge with `git commit`.

`make pull` does the pull and step 2 in one command. Never `git checkout --ours/--theirs --
state/`: one machine's rows and events disappear and the journal stops replaying.

## Reports

- A report goes to a human who did not watch the work. Lead with the outcome, name the change,
  give the evidence (command, output, exit code, file), then decisions, risks and next actions.
- Every non-obvious term is defined in one clause on first use, or it is in the glossary.
- Quote identifiers and commands; do not dress them up as a vocabulary.

## Scope of these rules

A project with its own glossary or conventions supersedes this file for that project: use its
terms, and keep the same discipline — project vocabulary, human's words, evidence cited not
paraphrased.
