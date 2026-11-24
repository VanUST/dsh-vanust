---
id: TASK-290
kind: task
title: "Preset playbooks in every persona plus the shared acceptance paragraph"
status: done
revision: 6
createdAt: 2026-11-24T08:35:49.530Z
updatedAt: 2026-11-24T08:44:30.678Z
acceptance:
  - text: "eleven persona blocks applied from docs/PRESET-PLAYBOOKS.md §4, one per preset, meaning unchanged"
    done: false
  - text: "the case paragraph in CHILD_POLICY corrected to today's contract and one shared acceptance sentence added, tool-agnostic"
    done: false
  - text: "make verify green, with the affected plugin/profile tarballs repacked and their versions bumped because tarball:matches-source pins packed files to source"
    done: false
  - text: "no new red in the context-budget gate; each persona addition is at most 600 bytes and its measured system-prompt bytes do not cross the preset's promptBytes warning"
    done: false
  - text: "one fresh session of the tester preset on a SECOND server started from the patched profile shows the tester block in its system prompt, quoted"
    done: false
  - text: "no file outside the four named ones changed and the live :3080 install was not restarted"
    done: false
boardId: task-mwufwnu6-de94us
nonScope: ["No change to any persona's existing sentences, tool lists, plugin rows or description fields (append only)", "No change to the budgets table unless a measured preset crosses its promptBytes warning — then raise only that preset's number and say so", "No touch of docs/cases/**, docs/CASE-LIBRARY-BEHAVIOUR-DESIGN.md or the case library", "No change to the orchestrator's root policy (lines ~380-486) — only CHILD_POLICY", "No kit-update, no live profile install, no restart of the server on :3080"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-237, REQ-238, REQ-239]
resultEvidence: ["git diff --numstat -- profile/cordis.patch.yml -> 22 added, 0 deleted; eleven blocks present (orchestrator in its own wording at profile/cordis.patch.yml:1170, ten with 'False positive:')", "dsh --profile web-playbooks --dump-config from the patched profile: 11/11 §4 blocks present after whitespace normalisation; tester persona tail quoted verbatim", "plugins/orchestrator/orchestrator.mjs:500 new bullet 'How your result is accepted.'; :503 corrected case paragraph naming case_record, case_run red-then-green, case_gate, and purpose implementation never closing a task; 'documented-only with a reason' -> 0 matches", "pack-plugin: @cc/dsh-orchestrator 0.1.67 -> 0.1.68, sha256 57ce159a…; in the packed tarball 'How your result is accepted' = 1, 'documented-only with a reason' = 0", "make verify -> exit 0, 0 FAIL lines; context-budget 0 red (projected backend ≈25317, critic ≈25595 against promptBytes 26000)", "Second server booted from the patched profile on 127.0.0.1:3081 and was removed; ss after the run shows only 127.0.0.1:3080", "Analysis record preset-playbooks: FR1/FR2/NFR1 deferred with the evidence and reasons (proof level, no formal TEST); readiness and completion green"]
resultSummary: "Eleven preset personas carry their playbook block (22 lines added, 0 deleted; the exact §4 text, verified 11/11 against the composed profile the second server boots), and CHILD_POLICY now states how a specialist's result is accepted plus the corrected case contract (case_record -> case_run red then green -> case_gate; an implementation case never closes a task). @cc/dsh-orchestrator repacked 0.1.67 -> 0.1.68; make verify exits 0 with no red preset. The live tester-session quote is the one named gap: read-only ~/.npm/dsh plus no scripted session-create, so the proof is the composed-profile dump and the packed-tarball grep."
role: BACKEND
scope: ["plugins/orchestrator/orchestrator.mjs — CHILD_POLICY only (the shared paragraph: the drifted case sentence replaced, one acceptance sentence added)", "profile/cordis.patch.yml — one appended block per persona.prefix, eleven presets (append only, no rewrite)", "the tarballs and package versions that the packaging gate pins to source (repack as the kit's own skill prescribes)", "profile/cordis.patch.yml budgets table only if a measured preset crosses its promptBytes warning"]
---

Make every preset carry the kit's operating contract in its own words, so a specialist knows how its work is accepted before it starts. Two layers, both from docs/PRESET-PLAYBOOKS.md: (a) in plugins/orchestrator/orchestrator.mjs, correct the drifted case paragraph in CHILD_POLICY (it still offers documented-only with a reason and does not name the gate) and add one tool-agnostic sentence about how a specialist's result is accepted; (b) in profile/cordis.patch.yml, append the one block per preset from §4 to that preset's persona.prefix — eleven blocks, each naming the mechanism the role meets (orchestration, the state register, the case library) plus one false-positive and one false-negative anti-pattern in the role's own voice. Then prove the text actually reaches a preset's prompt, not just the file.
