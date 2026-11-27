---
id: TASK-342
kind: task
title: "Убрать следы retired-плагина дизайн-карты из README, процедуры и отчёта аудита"
status: done
revision: 11
createdAt: 2026-11-27T12:35:40.586Z
updatedAt: 2026-11-27T12:55:47.220Z
acceptance:
  - text: "В rules/DEPLOYMENT.md нет утверждений, что source/tarball/inventory retired-плагина @cc/dsh-design-map остались для отката: их нет в дереве (проверено: plugins/design-map/ отсутствует, в inventory только designmap)."
    done: false
  - text: "Таблица «who may change what» называет живую дизайн-карту (designmap/pages/*.excalidraw через map_edit/map_read/map_render и панель), а не design.excalidraw и не инструмент design_map."
    done: false
  - text: "README.md в дереве каталога больше не перечисляет plugins/design-map/."
    done: false
  - text: "reports/legacy-audit.md содержит раздел поправок: строка 17 была опровергнута проверкой, с командами и выводом; доказательные скрипты, переставшие воспроизводить результат, названы."
    done: false
  - text: "Повторный поиск висячих ссылок по удалённым путям (вне docs/cases, docs/analysis, state, фикстур) пуст, команда и результат процитированы."
    done: false
  - text: "make verify зелёный после правок, хвост вывода и код выхода процитированы."
    done: false
  - text: "Проверка документации печатает «6 rule(s)» и краснеет, если в GUIDE вернуть одну формулировку правила: негативный контроль выполнен, вывод и возврат файла процитированы."
    done: false
  - text: "Оркестратор пересобран после двух правок оркестратора и проверки; версия, tarball и вывод diff source↔tarball процитированы."
    done: false
boardId: task-mwyysopp-y4c885
nonScope: ["Не переписывать историю: строки о retired-плагине либо удаляются, либо помечаются как удалённые с датой и коммитом; выдумывать новые факты нельзя.", "Не менять политику оркестратора и GUIDE §8.", "Не применять kit-update и не перезапускать сервер."]
owner:
  kind: agent
  label: DOCS
preset: docs
reqIds: [REQ-267]
resultEvidence: ["rules/DEPLOYMENT.md: строка retired @cc/dsh-design-map удалена; строка designmap переписана на живой page store (designmap/pages/*.excalidraw, пять map_* инструментов, Project state → Map) с датированным маркером удаления 1f811c3/2026-11-16; grep 'stay for rollback|design_map|design.excalidraw' → GREP_EXIT=1.", "Таблица «who may change what» и абзац gating называют живую карту и пресеты orchestrator+architect; источник — profile/cordis.patch.yml:103-121 и plugins/designmap/index.js:99-142.", "README.md: строка plugins/design-map/ удалена, grep → GREP_EXIT=1.", "reports/legacy-audit.md: строка 17 помечена superseded, добавлен раздел 'Corrections, 2026-11-27' с командами до/после и названными четырьмя /tmp-скриптами, которые больше не воспроизводят результат.", "check-documentation: [PASS] the development rules have one owner — 6 rule(s) …; documentation ok; EXIT=0.", "Негативный контроль: внедрённая в GUIDE строка «A rule lives in ONE place.» → [FAIL] docs/GUIDE.md repeats A rule lives in ONE place, EXIT=1; после удаления строки снова зелёный, diff до/после пуст, sha256 git diff совпал.", "Пересборка: pack-plugin 0.1.77 → 0.1.78, tarball cc-dsh-orchestrator-0.1.78.tgz, sha256 ffcb59a83602521b142bc943eac8daf6fdc93fbb2ad28aee41bf43e04cc91aac; tar-содержимое против source → IDENTICAL.", "make verify exit 0 (PASS 6 rule(s) в логе, portability 20/20); make test ONLY=orchestrator 8/8 exit 0.", "Поиск удалённых путей по живому дереву (ledgers/fixtures исключены) пуст, EXIT=1; широкий поиск даёт одну датированную историческую строку rules/DEPLOYMENT.md:26."]
resultSummary: "Следы retired-плагина дизайн-карты убраны из живой процедуры и README: строка каталога удалена, строка designmap переписана на живую модель страниц, таблица владения больше не учит несуществующему design_map. Отчёт аудита получил раздел поправок с командами, которые опровергли его строку о висячих ссылках. Проверка документации печатает 6 правил и зелёная; негативный контроль на возвращённой копии дал красный прогон, файл возвращён байт-в-байт. Оркестратор пересобран 0.1.78, tarball идентичен исходнику, make verify exit 0, ONLY=orchestrator 8/8."
role: DOCS
scope: [README.md, rules/DEPLOYMENT.md, reports/legacy-audit.md]
---

Проверка отчёта аудита опровергла его собственную строку «висячие ссылки вычищены»: durable-процедура и README продолжают описывать удалённые артефакты retired-плагина дизайн-карты (design.excalidraw, plugins/design-map/, cc-dsh-design-map-0.2.0.tgz) как живые, включая таблицу «кто что меняет», которая учит агента несуществующему инструменту design_map. Убрать следы из README.md и rules/DEPLOYMENT.md, заменив их живой дизайн-картой (designmap v2), и внести в reports/legacy-audit.md раздел поправок с командами, которые это доказали.
