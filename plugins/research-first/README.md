# @cc/dsh-research-first

Makes "look it up before you build it" mechanical instead of advisory.

## The problem it solves

An agent's knowledge of a library is a snapshot of its training data. The API was renamed, the pattern was superseded, and the code it writes from recall compiles fine and is a year behind. Prompt rules do not fix this — they lose to confidence, especially when the remembered answer is fluent.

## What it does

- Observes the session's tool results. A successful `web_fetch` or `web_search` marks the session as researched.
- Intercepts `write` before dispatch. Creating a file that does not exist yet, in a session with no research recorded, is **refused** with a message that names the exact next step.
- Editing an existing file is never blocked: the code in front of you is the source of truth for itself.
- `research_waive({ reason })` unlocks the session when looking is impossible (offline, auth wall), and the reason is logged.
- Contributes a short prompt section so the rule is visible before the refusal, not only after it.

## Why a guard rather than a section

The section states the rule; the guard is what makes the statement true. The friction is placed at the cheapest point — one fetch, a few hundred tokens, unlocks the whole session — rather than at every edit.

## Config

```yaml
- id: research-first
  name: '@cc/dsh-research-first'
  config:
    mode: deny          # or warn, to observe before enforcing
    requireFor: [write]
    researchTools: [web_fetch, web_search]   # add a docs MCP's tool names here
    allowPaths: [".dsh/", "docs/"]
    newFilesOnly: true
    allowWaiver: true
```

## Limits, stated

- It cannot judge whether the research was *relevant*, only that a lookup happened. A careless fetch satisfies it; the skill `research-first` is what makes the lookup useful.
- It gates file creation, not design decisions expressed in a shell command or a long edit to existing code. Those stay with the review and the skill.
- With `mode: warn` it never blocks: it logs what it would have refused. Use that for a trial week.

## Relationship to the skill

The plugin is the gate. [`research-first`](../../plugins/skills/skills/research-first.md) is the procedure: what to read, in which order (installed version → official docs for that version → changelog → one worked example), and the checklist that ends with "if I could not look, the assumption is in the deliverable".
