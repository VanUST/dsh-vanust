---
id: TASK-288
kind: task
title: "P1 fix: повторная атака на область записи и wrong-product red"
status: review
revision: 4
createdAt: 2026-11-22T11:58:38.762Z
updatedAt: 2026-11-22T12:06:36.574Z
acceptance:
  - text: "Найден воспроизводимый обход или каждый проверенный путь отказан"
    done: false
  - text: "Для обхода: точная команда/фикстура, вывод, exit code и минимальный вход"
    done: false
  - text: "P0/независимый контроль не сломаны"
    done: false
  - text: "Отчёт называет, что осталось границей, и не выдаёт известное за новое"
    done: false
boardId: task-mwrs9q2f-eplgve
nonScope: ["не править общий C:/dsh-kit", "не трогать живой профиль/:3080", "не исправлять найденное", "не менять docs/cases"]
owner:
  kind: agent
  label: CRITIC
preset: critic
reqIds: [REQ-189, REQ-190, REQ-191, REQ-194]
role: CRITIC
scope: ["одноразовая копия /tmp или scratch checkout", "plugins/proof-guard/**, plugins/test-cases/**, scripts/independent-verification-proof.mjs (чтение/копия)", "запуск proof-guard тестов, case_run red, CLI"]
---

Повторно атаковать B1/W1 после фикса. Найди способ записать продукт через TESTER write/edit в обход нормализации области или получить wrong-product red без реального неверного продукта. Проверь Windows-пути, `..` после разрешения, mixed separators, symlink/junction, hard link (B2 известна), продукт с именем *.test.* (B3 известна), fake git дерево без продукта, head null, negative-control. Работай на одноразовой копии; не чини.
