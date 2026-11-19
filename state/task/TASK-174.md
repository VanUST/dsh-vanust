---
id: TASK-174
kind: task
title: "Инструмент outline для всех пресетов: плагин, провижининг, инвентарь"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.471Z
updatedAt: 2026-11-17T15:52:41.471Z
acceptance:
  - text: "node scripts/outline-selftest.mjs — exit 0, в выводе измеренные проценты экономии по двум реальным файлам, детерминизм и путь деградации"
    done: false
  - text: "mkdir -p /tmp/fakebin && printf '#!/bin/sh\\nexit 127\\n' > /tmp/fakebin/code-skeleton-mcp && chmod +x /tmp/fakebin/code-skeleton-mcp && PATH=/tmp/fakebin:$PATH node -e \"import('./plugins/outline/outline.mjs').then(m=>console.log(m.resolveOutlineBin()))\" → null или сообщение о недоступности, без исключения"
    done: false
  - text: "профиль: grep -n -A3 \"id: outline\" profile/cordis.patch.yml показывает ряд в верхней части файла, вне блоков preset-*"
    done: false
  - text: "инструмент зарегистрирован в подставном контексте для агента с пресетом research (как делался рендер раздела rtk): fake ctx.tools.register ловит name='outline'"
    done: false
  - text: "node scripts/provision-tools.mjs --check перечисляет code-skeleton-mcp; вывод 20/20 (или сколько станет) и exit 0"
    done: false
  - text: "node scripts/check-documentation.mjs — documentation ok (счётчики 24 согласованы), node scripts/check-portability.mjs — без провалов, связанных с новым плагином"
    done: false
  - text: "node scripts/pack-plugin.mjs --dir plugins/outline собрал plugins/cc-dsh-outline-<версия>.tgz и старый тарбол убран, если был"
    done: false
  - text: "в отчёте дословно процитирован раздел промпта и text ответа инструмента"
    done: false
boardId: task-mwkjc7nt-2kaqxc
nonScope: ["не перезапускать :3080 и не устанавливать тарболы в живой профиль", "не менять CHILD_POLICY и ROOT_POLICY оркестратора — правило поведения уже там, новый раздел говорит только про инструмент", "не вкладывать web-tree-sitter и грамматики в пакет и не добавлять runtime-зависимости в package.json", "не вызывать npx в рабочем пути инструмента: только уже установленный бинарь", "не трогать plugins/designmap/**, docs/TERMINOLOGY.md и прочие параллельные правки", "не править docs/analysis/code-outline-tool.json — запись анализа ведёт оркестратор", "не коммитить"]
owner:
  kind: agent
  label: BACKEND
  sessionId: f2acccf8-ca8a-480c-886e-498c6eebdbc9
ownerRole: BACKEND
preset: backend
resultEvidence: ["plugins/outline/* — 500 строк, scripts/outline-selftest.mjs, ряд профиля, пин 0.1.3, inventory 24 плагина", "провижининг 20/20, documentation ok"]
resultSummary: "Плагин outline, провижининг и учёт выполнены специалистом и проверены оркестратором."
role: BACKEND
scope: ["новый каталог plugins/outline: package.json (@cc/dsh-outline 0.1.0, files [outline.mjs, README.md], peerDependencies @deepseek-ai/cordis, без runtime-зависимостей), outline.mjs с инструментом и разделом промпта, README.md", "экспорты для селфтеста: resolveOutlineBin() и разбор вывода (например buildOutlineResult()/parseOutlineOutput()), по образцу экспорта classifyCommand в plugins/rtk/rtk.mjs", "инструмент outline: аргументы {path: string (обязательный), depth: integer 1..3 (по умолчанию 1), docstrings: boolean (по умолчанию true)}; кладёт в результат JSON-текст бинаря, проверяет, что JSON парсится; таймаут по умолчанию 10000 мс и предел вывода 256 КБ — оба в конфиге плагина", "раздел промпта: незнакомый файл — сначала outline, потом read нужного диапазона по offset/limit; назвать измеренные 83 148 Б → 4 792 Б; сказать, что тело не читается и что для не-кода нужен read; при отсутствии бинаря раздел говорит «outline unavailable» и куда смотрел плагин", "профиль: ряд `- insert: - id: outline / name: '@cc/dsh-outline'` в верхней части profile/cordis.patch.yml рядом с rtk, с комментарием почему host-уровень", "провижининг: scripts/provision-tools.mjs — запись инструмента code-skeleton-mcp, пин 0.1.3 (рядом с PINS), установка через installWithNpm, manual-строки для Windows", "scripts/outline-selftest.mjs по образцу scripts/rtk-selftest.mjs: два реальных файла кита (экономия ≥90%), детерминизм (два прогона байт-в-байт), путь без бинаря (PATH без code-skeleton-mcp → null), битый JSON и превышение предела вывода", "plugins/inventory.json: строка outline (mounted true); README.md и USERGUIDE.md: счётчик плагинов 23 → 24 и упоминание инструмента; rules/DEPLOYMENT.md: абзац провижининга; NOTICE: атрибуция code-skeleton-mcp 0.1.3 (MIT)", "node scripts/pack-plugin.mjs --dir plugins/outline (первый пак: --no-bump, версия 0.1.0)"]
sessions:
  - sessionId: f2acccf8-ca8a-480c-886e-498c6eebdbc9
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Добавить в кит плагин `@cc/dsh-outline` с инструментом `outline`, который отдаёт дешёвое оглавление файла (символы и диапазоны строк) через уже проверенный внешний бинарь code-skeleton-mcp, и смонтировать его на уровне хоста так, чтобы инструмент и его раздел промпта получил каждый агент: корень и все семь пресетов. Плагин деградирует без бинаря, провижининг ставит пинованную версию, инвентарь и документы согласованы, гейты кита зелёные.

Migrated from .dsh/taskboard.json (task task-mwkjc7nt-2kaqxc, revision 6).
