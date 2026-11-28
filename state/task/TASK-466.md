---
id: TASK-466
kind: task
title: "Снизить резерв под ответ для маршрута Codex по замеру"
status: done
revision: 5
createdAt: 2026-11-28T14:41:27.877Z
updatedAt: 2026-11-28T14:46:02.688Z
boardId: task-mx0iqaub-3kmyp9
chore: true
choreReason: "Владелец принял изменение настройки контекста по замеру: резерв под ответ на маршруте Codex снижается до 32 768, изменение вкладывается в текущий перезапуск."
nonScope: ["Не перезапускать сервер и не запускать kit-update --apply.", "Не менять другие настройки контекста и не трогать код плагинов."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["profile/cordis.patch.yml: preset-architect → compaction-basic получил headroomTokens: 32768; --dump-config показывает ровно одно вхождение, в блоке preset-architect; в блоке preset-orchestrator (flash) ноль.", "Порог Codex по формуле: 272 000 − 128 000 − 32 768 = 111 232 вместо 78 464.", "DEC-004 создан ядром состояния (revision 1, hash 417b8c16…, event 3426) с замером-основанием и ожиданием.", "kit-update --check --json: план содержит write-profile-files: cordis.patch.yml, install-plugins 0.1.23 и 0.1.10, write-rules; сервер не тронут."]
resultSummary: "Резерв под ответ на маршруте Codex снижен до 32 768 (порог сжатия 78 464 → 111 232), изменение подтверждено дампом конфигурации и внесено в план kit-update; решение записано в журнал как DEC-004 с замером-основанием."
role: DEVOPS
scope: [profile/cordis.patch.yml, state/decision/]
---

Задай резерв под ответ 32 768 для маршрута openai-codex/gpt-6.2-sol и запиши решение. Сделай: (1) в profile/cordis.patch.yml у строки настройки контекста для этого маршрута задай headroomTokens 32768 вместо 65536; (2) докажи --dump-config, что значение применилось именно к этому маршруту и не задело flash; (3) запиши решение через ядро состояния: изменение принято по замеру 41 сессии (19 сжатий на маршруте, порог 78 464, три шага после сжатия съедают до 26,6 % свежих токенов), ожидание — около 13 сжатий и порог около 111 232, проверка — разбор новых сессий той же формы; (4) прогони kit-update --check --json и приложи план: правка профиля должна быть в нём. Сервер не останавливай, apply не запускай.
