# Доказательства плагинов dsh-kit

**Снимок:** рабочее дерево `/home/iustimov/dsh-kit`, 2026-11-17 (аудит — по отчёту от 14:17, перепроверка — 14:49–14:59 MSK, удаление `babysitter` — 2026-11-17).
**Источник первичных прогонов:** `reports/plugin-audit/FINDINGS.md` — там команда, код возврата и наблюдённый вывод каждого прогона. Эта страница сводит их в одну таблицу на 23 плагина, называет статус каждого и отдельно перечисляет то, чего доказательства нет.
**Версии и смонтированность:** `plugins/inventory.json` и `plugins/*/package.json` на момент снимка.

## Зачем это

Аудит не-дефолтных плагинов нашёл, что доказательств меньше, чем плагинов: у девяти плагинов нет ни одного собственного прогона, `notify` проверен только в режиме без запуска, а живой редактор Godot в этой машине недоступен (`reports/plugin-audit/FINDINGS.md`, §1 и §6). Плагин `babysitter` удалён из кита 2026-11-17 по решению владельца; его прогон и дефект остались историей (см. «Удалённый `babysitter`»). Десятый непроверенный плагин — `godot-mcp`: у него есть причина, а не прогон (см. «Godot: не проверено»). «Плагин есть в инвентаре» и «плагин проверен» — разные утверждения; эта страница существует, чтобы их нельзя было перепутать.

Страница описывает **рабочее дерево**, а не запущенную копию. Профиль на `http://127.0.0.1:3080` отстаёт от дерева: в нём `designmap` 0.1.15, `orchestrator` 0.1.45, `rtk` 0.1.5 и нет `outline` (проверено по `~/.npm/dsh/profiles/web/package.json`, 2026-11-17). Поэтому ни один прогон ниже не доказывает поведение живого харнесса — только поведение исходников, из которых он будет собран после обновления профиля (`docs/HARNESS-OVERVIEW.md`, §8.1).

## Как читать таблицу

- **Подтверждено прогоном** — выполнена команда, известны её код возврата и наблюдённый результат; подробности — в первоисточнике.
- **Частично** — прогон есть, но покрывает не всё поведение плагина; примечание говорит, что осталось.
- **Прогон неуспешен** — команда выполнена и вернула не 0; это находка о продукте, а не отсутствие доказательства.
- **Не проверено** — собственного прогона нет; причина названа в примечании.
- **Не смонтирован** — строки нет в `profile/cordis.patch.yml`, поведение в живом харнессе отсутствует.

Пометка «перепроверено» означает, что команда запущена в этой задаче 2026-11-17 и её вывод процитирован в разделе «Перепроверено в этой задаче». Без пометки результат взят из отчёта аудита и в этой задаче не повторялся.

## Сводка

| Статус | Плагинов |
|---|---:|
| подтверждено прогоном | 10 |
| частично | 2 |
| не смонтирован | 1 |
| не проверено | 10 |
| **всего** | **23** |

## Таблица

