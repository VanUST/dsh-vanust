---
id: TASK-478
kind: task
title: "Outline: включить инструмент или убрать объявление из промпта"
status: done
revision: 5
createdAt: 2026-11-28T16:05:57.593Z
updatedAt: 2026-11-28T16:10:11.774Z
boardId: task-mx0lqx7m-09pfxy
chore: true
choreReason: "Каждый промпт несёт блок о недоступном outline, а установленный бинарь не зарегистрирован: либо инструмент включается, либо блок убирается."
nonScope: ["Не менять наборы инструментов других пресетов; не трогать развёртывание до перезапуска владельцем."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["Выбран исход (б): profile/cordis.patch.yml, строка @cc/dsh-outline получила config enabled: false; при enabled=false плагин выходит из apply() до регистрации инструмента и секции outline:index.", "Причина: на Windows npm-шим code-skeleton-mcp — .cmd плюс extensionless sh; executableOnPath в @cc/dsh-outline/outline.mjs:122-129 добавляет только .exe, поэтому PATH-резолв null; spawnSync на extensionless shim → ENOENT, на .cmd → EINVAL.", "Сам бинарь исправен: node code-skeleton-mcp/dist/index.js outline scripts/check-boundaries.mjs --depth 1 → exit 0, JSON с символами.", "--dump-config показывает config: enabled: false; apply(enabled:false) возвращает undefined и не трогает ctx; sectionText(null) — тот блок, который больше не регистрируется.", "schema-lint exit 0 (0 red), check-preset-configs exit 0 (147 строк, 0 отказов), check-boundaries exit 0, make verify exit 0; kit-update plan = write-profile-files: cordis.patch.yml."]
resultSummary: "Outline остаётся выключенным и объявление о его отсутствии убрано из промпта: плагин не умеет запускать Windows-шим (.cmd через shell), поэтому PATH-резолв всегда пуст; сам бинарь исправен, гейты и make verify зелёные."
role: DEVOPS
scope: [profile/cordis.patch.yml, .tmp/outline/]
---

Разберись с outline: бинарь code-skeleton-mcp 0.1.3 установлен, шимы на месте, но инструмент не зарегистрирован, и каждый промпт несёт блок «OUTLINE: unavailable». Выясни, почему он не поднимается (конфигурация mcp-сервера, имя пакета, путь к бинарю), и сделай один из двух исходов: (а) инструмент регистрируется и отвечает на простом вызове — покажи вывод; (б) инструмент остаётся недоступным, и тогда блок объявления убирается из промпта, а причина записывается одной строкой в правила. Докажи выбранный исход: либо ответ инструмента на файл, либо отсутствие блока в собранном промпте и зелёные проверки схем.
