---
id: TASK-339
kind: task
title: "Правила разработки: один владелец, и правило в проекте = правило в работе"
status: done
revision: 5
createdAt: 2026-11-27T12:26:35.542Z
updatedAt: 2026-11-27T12:49:15.907Z
acceptance:
  - text: "В ROOT_POLICY рядом с пятью правилами стоит правило: изменение в проекте не действует, пока машина не сведена и сервер не перезапущен; названа одна команда (kit-update --check) и порядок остановить→применить→запустить."
    done: false
  - text: "docs/GUIDE.md §8 — указатель на владельца правила (ROOT_POLICY), копии пяти формулировок нет; §9 ловушки остаются."
    done: false
  - text: "scripts/check-documentation.mjs проверяет: пять формулировок есть в политике и ни одной нет в GUIDE; проверка красная, если копию вернуть."
    done: false
  - text: "README.md ссылается на §8-9 по новому смыслу; ни одна ссылка не ведёт в удалённый раздел."
    done: false
boardId: task-mwyyh01g-ocsn5d
inline: true
nonScope: ["Применение изменений к машине (kit-update --apply) и перезапуск сервера — это делает владелец вручную.", "Пересборка tarball плагина и прогон make verify/make test — отдельная задача DOCS.", "Удаление страниц документации — отдельная задача DOCS."]
reqIds: [REQ-268, REQ-270]
resultEvidence: ["plugins/orchestrator/orchestrator.mjs:458 — шестое правило (f): «A rule in the kit is not a rule in force», с командой node scripts/kit-update.mjs --check --json и порядком stop → --apply → start → --check без расхождения; версии в тексте не названы, чтобы ссылка не сгнила.", "docs/GUIDE.md §8 — указатель на владельца (ROOT_POLICY) вместо копии пяти формулировок; §9 (ловушки) сохранён, вступительная фраза поправлена.", "scripts/check-documentation.mjs — заявка «the development rules have one owner»: пять формулировок в политике, ни одной в GUIDE, плюс RULE_OPENINGS дополнен правилом (f) после того, как DOCS показал, что оно не проверялось.", "Прогон DOCS (TASK-342): [PASS] the development rules have one owner — 6 rule(s) в plugins/orchestrator/orchestrator.mjs, none copied into docs/GUIDE.md; documentation ok.", "Негативный контроль (TASK-342): с внедрённой в GUIDE строкой «A rule lives in ONE place.» проверка красная — [FAIL] … docs/GUIDE.md repeats A rule lives in ONE place, EXIT=1; после удаления строки снова зелёная, diff до/после пуст (sha git diff совпал).", "README.md: «docs/GUIDE.md §8-9: where the working rules live, and the traps that already cost a retry»; 8 относительных ссылок README разрешаются (missing 0).", "docs/analysis/project-hygiene-guide-and-docs.json rev 17: FR5 добавлен, решение D7 (каналы правил по сроку жизни), шесть требований закрыты как deferred с причинами; docs/cases/pravila-razrabotki-v-prompte-orkestratora-a-ne-skillom.json (TEST-099, source: human, unverified)."]
resultSummary: "Класс «правило живёт в двух местах / инструмент есть, а поведение не меняется» учтён в пресете оркестратора тремя изменениями: (1) шестое правило разработки (f) — изменение в ките не действует, пока машина не сведена и сервер не перезапущен, с единственной командой, которая это решает; (2) GUIDE §8 больше не копирует пять правил, а указывает на владельца; (3) проверка дерева отказывает, если копия возвращается, и теперь покрывает все шесть правил. Покрытие и красный прогон измерены (6 rule(s) зелёный, возвращённая формулировка красный, файл возвращён байт-в-байт)."
scope: [plugins/orchestrator/orchestrator.mjs, docs/GUIDE.md, README.md, scripts/check-documentation.mjs, docs/analysis/project-hygiene-guide-and-docs.json]
---

Учесть в пресете оркестратора класс «правило живёт в двух местах / инструмент есть, а поведение не изменилось»: (1) добавить в ROOT_POLICY шестое правило разработки — правило в ките не действует, пока машина не сведена и сервер не перезапущен, с единственной командой, которая это решает; (2) снять копию пяти правил из docs/GUIDE.md §8 и оставить указатель на владельца; (3) сделать проверку дерева, которая отказывает, когда копия возвращается.
