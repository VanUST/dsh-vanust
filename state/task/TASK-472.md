---
id: TASK-472
kind: task
title: "Проверка развёртывания после перезапуска"
status: done
revision: 5
createdAt: 2026-11-28T15:21:26.688Z
updatedAt: 2026-11-28T16:05:58.368Z
boardId: task-mx0k5pbr-umqhnt
chore: true
choreReason: "Владелец перезапустил сервер; нужно проверить, что развёртывание действительно сведено на 0.2.2-rc.5 и новые пакеты, а не только записано на диск."
nonScope: ["Не перезапускать сервер и не менять профиль; только проверки.", "Не устанавливать пакеты."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["kit-update --check --json → exit 0: ok=true, harness=0.2.2-rc.5, drift=null, plan=[], serverRunning=true.", "Профиль: project-state 0.1.24, state-feed 0.1.10, taskboard 0.1.98, proof-guard 0.1.11; установленный харнесс 0.2.2-rc.5.", "harness-identity-guard --probe --json → exit 0, state=patched, load:true, write:true.", "HTTP 3080 → 401, слушает pid 35192, создан 18:20:52 (процесс перезапущен владельцем).", "--dump-config: headroomTokens один раз в preset-architect = 32768; в preset-orchestrator ноль вхождений.", "check-boundaries --check → exit 0, gate ok — 5 excepted finding(s)."]
resultSummary: "Развёртывание подтверждено на новых версиях: drift null, план пуст, харнесс 0.2.2-rc.5, пакеты 0.1.24/0.1.10/0.1.98/0.1.11, проба патча зелёная, новый резерв 32768 только на маршруте Codex, гейт границ зелёный, сервер слушает 3080 (pid 35192)."
role: DEVOPS
scope: [.tmp/post-restart/]
---

Подтверди, что развёртывание после ручного перезапуска действительно собрано на новых версиях. Проверь и приложи вывод с кодами: (1) node scripts/kit-update.mjs --check --json — ожидается drift null и пустой план; (2) версии из C:\Users\1\.dsh\profiles\web\node_modules: @cc/dsh-project-state, @cc/dsh-state-feed, @cc/dsh-taskboard, @cc/dsh-proof-guard и версия установленного харнесса; (3) node scripts/harness-identity-guard.mjs --probe --json — проба должна быть зелёной; (4) HTTP на порту 3080 отвечает (401 на корне достаточно) и назови pid процесса; (5) --dump-config профиля web: в блоке preset-architect есть headroomTokens: 32768, в блоке preset-orchestrator его нет; (6) node scripts/check-boundaries.mjs --check — код 0. Ничего не перезапускай.
