---
id: TASK-048
kind: task
title: "Compaction rewrites mid-turn: why image-offload and the pruner break the prefix cache"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.537Z
updatedAt: 2026-11-17T15:52:39.537Z
acceptance:
  - text: "the code path that triggers each rewrite is named with file/line"
    done: false
  - text: "the measured cost per rewrite is quoted from a real session"
    done: false
  - text: "a design is proposed with its cost/tradeoff, and at least the reachable part is proven working on this machine"
    done: false
boardId: task-mwaopg6d-9p71dh
nonScope: ["patching files under the vendor harness tree (they are overwritten and break the pin)", "changing provider behaviour"]
resultArtifacts: [/home/iustimov/dsh-kit/plugins/image-window/image-window.mjs, /home/iustimov/dsh-kit/plugins/image-window/README.md, /home/iustimov/dsh-kit/plugins/cc-dsh-image-window-0.1.1.tgz, /home/iustimov/dsh-kit/profile/cordis.patch.yml, /tmp/window-replay3.mjs]
resultEvidence: ["dsh-llm-deepseek/lib/index.js:1449 and dsh-llm-pi-ai/lib/index.js:1398-1402 both raise IMAGE_OFFLOAD_REQUIRED from requiredImageOffload(...), i.e. the budget is checked locally and the request is rejected before the provider sees it", "dsh-compaction-image-offload/lib/index.js:14-44,141-145: on agent/request-error it appends image/offload for the OLDEST occurrences and returns {kind:'retry'}", "session-1cb0708d: 6 image/offload events -> the next call each time collapsed to 74,752-78,592 cached; fresh at those steps 230,270/236,104/258,928/289,688/314,777/454,062 = 1,783,829 of 2,260,222; ideal (sum of deltas) 532,654", "replay by arrival batch (95 arrivals, 13 batches): window policy re-billed 440,944 vs 1,783,829 today — ~973K total fresh instead of 2.26M", "dsh-compaction-basic/lib/index.js:926-943: prune runs only after the pressure threshold is crossed; session a8c0d175 shows 39 compaction/prune events in one burst at 21:10:11 and the next call at 21:10:21 billed 543,732 fresh with 30,208 cached", "node /tmp/image-window-probe.mjs -> 10/10 PASS (window drops the previous image at the tail; keep=2; multi-image message; missing projection is a no-op)", "pack-plugin 0.1.0 -> 0.1.1 (sha cbf7c83f...), pnpm add ok, dump-config exit 0 with the image-window row, check-portability 17/17, check-documentation ok"]
resultSummary: "Root cause named and the image half fixed. (1) Image offload is a two-phase design: the adapter computes a route image-byte budget and REJECTS the request (IMAGE_OFFLOAD_REQUIRED), then dsh-compaction-image-offload removes the OLDEST occurrences and retries — a head rewrite, so a caching provider re-bills everything after the first image. Both adapters (deepseek and pi-ai) do this, so DeepSeek has the same bug. Measured: 1,783,829 of 2,260,222 fresh tokens (79%) on session-1cb0708d, 6 collapses each leaving ~75K cached. (2) The pruner is invoked by dsh-compaction-basic only on pressure/overflow and rewrites ALL over-budget results in one pass; the earliest result is old, so the suffix re-bills (measured 543,732 fresh with 30,208 cached). It is a compaction cost, not an independent bug, and its row lives inside the agent-preset tree so the profile patch cannot reach it. (3) Fix shipped: @cc/dsh-image-window 0.1.1 turns the window into a sliding one — the image that falls out is offloaded as the new one arrives, so the rewrite sits at the tail. Replay on the same session projects 440,944 instead of 1,783,829 re-billed tokens. Installed and composed; needs a harness restart."
scope: ["the installed harness plugins dsh-compaction-image-offload and dsh-compaction-tool-result-pruner (read-only)", "the harness seams they use (LLM error IMAGE_OFFLOAD_REQUIRED, compaction/prune, agent/pre-step)", "the kit's profile rows and any kit-side plugin that could impose the boundary", "session logs in ~/.npm/dsh/sessions for measurement"]
---

Explain why dsh-compaction-image-offload and dsh-compaction-tool-result-pruner rewrite history mid-turn (each rewrite invalidates the provider prefix cache from that position and re-bills the rest of a 200-500K context), measure the cost in real sessions, propose a design that keeps the rewrites at boundaries where the cache is already cold (or avoids them entirely), and prove the proposal on this deployment.

Migrated from .dsh/taskboard.json (task task-mwaopg6d-9p71dh, revision 2).
