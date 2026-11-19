---
id: TASK-105
kind: task
title: "PTC-презентация для BACKEND и RESEARCH"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.327Z
updatedAt: 2026-11-17T15:52:40.327Z
boardId: task-mwdm75j0-cozqvm
inline: true
nonScope: ["не включать PTC для orchestrator, docs, ux, reviewer, critic", "не менять dsh-tools mode глобально и не ставить DSH_TOOLS_MODE", "не перезапускать :3080 — активация после рестарта человеком"]
resultEvidence: ["python-проверка позиций: 'tool-presentation under: preset-backend', 'tool-presentation under: preset-research'; YAML ok, entries: 28", "dsh --profile web --dump-config после kit-update: preset-backend ptc=True, preset-research ptc=True, preset-orchestrator/ux/reviewer/critic/docs ptc=False", "node scripts/kit-update.mjs --apply --keep-model-config → actions=write-profile-files,write-rules,..., restart=required, exit 0", "check-documentation → documentation ok; check-portability → 17/17", "Второй сервер :3081 поднялся (URL с токеном), в логе нет 'refuses to mount'/'did not activate'/'failed to import'; погашен, :3080 не затронут", "В собранной композиции уже присутствует бандловый пресет 'ptc' (id: ptc, order 2) — runtime PTC в деплое смонтирован"]
resultSummary: "PTC включён для двух ролей: в kit-профиль в пресеты preset-backend и preset-research добавлен ряд @deepseek-ai/dsh-agent-tool-presentation с mode: ptc; остальные пять ролей остались native, причина записана в rules/DEPLOYMENT.md таблицей. Изменение прогнано через kit-update --apply, собранная композиция подтверждает ptc ровно у двух пресетов, гейты зелёные, второй сервер :3081 поднялся без ошибок монтирования. Активация — после рестарта :3080."
scope: ["profile/cordis.patch.yml — ряды в пресетах preset-backend и preset-research", "rules/DEPLOYMENT.md — запись о том, какие роли на PTC и почему", "git-поля kit-а после kit-update --apply"]
---

Включить PTC-презентацию инструментов (@deepseek-ai/dsh-agent-tool-presentation, mode: ptc) для пресетов BACKEND и RESEARCH в kit-профиле, задокументировать, почему ORCHESTRATOR/DOCS/UX остаются native, провести изменение через kit-update и подтвердить на втором сервере, что рантайм смонтирован без ошибок.

Migrated from .dsh/taskboard.json (task task-mwdm75j0-cozqvm, revision 4).
