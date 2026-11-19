---
id: TASK-032
kind: task
title: "Audit dsh-kit for remaining token over-spend"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.339Z
updatedAt: 2026-11-17T15:52:39.339Z
acceptance:
  - text: "Each finding carries a measured number (tokens or bytes per request/session) and the exact code/config location"
    done: false
  - text: "Findings ranked by cost, with the fix cost named (one-line config vs code change)"
    done: false
  - text: "No claim without a command whose output is quoted"
    done: false
boardId: task-mw9b5k91-mxgqq1
nonScope: ["changing model pricing or Kimi quota (external)", "rewriting the orchestrator freeze already shipped", "inventing savings without a measured baseline"]
resultArtifacts: [/home/iustimov/dsh-kit/.cache/session-analysis/corpus.json, /home/iustimov/dsh-kit/.cache/session-analysis/analysis.json, /home/iustimov/dsh-kit/scripts/session/extract-corpus.mjs, /home/iustimov/dsh-kit/scripts/session/analyse-corpus.mjs]
resultEvidence: ["node scripts/session/extract-corpus.mjs -> 1422 sessions (228 top-level, 1194 subagent), 93.6 MB, exit 0; analyse-corpus.mjs exit 0", "analysis.json: billedTokens 431,021,639; cachedShare 99.2%; cacheMissEventsOver10k 3,336; billedInMissEventsOver10k 279,293,282 (64.8% of billed)", "billed split by step: turn-start misses 780 events/107.6M; mid-turn misses 2,556 events/171.7M; small deltas 151.7M; compaction summaries 119 events/44.6M (measured separately: 44,639,536 billed input, max summarization prompt 792,507)", "prompt composition of the live 163KB system prompt: tool SDK declarations 39,060 tok of 42,845; godot MCP 47 tools/19,933 tok; playwright 24 tools/856 tok; core 67 tools/12,234 tok; policy+roles+debt only ~1,500 tok", "declared-vs-called: 62 of 138 tools never called in 191,710 requests; their schema cost 19,666 tok/request", "tool result bytes across corpus: bash 107.2MB (37.8%), read 103.9MB (36.6%), run_code 53.4MB (18.8%); call args: bash 72.5MB, write 53.4MB, edit 47.6MB", "repeated reads: 26,060 read calls with a path, 12,143 repeat reads, 37.3MB re-sent; static/labeler.js read 118x in one autolabel_pipeline session", "mid-turn re-render classification over the top-12 billed sessions: role catalog 96, board debt 78, hindsight 2, MCP 1, other 290 (samples are DEPLOYMENT.md/rules text lines)", "model mix: deepseek-flash 176,189 steps/404.3M billed/155.4M output; output/billed 0.38; k3.1-pro only 11.7M billed"]
resultSummary: "Audited the kit's whole session corpus (1,422 sessions, 191,710 requests) plus the live system prompt. Six measured over-spend sources remain, ranked: (1) contexts grow to ~800K before compaction - 73 sessions over 600K, 54.5% of turn-start requests carry >300K, and compaction summaries cost 44.6M billed tokens that the kit's own analytics never counted; (2) mid-turn system-prompt rewrites cost 171.7M billed (40% of all billed) - in the top-12 billed sessions 174 re-renders were the role catalog/board debt (fixed by 0.1.15) and ~290 were the deployment rules/instruction text changing while a dsh-kit session edited it; (3) 62 of 138 declared tools were never called in 191,710 requests and their schemas cost 19,666 tokens per request (godot 19,933 alone, 43 of its 47 tools unused; schedule_* ~1.1K); (4) output is 168M tokens with 39.6M reasoning (24%) under a global reasoningEffort: high; (5) 12,143 repeated reads of the same file (37MB re-sent, one file 118x in a session); (6) the corpus extractor skips compaction/* usage, so the kit undercounts its own bill by 10%."
scope: ["dsh-kit/plugins/* (prompt sections, tool descriptions, brief rendering)", "dsh-kit/profile and ~/.npm/dsh/profiles/web/cordis.patch.yml (model, efforts, compaction, MCP rows)", "dsh-kit/rules, README/USERGUIDE prompt text if injected", "session logs under ~/.npm/dsh/sessions and scripts/session tooling (read-only)"]
---

Find every place in the current kit where a request carries more tokens than the work needs, rank them by measured cost, and name the cheapest fix for each. Sources: the kit's own session corpus (billed vs cached tokens, per-tool result bytes, call-argument bytes), the system prompt as actually logged per session, profile settings that multiply calls, and the plugins that render prompts. Deliver a ranked report with numbers and file/line references; implement only what the human approves afterwards.

Migrated from .dsh/taskboard.json (task task-mw9b5k91-mxgqq1, revision 2).