| id | Версия | Смонтирован | Что регистрирует | Доказательство | Статус |
|---|---|---|---|---|---|
| `presentation` | 0.1.9 | да | инструмент `presentation`; только `standard`, `orchestrator`, `ux` (`plugins/presentation/index.js:27-34`) | своего прогона нет; упоминается только в `check-portability` | не проверено |
| `diagrams` | 0.1.5 | да | инструмент `diagram`; только `standard`, `orchestrator`, `ux` (`plugins/diagrams/index.js:27-34`) | своего прогона нет | не проверено |
| `work-modes` | 0.1.9 | **нет** | 0 инструментов, 2 перехвата (`subagent/start`, `subagent/end`) (`plugins/work-modes/work-modes.mjs:600,610`) | `mounted: false` (`plugins/inventory.json`); своего прогона нет | не смонтирован |
| `godot-mcp` | 0.1.6 | да | раздел промпта `godot:mcp` (`plugins/godot-mcp/godot-mcp.mjs:624-625`) и декларация MCP-сервера; сам MCP-ряд — в домашнем `$DSH_HOME/cordis.patch.yml` | своего прогона нет; живого редактора Godot нет — см. «Godot: не проверено» | не проверено |
| `notify` | 1.1.3 | да | 0 инструментов, 2 перехвата (`agent/status`, `user-questions/request`) (`plugins/notify/plugin-notify.mjs:378,422`) | `node scripts/notify-selftest.mjs --dry-run` → exit 0, `dry-run: nothing was spawned` (перепроверено) | частично: попап не поднимался |
| `image-window` | 0.1.1 | да | перехват `agent/created` → `session/event`; проекция, вытесняющая старое изображение (`plugins/image-window/image-window.mjs:129-140`) | своего прогона нет | не проверено |
| `skills` | 0.1.16 | да | 20 навыков через `ctx.skills.register` (`plugins/skills/index.js:198`) | своего прогона нет | не проверено |
| `flash-guard` | 0.1.2 | да | перехват `agent/request` (`plugins/flash-guard/flash-guard.mjs:217`) | `node scripts/dsh-migration-proof.mjs` → exit 0, 16/16 | подтверждено прогоном |
| `proof-guard` | 0.1.1 | да | перехват `tools/pre-execute`; отказ записи теста без заголовка `PROOF:` (`plugins/proof-guard/proof-guard.mjs:130`) | своего прогона нет | не проверено |
| `taskboard` | 0.1.56 | да | 12 инструментов `task_*`, сервис `taskboard`, команда `/taskboard`, панель Tasks | 5 прогонов: роль 15/15, лимит 13/13, аренда 27/27, close-stop 40/40, область чата 26/26; все exit 0 | подтверждено прогоном |
| `orchestrator` | 0.1.48 | да | инструмент `delegate_task`, разделы `deployment:orchestrator-policy` и `deployment:specialist-policy`, перехват `session/event` | `node scripts/analysis-before-decomposition-proof.mjs` → exit 0, 130/130 (включая реальное тело `delegate_task`) | подтверждено прогоном |
| `papers` | 0.1.5 | да | инструменты `papers_search`, `papers_trending`, `papers_download`; только `standard`, `research` (`plugins/papers/papers.mjs:444`) | своего прогона нет | не проверено |
| `rtk` | 0.1.7 | да | 0 инструментов; перехват `tools/post-execute` и раздел промпта; только `bash`/`pwsh` (`plugins/rtk/rtk.mjs:103`) | `node scripts/rtk-selftest.mjs` → exit 0: 6 сжато, 3 прошли без изменений, 0 неуспешных, 4 137 356 Б сэкономлено | подтверждено прогоном |
| `outline` | 0.1.1 | да | инструмент `outline` и раздел промпта `outline:index` | `node scripts/outline-selftest.mjs` → exit 0, 6/6; экономия 94.2% и 91.2% на двух реальных файлах (перепроверено) | подтверждено прогоном |
| `skill-evolve` | 0.1.5 | да | 4 инструмента (`skill_inventory`, `skill_evolve`, `skill_grow`, `skill_forget`) и раздел `skills:evolve` | своего прогона нет | не проверено |
| `research-first` | 0.1.4 | да | перехват `tools/pre-execute`, инструмент `research_waive`, раздел `research:first` (`plugins/research-first/research-first.mjs:177,203,237`) | своего прогона нет | не проверено |
| `project-rules` | 0.1.10 | да | раздел `project:rules` из `.dsh/rules.md` и панель Rules; правка файла агенту запрещена (`rules_human_only`) (`plugins/project-rules/index.js:323,348,361`) | своего прогона нет | не проверено |
| `test-cases` | 0.1.12 | да | 12 инструментов `case_*`, команда, сервисы, панель | `node --test plugins/test-cases/test/runner.test.mjs` → exit 0, 12 pass | подтверждено прогоном |
| `analysis` | 0.1.9 | да | 4 корневых инструмента `analysis_*` и раздел `deployment:analysis-policy` (`plugins/analysis/analysis.mjs:203`) | тот же прогон `analysis-before-decomposition-proof` → exit 0, 130/130 | подтверждено прогоном |
| `session-budget` | 0.1.2 | да | 0 инструментов; перехват `agent/pre-step` и проекция счётчика шагов; пороги 300/400/500 (`plugins/session-budget/session-budget.mjs:91`) | `node plugins/session-budget/proof/proof.mjs` → exit 0, 15 проверок PASS | подтверждено прогоном |
| `run-code-projection` | 0.1.1 | да | 0 инструментов; перехват `tools/post-execute` для `run_code` | `node plugins/run-code-projection/proof/proof.mjs` → exit 0, 13 проверок PASS | подтверждено прогоном |
| `tool-families` | 0.1.8 | да | 0 инструментов; 4 перехвата: `agent-preset/selected`, `session/event`, `agent/created`, `agent/pre-step` | `node scripts/tool-families-proof.mjs` → exit 0, 62/62 (перепроверено); политика доказана для native, в PTC не действует — см. «Оговорка PTC» | частично |
| `designmap` | 0.1.17 | да | 7 инструментов `designmap_*` только для `orchestrator` (`plugins/designmap/index.js:53-56`), команда `/designmap`, панель Design map | `cd plugins/designmap && node --test test/*.test.mjs` → exit 0, 125 тестов, 125 pass (перепроверено); упаковка 0.1.17 совпадает с исходником — см. «Упаковка `designmap` 0.1.17» | подтверждено прогоном |

