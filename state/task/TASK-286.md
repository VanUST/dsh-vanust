---
id: TASK-286
kind: task
title: "P1: атака на запись TESTER и wrong-product red"
status: done
revision: 5
createdAt: 2026-11-22T11:49:41.100Z
updatedAt: 2026-11-22T11:58:41.264Z
acceptance:
  - text: "Найден воспроизводимый обход или каждый проверенный путь отказан"
    done: false
  - text: "Для обхода: точная команда/фикстура, вывод, exit code и минимальный вход"
    done: false
  - text: "Проверено, что P0-поведение и независимый контроль не сломаны"
    done: false
  - text: "Отчёт называет, что осталось границей (shell, B1/B1'), и не выдаёт известное за новый дефект"
    done: false
boardId: task-mwrry83d-ic6mvm
nonScope: ["не править общий C:/dsh-kit", "не трогать живой профиль ~/.npm/dsh/profiles/web, :3080 и production data", "не исправлять найденное", "не менять существующие docs/cases/*.json"]
owner:
  kind: agent
  label: CRITIC
preset: critic
reqIds: [REQ-189, REQ-190, REQ-191, REQ-194]
resultEvidence: ["B1: docs/cases/../../src/app.mjs ALLOW, product value changed 1 -> 42; fs.resolve + writeText -> 424242; test/../src, mixed separators, ../../../outside also ALLOW", "W1: empty cwd, command not found exit 1 -> redFirst.source wrong-product, green verified, gate ok, task CLOSED", "W3: negative-control only -> NOT_WRONG_PRODUCT_RED refused; W4: test edit -> stale, redFirst null", "P0 proof 27/27, targeted 34/34; shared tree/docs/cases untouched", "B2 hard link, B3 product named *.test.*, shell, B1/B1' named boundaries"]
resultSummary: "Атака P1 нашла два блокера: B1 — обход области записи TESTER через относительный `..` (`docs/cases/../../src/app.mjs`), подтверждён и через LocalFileSystem; W1 — wrong-product red принимает пустой каталог с «командой не найдена» и условие приёмки зелёное. B2 hard link и B3 продукт с именем *.test.* — названные границы. B1/W1 отправлены в P1-фикс; H1 README исправлен; H2 root spec остаётся. P0 не сломан."
role: CRITIC
scope: ["одноразовая копия /tmp или scratch checkout", "profile/cordis.patch.yml, plugins/proof-guard/**, plugins/test-cases/**, plugins/orchestrator/** (только чтение/копия)", "запуск proof-guard тестов, case_record/case_run, CLI"]
---

Атаковать P1: найти способ, которым пресет TESTER пишет продуктовый файл в обход proof-guard, или кейс приёмки получает wrong-product red/realism без реальной проверки. Проверь path traversal, абсолютные пути, symlink, регистр, продукт с именем *.test.*, shell-обход (известная граница), подмену пресета/сессии, docs/cases/drivers, фиктивную копию «прошлой версии» и синтетические trigger/oracle/realism. Работай на одноразовой копии; не правь общий каталог, продукт, тесты и данные. Нужен smallest reproducible bypass или список проверенных атак и границ; не чинить.
