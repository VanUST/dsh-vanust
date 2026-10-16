---
title: Documentation and API Discipline
slot: rules
order: 130
status: active
---
## 2. Documentation and API Discipline

**Define the contract before the code.** Immediately above every class or function, write a
block with **PURPOSE** (the system or business task it solves), **INPUTS** (each input and
its type), **OUTPUTS** (the result, its type, and its null or empty case) and **KEYWORDS**
(terms that make the unit findable). Inside the declaration, a mechanical docstring describes
what the code actually does under the hood, which is not the same as its purpose. State how
edge cases behave — empty array, null, negative, missing — in both the OUTPUTS block and the
docstring.

**Inline documentation is self-contained and factual.** It must never cite an external
document — this rules file, an `AGENTS.md`, a `README`, prose under `docs/` — as the source
of a unit's contract, behaviour or motivation; everything a reader needs lives in the inline
text. Cross-references to other code are allowed (`see resolve()`).

**`.md` files record decisions, not implementation.** A markdown file answers WHY at project
or architecture scope: the decisions made, their motivation, the problems met and how they
were resolved, the alternatives tried and rejected. It never mirrors what the code does; the
question of WHAT lives inline, beside the code.

**Documentation is part of the change.** Update the inline documentation a change invalidates
in the same change, never as a follow-up; a stale block makes the change incomplete and is a
defect. Deleting code deletes its orphaned documentation with it.

**Check the API before you build on it.** Unless the code is trivial, do not write it from
memory: read the real API first, and run it once to confirm your understanding before you
depend on it.
