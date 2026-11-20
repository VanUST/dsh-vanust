---
id: TASK-264
kind: task
title: "Установка: Node 24.9, сохранение слоя, сторож сервера, бэкап и откат, обёртка Windows"
status: review
revision: 4
createdAt: 2026-11-20T11:51:18.417Z
updatedAt: 2026-11-20T12:11:54.512Z
boardId: task-mwox4jco-x23i62
nonScope: ["Не запускать установку и --apply против реального DSH_HOME и не перезапускать :3080", "Не менять пины версий харнесса и набор плагинов", "Не менять плагины и проверки — это другие задачи", "Не реализовывать откат данных: только откат установки (файлы профиля + бэкап)"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-176]
role: BACKEND
scope: ["install.sh, install.ps1, start.ps1", "scripts/kit-update.mjs, scripts/dsh-wrapper.sh, scripts/dsh-wrapper.ps1 (новый)", "scripts/installer-steps-proof.mjs и scripts/test/installer-steps.test.mjs — расширить доказательства", "rules/DEPLOYMENT.md, USERGUIDE.md — раздел отката и обёртка Windows"]
---

Сделать установку, обновление и откат безопасными и одинаковыми по смыслу на Linux и Windows. (1) Оба установщика проверяют версию Node по >= 24.9.0 (мажор и минор), а не только мажор. (2) install.ps1 при отличающемся $DSH_HOME-слое cordis.patch.yml сохраняет копию рядом (.bak с меткой времени) и предупреждает — как install.sh. (3) Сторож живого сервера в kit-update перестаёт зависеть от /proc: проверка «порт профиля отвечает HTTP» работает на всех платформах, плюс сохранить /proc как дополнительный признак на Linux; start.ps1 вызывает эту проверку до --apply. (4) Перед --apply kit-update складывает cordis.patch.yml и mcp-servers.json в $DSH_HOME/.dsh-kit-backups/<штамп>/ и печатает путь. (5) procedures: в rules/DEPLOYMENT.md появляется раздел «Откат» с точной последовательностью (git checkout прежнего коммита кита → kit-update --apply → --check --json без расхождений) и восстановлением из бэкапа; добавить в kit-update флаг --restore <штамп>, который возвращает файлы из бэкапа. (6) Windows получает обёртку сходимости: scripts/dsh-wrapper.ps1 (аналог dsh-wrapper.sh: перед запуском dsh web применяет kit-update --check и предлагает обновление) и шаг установки в install.ps1, кладущий её в $DSH_HOME\bin с подсказкой про PATH. Проверить всё на временном DSH_HOME во /tmp: установка не должна касаться реального профиля.
