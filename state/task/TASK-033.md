---
id: TASK-033
kind: task
title: "Cut token over-spend: MCP domain trim, reminders off, compaction threshold, honest corpus cost"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.351Z
updatedAt: 2026-11-17T15:52:39.351Z
boardId: task-mw9bnqu2-z5auoi
---

Apply the approved audit fixes except reasoning effort: (1) trim godot MCP domains that were never called (measured 6.2K tokens/request of the 19.9K godot surface), (2) disable the four reminder tools (0 calls in 191,710 requests, ~1.1K tokens/request), (3) lower the compaction threshold ratio so contexts stop growing to ~800K, (4) make the kit's own corpus count compaction summaries and define a cache miss by cacheRead instead of billed>10K.

Migrated from .dsh/taskboard.json (task task-mw9bnqu2-z5auoi, revision 2).
