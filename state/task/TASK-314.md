---
id: TASK-314
kind: task
title: "State notification names active tasks and lists open task titles"
status: done
revision: 9
createdAt: 2026-11-24T15:05:46.059Z
updatedAt: 2026-11-24T15:22:51.400Z
acceptance:
  - text: "the delta carries a section that names the active-task count and lists the titles of open tasks with their status, built from state/views/board.md and not from a second source"
    done: false
  - text: "the list is capped (12 titles) with a '+N more' line when the board has more, and an empty board says 'no open tasks' instead of an empty heading"
    done: false
  - text: "the first message (L1) carries the same open-tasks section once, so a fresh session knows what is in flight without reading the board"
    done: false
  - text: "the byte cap still holds and never leaves a section header without its rows"
    done: false
  - text: "tests cover parsing a real board, the cap, the empty case and the counts line; make test and make verify are green; plugin repacked"
    done: false
boardId: task-mwutu4k6-rfk03v
chore: true
choreReason: "The owner asked for the orchestrator's state notification to name active tasks and list the titles of open tasks, so the root agent sees what is in flight without opening the board."
nonScope: ["No change to the taskboard plugin or to state/ generation", "No change to the delta delivery path or to the one-per-turn rule", "No commit, no push"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["composed delta over the real board: 402 bytes, 'active: 1, open: 0, review: 1', then '- TASK-314 [active] …' and '- TASK-309 [review] …'; board at compose time had sections active (1), review (1), done (229), cancelled (83)", "tests 17/17 including the counts-line test with a fixture of open (1), active (2), review (3) asserting active: 2, open: 1, review: 3 and six listed rows", "red first against the previous 0.1.6 bytes: 13 pass / 4 fail", "make test 68/68, make verify 20/20, portability tarball checks PASS, repacked 0.1.7 sha256 d7276d47…"]
resultSummary: "The state notification now names the in-flight work for the root agent: an open-tasks block in both the first message and the delta, built from state/views/board.md, listing active, open and review tasks with their statuses and counting each status from its own section. The earlier version listed only active and review and printed the list length under the word open; both are fixed and pinned by a fixture with one row per status. Twelve-title cap with a '+N more' marker, an explicit 'no open tasks' line, and the 1200-byte cap that drops a section rather than leaving its heading alone. 17/17 tests, red-first 13/17 against the previous bytes, make test 68/68, make verify 20/20, plugin repacked 0.1.7."
role: BACKEND
scope: ["plugins/state-feed/lib/feed.mjs — the parser and both composers", "plugins/state-feed/test/ — tests for the list, the cap and the empty board", "plugins/state-feed/index.mjs only if the wiring needs it", "package.json version, tarball"]
---

Make the root agent's state notification say what is in flight. The feed already reads state/views/board.md, but the delta only carries counts and the digest's open-work bullets. Add an open-tasks section to both the first message and the delta: a line naming how many tasks are active (plus how many open and in review), then the titles of the open tasks with their status, capped at twelve with a '+N more' line, and a clear 'no open tasks' line when the board is empty. Parse the board's own section/table format rather than inventing a second source, keep the existing byte cap so a long list cannot push the delta past it, and never leave a header with no rows under it. Prove with the real board: quote the composed message for the current state, the tests for the cap and the empty case, make test and make verify, and repack the plugin.
