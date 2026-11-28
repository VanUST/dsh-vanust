---
id: TASK-348
kind: task
title: "Пересобрать доску и оркестратор: правило порядка в сборке"
status: done
revision: 6
createdAt: 2026-11-27T14:05:49.666Z
updatedAt: 2026-11-27T14:11:17.098Z
acceptance:
  - text: "Пересобраны оба плагина: `node scripts/pack-plugin.mjs --dir plugins/taskboard` (0.1.87 → 0.1.88) и `--dir plugins/orchestrator` (0.1.78 → 0.1.79); версии, tarball-пути и sha256 процитированы."
    done: false
  - text: "`make verify` exit 0 и `20/20 portability and packaging checks passed`: `tarball:matches-source` больше не красный ни для одного плагина."
    done: false
  - text: "`node --test plugins/taskboard/test/dependency-open.test.mjs` зелёный после пересборки; `node --test plugins/taskboard/test/*.test.mjs` и `plugins/orchestrator/test/*.test.mjs` зелёные."
    done: false
  - text: "Внутри нового tarball оркестратора есть пункт «Order is part of the contract» (tar -xOzf … | grep), и внутри tarball доски — код отказа `dependency_open` (grep)."
    done: false
  - text: "Ничего не применено к машине, сервер :3080 не тронут; git status процитирован."
    done: false
boardId: task-mwz20mcx-16d87l
nonScope: ["Не менять исходники: только пересборка и прогоны.", "Не применять kit-update и не перезапускать сервер.", "Не трогать state/, docs/cases/, docs/analysis/."]
owner:
  kind: agent
  label: DOCS
  sessionId: 56ba3cc5-bc9c-4365-bb81-8c3b0bb3073a
preset: docs
reqIds: [REQ-274]
resultEvidence: ["pack-plugin: taskboard 0.1.87→0.1.88 (sha256 923e486f…), orchestrator 0.1.78→0.1.79 (sha256 d7390d20…).", "tar-содержимое равно source (TASKBOARD-IDENTICAL, ORCH-IDENTICAL); внутри доски 8 вхождений dependency_open, внутри оркестратора пункт порядка; версии в package.json 0.1.88/0.1.79.", "make verify exit 0, 20/20, [PASS] tarball:matches-source и tarball:version-bumped.", "Тесты после пересборки: dependency-open 7/7, taskboard 65 pass, orchestrator 39 pass, все exit 0.", "Машина не тронута: профиль пинует 0.1.70/0.1.86, :3080 отвечает HTTP 401; изменений вне plugins/ нет."]
resultSummary: "Обе правки упакованы: доска 0.1.88 и оркестратор 0.1.79, payload-ы байт-в-байт равны исходникам, правило и отказ внутри сборок. make verify 20/20 exit 0, тесты 7/7 + 65 + 39 зелёные; машина не тронута."
role: DOCS
scope: [plugins/taskboard/, plugins/orchestrator/, "plugins/cc-dsh-taskboard-*.tgz", "plugins/cc-dsh-orchestrator-*.tgz"]
sessions:
  - sessionId: 56ba3cc5-bc9c-4365-bb81-8c3b0bb3073a
    label: DOCS
    role: DOCS
    status: sleeping
---

Обе правки (правило порядка в политике и отказ `dependency_open`) лежат в исходниках, а сборки отстали: `make verify` красный ровно на `tarball:matches-source`. Пересоберите `plugins/taskboard` и `plugins/orchestrator`, прогоните проверки и докажите, что новое правило и отказ вошли в tarball-ы.