## Godot: не проверено

`godot-mcp` и MCP-сервер Godot намеренно оставлены без статуса «подтверждено»:

- в этой рабочей копии нет `project.godot`, поэтому `mcp__godot__*` отсутствуют в заголовке запроса — проекция семейств их снимает (`projectDeny`);
- 30 имён `mcp__godot__*` и 60 679 Б схем взяты из `reports/preset-context-evidence.md`, а не из текущего `request/header` (`reports/plugin-audit/FINDINGS.md`, §4);
- живого редактора Godot на машине нет, поэтому `scripts/dsh-mcp-sync.mjs` и вызов любого `mcp__godot__*` не выполнялись.

Следующий шаг: открыть Godot-проект с запущенным редактором, снять `request/header` свежей сессии и сверить 30 имён; до этого плагин считается непроверенным, а не работающим.

## Оговорка PTC

Все прогоны выше доказывают **native**-поведение: набор инструментов, который харнесс строит сам. В PTC набор строит сгенерированный SDK, и аудит измерил расхождение: в `ToolArgsMap` сессий gatherer и reviewer остаются 24 инструмента `mcp__playwright__*`, которые политика роли запрещает, плюс `designmap_*` (7), `presentation` и `diagram`, которых у этих ролей нет (`reports/plugin-audit/FINDINGS.md`, §5).

Из этого следуют ограничения статусов:

- `tool-families` — «частично»: запрет семейств доказан для native-заголовка и не действует в PTC;
- `presentation`, `diagrams`, `designmap` — их появление в чужом PTC-SDK не проверено на вызов; отказ или успех не записан.

Плагин `babysitter` удалён из кита 2026-11-17; его появление в PTC-SDK остаётся историческим наблюдением аудита (§5 отчёта), текущей поверхности оно больше не описывает.

Причина не изолирована, вызовность не проверена. Это работа для задачи о PTC, а не для этой страницы.

## Упаковка `designmap` 0.1.17

Тарбол `plugins/cc-dsh-designmap-0.1.17.tgz` совпадает с исходником `plugins/designmap`:

- `node scripts/check-portability.mjs` → exit 0, 17/17 проверок, включая `tarball:matches-source` и `tarball:version-bumped` (перепроверено);
- в тарболе 11 записей: `package.json`, `README.md`, `client.js`, `client.frame.js` и 6 модулей `dist/`; все 10 файлов, кроме манифеста, совпадают с исходником побайтово (`cmp`), манифест совпадает как документ (та же версия 0.1.17 и те же поля);
- `sha256` тарбола: `b1e70df5363fee27d2b8f373a215b0cdae6272c4117cc9b67fe8c0bd46f8b62c`.

Это закрывает находку аудита «`check-portability` exit 1: `cc-dsh-designmap-0.1.16.tgz` расходится с исходником по `README.md`» (`reports/plugin-audit/FINDINGS.md`, §6, последняя строка). Там описан тарбол 0.1.16; текущий 0.1.17 перепакован и проверку проходит. В отчёте аудита эта строка не исправлена — он остаётся снимком своего времени, а актуальное состояние упаковки — здесь.

## Удалённый `babysitter` (2026-11-17)

