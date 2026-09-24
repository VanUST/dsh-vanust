---
id: "0083"
title: Deduplicate the rules prompt without losing a rule
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-24T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-24-deduplicating-the-rules-prompt.md
  hash: sha256:a35e55ba15c6d7e84309de33046f9eda10666a8ab5c1699a44455335cf85346b
zones:
  - deployment-rules
supersedes: []
approves: []
laws: []
---

## Context

The injected rules prompt was measured at 519 lines / 47,118 characters — a 55,647-character
`system/message` (~13,900 tokens) on every request. It is un-compactable: compaction shrinks
derived history and never the system prompt, so every line is paid on every request of every
session.

An audit found repetition of two kinds: sections whose `Thought | Reality` table only paraphrases
the paragraph directly above it (§13, §13a), and rules stated twice in two places (the file's
opening sentence, and the operating commands carried by both §0 and §0a).

## Decision

Remove the repetition and keep every rule:

1. The opening's duplicated sentence — "Follow those rules at all times." and "You have to
   follow those instructions at all times." say one thing.
2. §0a's restatement of the `kit-update` and `dev-link` commands that §0 already enumerates as
   content of `$DSH_HOME/DEPLOYMENT.md`. The release-gate rule it uniquely carries stays.
3. §13's table, whose every row paraphrases the paragraph above it.
4. §13a's table, whose every row paraphrases the paragraph, question list and guardrail above it.
5. §3's last table row, which restates what §11 and §10 already say about a passing check.

## Reasoning

The full reasoning is the cited source. In short: a table earns its place when its "Thought"
column names an excuse the prose does not — that is why §1, §6, §9 and §10 keep theirs — and
loses it when both columns paraphrase what the reader just read. A rule stated twice is read
twice and reconciled twice, and the two copies can drift with the prompt unable to say which is
authoritative.

## Consequences

- No section number or heading changes. §14 is cited by frozen ratified records and the drill
  files match headings by prefix, so renumbering would break a check or void a citation.
- The `$DSH_HOME/DEPLOYMENT.md` pointer stays: `node scripts/check-instruction-routing.mjs`
  asserts it, and the procedure it points at is what an agent follows.
- The prompt shrinks by roughly two dozen lines. This is a first pass against a monotonic growth
  (the system message for one session went from 6,866 to 55,647 characters); it does not by
  itself bound the file, and a budget check remains the missing enforcement point.
- A human must ratify this record: `deployment-rules` declares `proposeOnly`, so an
  agent-authored record cannot activate itself.
