---
id: TASK-461
kind: task
title: "Подготовить переход на харнесс 0.2.2-rc.5"
status: done
revision: 5
createdAt: 2026-11-28T14:12:13.249Z
updatedAt: 2026-11-28T14:25:49.829Z
boardId: task-mx0hooyt-hcb5sb
nonScope: ["Перезапуск сервера и kit-update --apply: это делает владелец одной командой.", "Изменение кода плагинов, кроме уже принятого."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
reqIds: [REQ-302]
resultEvidence: ["profile/cordis.patch.yml: явная строка - id: web с searchProvider: deepseek-search-api.", "npm install -g @deepseek-ai/dsh@0.2.2-rc.5 → exit 0; глобальный package.json version 0.2.2-rc.5.", "identity guard: --probe до патча exit 3, --apply exit 0 (sha256 fc8aaea7…), --probe после exit 0.", "project-state 0.1.22 → 0.1.23 собран (sha256 14f699ec…), прежний пакет удалён.", "kit-update --check --json: write-profile-files, install-plugins (0.1.23 и 0.1.10), write-rules; install-harness в плане нет. Сервер не останавливался (:3080 pid 54308)."]
resultSummary: "Переход на 0.2.2-rc.5 подготовлен: searchProvider задан явно, харнесс установлен и пропатчен (проба зелёная), пакет состояния 0.1.23 собран, план kit-update содержит только пакеты и запись профиля. Осталось: apply и перезапуск владельцем."
role: DEVOPS
scope: [profile/cordis.patch.yml, packages/, .tmp/upgrade-prep/]
---

Подготовь переход на харнесс 0.2.2-rc.5, оставив живой сервер нетронутым до перезапуска владельца. Сделай: (1) задай searchProvider: deepseek-search-api явно в profile/cordis.patch.yml, чтобы поведение не зависело от дефолта харнесса, и докажи --dump-config, что строка web снова его содержит; (2) поставь глобально @deepseek-ai/dsh@0.2.2-rc.5 и назови путь и версию; (3) примени патч identity guard к новой установке и приложи --probe: до применения красный, после зелёный; (4) собери пакеты кита, чьи исходники изменились после прошлой сборки (project-state — план с решениями), подними версию и удали прежний пакет; (5) прогони kit-update --check --json и приложи план: должно остаться только установка пакетов и запись профиля. Сервер не останавливай, apply не запускай.
