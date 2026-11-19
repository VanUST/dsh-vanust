---
id: TASK-033
kind: task
title: "Cut token over-spend: MCP domain trim, reminders off, compaction threshold, honest corpus cost"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.351Z
updatedAt: 2026-11-17T15:52:39.351Z
acceptance:
  - text: "dsh --profile web --dump-config composes with the new values and exits 0"
    done: false
  - text: "the generated MCP row carries the exclude-domains flag"
    done: false
  - text: "extract-corpus + analyse-corpus run green and report compaction cost"
    done: false
  - text: "each change carries its measured justification in a code/config comment"
    done: false
boardId: task-mw9bnqu2-z5auoi
nonScope: ["reasoning effort settings (explicitly excluded by the human)", "freezing instruction-file text: the mechanism that produced those mid-turn diffs no longer exists in the current profile (verified: no DEPLOYMENT.md injection path, no AGENTS.md in the workspace)", "removing the babysitter plugin (12 real calls in the corpus; a documented kit feature)"]
resultArtifacts: [/home/iustimov/dsh-kit/profile/mcp-servers.json, /home/iustimov/dsh-kit/scripts/session/extract-corpus.mjs, /home/iustimov/dsh-kit/scripts/session/analyse-corpus.mjs, /home/iustimov/.npm/dsh/cordis.patch.yml, /home/iustimov/dsh-kit/.cache/session-analysis/analysis2.json]
resultEvidence: ["node scripts/dsh-mcp-sync.mjs --apply --json -> {\"ok\":true,\"changed\":true,\"patchPath\":\"/home/iustimov/.npm/dsh/cordis.patch.yml\"}; the row carries '--exclude-domains animation,audio,camera,csg,gridmap,navigation,particle,theme,tilemap,tileset,autoload,input_map,game,api,client,custom'", "python3 -c 'from godot_ai.tools.domains import parse_exclude_list' -> accepted: 16 (every name is a valid excludable domain)", "dsh --profile web --dump-config -> exit 0, no warnings, one --exclude-domains occurrence at line 1387 of the composed tree", "node scripts/session/extract-corpus.mjs (1422 sessions) + analyse-corpus.mjs -> exit 0; cost.compactionSummaries 119, compactionBilled 44,639,536, billedWithCompaction 476,373,407, compactionShareOfBilled 0.0937; cacheMissEvents 304, billedInMissEvents 64,363,276, share 0.149", "corrected billed split: turn-start misses 188 events/28.2M, mid-turn misses 116/36.1M, normal growth 367.4M, compaction 44.6M", "node scripts/check-portability.mjs -> 17/17 PASS; node scripts/check-documentation.mjs -> documentation ok; both exit 0", "git diff profile/cordis.patch.yml | grep -c 'compaction-basic|tool-schedule' -> 0 (the failed patch entries were reverted from both the kit and the installed profile)"]
resultSummary: "Implemented 2 of the 4 approved fixes, found one moot and one blocked by the preset architecture. (1) DONE - mcp-servers.json now excludes 16 never-called godot domains (~6.2K of the 19.9K godot schema); synced into $DSH_HOME/cordis.patch.yml as --exclude-domains and verified against the godot registry (16/16 accepted) and the composed profile. (2) DONE - the kit's corpus now costs compaction summaries (44.6M billed over 119 summaries, 9.4% of the bill, previously invisible) and defines a cache miss by cacheRead<=2K instead of billed>10K, which cut the reported miss count 3,336 -> 304 and the miss-billed share 64.8% -> 13.5%. (3) MOOT - the mid-turn instruction/rules diffs came from a DEPLOYMENT.md injection path that no longer exists in the current profile (only stale backups carry that text). (4) BLOCKED - compaction threshold and disabling tool-schedule live inside @deepseek-ai/dsh-agent-preset plugin trees materialized at runtime; the patch layer warns 'patch: entry tool-schedule not found' and the base compaction-basic row is disabled, so neither can be set from the profile patch without replacing a whole preset tree."
scope: [dsh-kit/profile/mcp-servers.json, dsh-kit/profile/cordis.patch.yml, dsh-kit/scripts/session/extract-corpus.mjs, dsh-kit/scripts/session/analyse-corpus.mjs, "the projected copies under ~/.npm/dsh (profile patch + mcp-servers.json) and scripts/dsh-mcp-sync.mjs output"]
---

Apply the approved audit fixes except reasoning effort: (1) trim godot MCP domains that were never called (measured 6.2K tokens/request of the 19.9K godot surface), (2) disable the four reminder tools (0 calls in 191,710 requests, ~1.1K tokens/request), (3) lower the compaction threshold ratio so contexts stop growing to ~800K, (4) make the kit's own corpus count compaction summaries and define a cache miss by cacheRead instead of billed>10K.

Migrated from .dsh/taskboard.json (task task-mw9bnqu2-z5auoi, revision 2).
