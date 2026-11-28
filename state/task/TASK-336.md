---
id: TASK-336
kind: task
title: "DEVOPS preset and the runtime lane (one live deployment task)"
status: done
revision: 6
createdAt: 2026-11-27T10:33:53.382Z
updatedAt: 2026-11-27T11:24:03.249Z
acceptance:
  - text: "delegate_task resolves role DEVOPS to preset devops and refuses a second live devops task with devops_lane_busy naming the open task; attaching to that task is allowed"
    done: false
  - text: "ROOT_POLICY names DEVOPS as the runtime owner, adds the shared runtime to the serialising resources, and requires reading running children before a restart"
    done: false
  - text: "make verify is green and counts 12 role presets, all documented; tool-families proof keeps devops within budget"
    done: false
  - text: "make test is green, including the new devops-lane test"
    done: false
  - text: "a second server with the row's overlay prints preset-devops and lists it in the picker"
    done: false
boardId: task-mwyug14j-3ruwmo
inline: true
nonScope: ["No restart of the live :3080 server from this session (a restart ends the session mid-turn); activation is the next ./start.sh", "No change to the designmap / project-state-panel work in flight in this tree", "No new dependency, package or plugin tarball"]
reqIds: [REQ-256, REQ-257, REQ-258, REQ-259, REQ-260, REQ-261, REQ-262, REQ-263, REQ-264]
resultEvidence: ["make verify exit 0 — 20/20 portability and packaging; every role preset named in the procedure: 12 preset(s), all documented; role table devops 3 verbs; preset coverage 12; tool-families devops kept 6 <= 26", "make test exit 0 — 78/78 (59 plugin test files, 1 acceptance file, 18 proof scripts)", "independent case devops-lane-and-scope-overlap-through-delegate-task: red on git-HEAD copy /tmp/dsh-devops-head-7090829 (mwyvzme8-mu5hq-1, exit 1) and green on the fixed tree (mwyw46ys-esorg-1, exit 0, 20/20 checks); TEST-098 verified with both refs; the green caught OPS -> undefined, fixed in ROLE_PRESETS and pinned by a unit test", "second-server composition proof: DSH_HOME /tmp/dsh3082 with the kit profile copy, composer picker lists DevOps between Backend and Research — reports/devops-role/roster-devops-3082.png; the first run exposed the silent-mount defect (tool-todo requires allowParallelInProgress, no default), fixed with allowParallelInProgress: false", "tarballs repacked: cc-dsh-orchestrator-0.1.76.tgz sha256 0af1320cc87fcc69baf20abf0054aa4e50f7a51019d692f92de90f0712075e7d; cc-dsh-test-cases-0.1.45.tgz sha256 53f524305922b1ce405c55905b79734de1d1077b412e182bc0ccbbeaaba385d5; tarball:matches-source passes", "analysis record devops-role-and-runtime-lane rev 8 completed: 9/9 requirements proven, REQ-256..REQ-264 mirrored; kit-update --check lists profile and plugins for the next convergence"]
resultSummary: "Роль DEVOPS и полоса развёртывания. Пресет devops (порядок 35) получил персону, набор инструментов (shell, файлы, фоновые job-ы, web, case_get/list/run), allow-лист и бюджет tool-families; роль DEVOPS/DEPLOYMENT/OPS/SRE резолвится в него без явного preset. delegate_task отказывает второй живой задаче развёртывания в чате (devops_lane_busy, называет открытую) и второму активному task-у с тем же файлом/каталогом в scope (scope_overlap до создания строки и ребёнка; attach разрешён). ROOT_POLICY называет работающее развёртывание общим ресурсом рядом с файлом, контрактом и местом и несёт блок Development rules (правило в одном владельце, инструмент не поведение, доказывать прогоном, минимальное полное изменение, назвать пропущенное). Дефолт reasoning effort — High: agent-default-model high, role-model pin-ит architect (sol, fallback high) и 10 рабочих пресетов на deepseek-flash high, ребёнок стартует с agentOptions high. Независимый кейс TESTER поймал реальный дефект — отсутствие alias OPS — и после исправления дал red/green; TEST-098 verified. Живой :3080 не перезапускался: активация — следующий ./start.sh (kit-update --check перечисляет profile и tarballs)."
scope: ["profile/cordis.patch.yml: preset-devops declaration, tool-families allow list and budgets", "plugins/orchestrator: PRESET_IDS, ROLE_PRESETS, ROOT_POLICY, delegate_task lane refusal, README, tests", "plugins/test-cases: DEFAULT_ROLE_TOOLS row and README role table", "rules/DEPLOYMENT.md, README.md, USERGUIDE.md, docs/PRESET-PLAYBOOKS.md", "scripts/tool-families-proof.mjs, check-prompt-playbooks.mjs, context-budget.mjs, audit-preset-composition.mjs"]
steps: ["Analysis Record devops-role-and-runtime-lane (L1) with requirements and contracts", "Profile: preset-devops (order 35) plus tool-families row and budgets", "Orchestrator: registry, policy paragraph, delegate_task lane refusal, tests and README", "test-cases: case-tool map and README role table gain devops", "Docs and gate scripts: DEPLOYMENT, README, USERGUIDE, playbooks, proofs", "Reasoning default High: agent-default-model, role-model routes for architect and working presets, docs", "Development rules in the orchestrator prompt (one owner per rule, tool is not behaviour, prove by running, smallest change, name what was skipped)", "Scope claim guard: scopeClaim/claimsOverlap/scopeConflict and the scope_overlap refusal in delegate_task, tests and docs", "Repack the changed plugins (orchestrator, test-cases), run make verify and make test, fix every red", "Prove composition on a second server (profile copy on :3082) and record the evidence"]
stepsDone: 10
---

Add a devops preset and role so runtime deployment, dev/prod version switches and cleanup have one owner, and teach the orchestrator that the shared runtime serialises work: delegate_task refuses a second live deployment task in a chat, and the root policy names the running deployment, the seat and the restart-interruption rule.
