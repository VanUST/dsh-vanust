---
id: TASK-406
kind: task
title: "Independent audit: capability fit, context overhead and prefix-cache churn per preset"
status: done
revision: 5
createdAt: 2026-11-24T09:10:30.197Z
updatedAt: 2026-11-24T10:11:37.310Z
acceptance:
  - text: "per preset, a capability table: the tools its persona's stated tasks require (each cited from the persona text), the tools the profile grants, the gaps (each naming the task it blocks) and the dead weight (granted but never invoked in any stored session)"
    done: false
  - text: "per preset, the context overhead from a real request: persona bytes, tool count, tool-schema bytes, system-prompt bytes, reminder bytes, and the share of the preset's promptBytes budget, with the top contributors named"
    done: false
  - text: "per preset, prefix-cache behaviour: distinct system+tool prefixes per session, invalidations per turn (a turn boundary counts as allowed; a mid-turn change does not), and the cache-read share of prompt tokens from the usage series"
    done: false
  - text: "the report ranks the eleven presets on each metric, names the worst on each in one line with its evidence, and states its blind spots and unmeasured presets plainly instead of filling them with zeros"
    done: false
  - text: "every number is reproducible from a quoted command; recommendations are recommendations — no preset, plugin, profile or budget row is edited"
    done: false
boardId: task-mwuh5978-3a1opm
chore: true
choreReason: "A standalone adversarial audit of the eleven preset compositions (capability fit, context overhead, prefix-cache invalidations); it implements no requirement and changes no product file."
nonScope: ["No edits to any persona, tool row, budget number or plugin source", "No fixes, no 'while I was here' improvements; recommendations only", "No restart, no install, no kit-update, no case recording", "No judgment about whether the personas' wording is good — that is REPLAY of the playbook audit; this audit is composition and cost"]
owner:
  kind: agent
  label: CRITIC
  sessionId: 822000be-7473-41dd-9205-d4e79c728837
preset: critic
resultEvidence: ["node scripts/audit-preset-composition.mjs -> exit 0, 1932 logs, three tables + mechanism table in .dsh/audit/measure.md (9917 B)", "node scripts/audit-preset-composition.mjs --json -> exit 0, 1933 logs decoded, 0 unreadable, 132222 B", "--personas -> 11 prefixes with bytes and profile lines; --limit 2 -> static M1: 10x 100%, docs 80% (bash)", "report docs/audits/preset-composition-2026-11-24.md (381 lines) + scripts/audit-preset-composition.mjs; git status shows no edit to profile, plugins or the session store", "key numbers: orchestrator 50 tools / 57716 B schemas (103.1%) / 29006 B system (111.6%); skill catalog 30-31 KB of 32-36 KB reminders in 9/10 presets; cache-read 0.4-8.8% after a tool-list change vs 81.1-99.5% unchanged; all 46 tool-list changes are request/header resume(40)/change(6); ux native header 82 tools vs 78 budget while the gate samples a 1-tool PTC session and prints OK"]
resultSummary: "The independent audit is delivered: docs/audits/preset-composition-2026-11-24.md (381 lines) plus a reusable reader scripts/audit-preset-composition.mjs (1 933 logs, 0 unreadable). Capability fit is 100% for 10 of 11 presets; the one gap is docs, whose persona promises bash and lychee while its row grants no bash. Heavy facts: orchestrator carries 50 tools with 57 716 B of schemas (103.1% of budget) and a 29 006 B system prompt (111.6%); the skill catalog is 30-31 KB of the 32-36 KB reminders in 9 of 10 presets; the destructive cache event is a tool-list change (cache-read falls to 0.4-8.8% against 81.1-99.5% on an unchanged prefix), and all 46 such changes are request/header resume or change — exactly what freezePerTurn does not cover. context-budget's sampling blind spot makes ux print OK on a 1-tool PTC session while its native header is over the gate's own 1.5x rule (82 > 78). presenter is unmeasured: no session exists."
role: CRITIC
sessions:
  - sessionId: 822000be-7473-41dd-9205-d4e79c728837
    label: CRITIC
    role: CRITIC
    status: sleeping
---

Act as an independent critic of the eleven preset compositions and answer one question with measurements: can an agent on each preset do its role's usual tasks, at what context cost, and how often does its prompt prefix change underneath it (which destroys prefix cache)? Produce docs/audits/preset-composition-2026-11-24.md with three metrics per preset, ranked and evidenced: (M1) capability fit — derive the role's usual tasks from its persona and docs/PRESET-PLAYBOOKS.md §3.1, map each to the tools it needs, compare with the profile's granted set, and report coverage (%), gaps (tool missing for a stated task) and dead weight (granted tool never invoked in any stored session, counted from session logs); (M2) context overhead — persona bytes plus the first request's tool count, schema bytes, system-prompt bytes and reminder bytes, and the share of that preset's promptBytes budget; (M3) prefix-cache churn — per session, how many distinct system+tool prefixes appear and how many requests changed the prefix mid-turn versus at a turn boundary, plus the cache-read share of prompt tokens; name the mechanism that changes where you can see it. Then rank the eleven and name the worst per metric. Also write scripts/audit-preset-composition.mjs if the measurement is repeatable, so the next run costs one command.