Плагин удалён из кита по решению владельца: он им не пользуется. Удалены `plugins/babysitter/` (0.1.7), оба тарбола (`cc-dsh-babysitter-0.1.6.tgz`, `cc-dsh-babysitter-0.1.7.tgz`), `scripts/babysitter-selftest.mjs` и строка `plugins/inventory.json`; счётчик плагинов 24 → 23.

Дефект `initial_status`, найденный аудитом, был реальным и исправлен в 0.1.7 перед удалением: задача создавалась `open` и переводилась в `active` тем же сервисом, после прогона уходила в `review`. Прогон селфтеста 2026-11-17 14:59 (`SELFTEST PASSED`, `taskId task-mwkn3jf2-x5qzsn`, `taskStatus review`, `taskRevision 10`, `taskboardErrors: []`) и аудит остаются доказательством, что дефект существовал. В текущем ките ни плагина, ни селфтеста нет, поэтому строка матрицы и команда перепроверки удалены.

## Перепроверено в этой задаче

| Команда | Результат |
|---|---|
| `node scripts/check-portability.mjs` | exit 0, 17/17 |
| `make verify` (обе проверки кита) | exit 0, `documentation ok` |
| `node scripts/tool-families-proof.mjs` | exit 0, 62/62 |
| `node scripts/outline-selftest.mjs` | exit 0, 6 passed, 0 failed |
| `node scripts/notify-selftest.mjs --dry-run` | exit 0, `dry-run: nothing was spawned` |
| `cd plugins/designmap && node --test test/*.test.mjs` | exit 0, 125 tests, 125 pass |

## Что осталось

| Плагин | Чего нет | Следующий шаг (одна строка) |
|---|---|---|
| `presentation` | ни одного прогона | прогон в поддельном контексте: инструмент виден трём пресетам и не виден остальным |
| `diagrams` | ни одного прогона | то же для `diagram` |
| `papers` | ни одного прогона | прогон на одном запросе без сети и с отказом по таймауту |
| `skills` | ни одного прогона | прогон: 20 навыков зарегистрированы и читаются каталогом |
| `skill-evolve` | ни одного прогона | прогон четырёх инструментов на временном каталоге навыков |
| `research-first` | ни одного прогона | прогон: создание файла без источника отказано, после `research_waive` разрешено |
| `project-rules` | ни одного прогона | прогон: раздел собран из `.dsh/rules.md`, правка файла отказана `rules_human_only` |
| `proof-guard` | ни одного прогона | прогон: запись теста без `PROOF:` отказана, с заголовком разрешена |
| `image-window` | ни одного прогона | прогон: третье изображение вытесняет первое, вложенные изображения PTC не проверены |
| `notify` | реального запуска | один прогон без `--dry-run` на этой машине |
| `godot-mcp` | живого редактора Godot | снять `request/header` сессии с открытым Godot-проектом (см. «Godot: не проверено») |
| `tool-families` | проверки в PTC | воспроизвести на втором сервере и вызвать один запрещённый инструмент из программы (см. «Оговорка PTC») |

## Как перепроверить

Все команды — из `/home/iustimov/dsh-kit`.

```bash
node scripts/check-portability.mjs
node scripts/check-documentation.mjs
make verify

node scripts/dsh-migration-proof.mjs
node scripts/taskboard-role-proof.mjs
node scripts/taskboard-limit-proof.mjs
node scripts/taskboard-lease-proof.mjs
node scripts/taskboard-close-stop-proof.mjs
node scripts/taskboard-chat-scope-proof.mjs
node scripts/analysis-before-decomposition-proof.mjs
node scripts/rtk-selftest.mjs
node scripts/outline-selftest.mjs
node scripts/tool-families-proof.mjs
node scripts/notify-selftest.mjs --dry-run

node plugins/session-budget/proof/proof.mjs
node plugins/run-code-projection/proof/proof.mjs
node --test plugins/test-cases/test/runner.test.mjs
cd plugins/designmap && node --test test/*.test.mjs
```

Прогон относится к снимку: если исходник плагина изменился после него, строку нужно перепроверить, а не считать доказанной. Версии в таблице — из `plugins/*/package.json`; после перепаковки тарбола версия обязана измениться, иначе профиль продолжит ставить старые байты (`tarball:version-bumped` в `scripts/check-portability.mjs`).
