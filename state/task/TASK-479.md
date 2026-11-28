---
id: TASK-479
kind: task
title: "Outline: запуск Windows-шима через PATHEXT и shell"
status: done
revision: 6
createdAt: 2026-11-28T16:08:52.721Z
updatedAt: 2026-11-28T16:42:24.399Z
boardId: task-mx0lupmh-2ai2xh
chore: true
choreReason: "Outline установлен, но не работает на Windows из-за резолва .cmd-шима — инструмент, который экономил 93 % байтов на чтении файлов, простаивает."
nonScope: ["Не включать outline в профиле; это отдельное решение после проверки.", "Не трогать другие плагины и развёртывание."]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["Резолв через PATHEXT (bare name последним) находит npm-шим code-skeleton-mcp.cmd; запуск .cmd/.bat идёт через cmd.exe /d /s /c с собственным квотированием (CommandLineToArgvW) и windowsVerbatimArguments, .exe — напрямую.", "Почему не shell: true: замерено, что Node склеивает без экранирования — путь шима с пробелом расщепляется, аргумент с & уходит в cmd как команда (Node 24 doc, DEP0190).", "Тест plugins/outline/test/outline-shim.test.mjs: 7/7 зелёные; с CASE_NEGATIVE_CONTROL=expect-pre-fix падает (exit 1); case_run red на копии до правки (mx0m5yb9-7gu8y-1, exit 1) и green (mx0m6106-ixdox-1, exit 0), кейс verified.", "Настоящий бинарь через плагин: resolveOutlineBin() → code-skeleton-mcp.cmd, 20 символов для outline.mjs, exit 0; outline-selftest PASS 6/6; пустой PATH даёт понятный отказ и OUTLINE: unavailable."]
resultSummary: "Outline запускается на Windows: резолв через PATHEXT находит .cmd-шим, вызов идёт через cmd.exe с собственным квотированием (shell: true отвергнут по замеру), тест 7/7 с негативным контролем, кейс verified, настоящий бинарь отдаёт 20 символов через плагин."
role: BACKEND
scope: [plugins/outline/]
---

Почини запуск outline на Windows. Сейчас резолв в plugins/outline/outline.mjs (около строк 122-129) ищет только .exe, поэтому npm-шим code-skeleton-mcp (.cmd плюс extensionless sh) не находится: PATH-резолв возвращает null, spawnSync на shim без расширения даёт ENOENT, на .cmd — EINVAL без shell. Сделай: (1) резолв учитывает PATHEXT (как минимум .cmd, .exe, .bat) и возвращает полный путь шима; (2) вызов .cmd/.bat идёт через shell с аргументами списком, .exe — напрямую; (3) тест: фиктивный каталог с шимом .cmd в PATH — инструмент резолвится и вызывается, аргументы доходят, отсутствие шима даёт понятный отказ; (4) прогони тесты плагина и проверь на настоящем code-skeleton-mcp, что ответ приходит. Верни коды прогонов, вывод настоящего вызова и что осталось проверить после включения в профиле.
