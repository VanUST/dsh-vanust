---
id: TASK-001
kind: task
title: "Hindsight integration"
status: done
revision: 2
createdAt: 2026-11-17T15:52:38.962Z
updatedAt: 2026-11-17T15:52:38.962Z
acceptance:
  - text: "a fact retained in session A is recalled in session B"
    done: false
  - text: "the companion skill stays in the catalog"
    done: false
  - text: "no test files added"
    done: false
boardId: task-mvjjzc4e-b9ieff
nonScope: ["no MCP server", "no credentials in the repo", "no second memory store"]
resultEvidence: ["GET http://127.0.0.1:18888/health -> 200 {status: healthy, database: connected}", "Hindsight daemon log: OpenAI-compatible client provider=deepseek model=deepseek-chat; connection verified; embedded PostgreSQL started", "New session 1: hindsight_ingest_document returned {\"ok\": true, \"doc_id\": \"verification-token\"}", "New session 2: hindsight_reflect returned ORANGE-42; cross-session recall proved", "Tools updated 8 added; hindsight_search/list/reflect/status/diagnose/ingest present"]
resultSummary: "Hindsight is installed, enabled and proven against a local daemon at 127.0.0.1:18888: DeepSeek provider verified, embedded Postgres healthy, session A ingested \\\"Verification token\\\" (doc_id verification-token), and a separate session B recalled ORANGE-42 via hindsight_reflect. The plugin tools are live in the restarted diagnostic profile."
scope: ["server or token", "bank config", "retain + recall smoke test", "one-page handoff"]
---

Finish the Hindsight memory integration: choose a daemon or Cloud bank, remove the disabled flag, and prove a retained fact is recalled in a new session.

Migrated from .dsh/taskboard.json (task task-mvjjzc4e-b9ieff, revision 4).
