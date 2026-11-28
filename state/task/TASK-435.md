---
id: TASK-435
kind: task
title: "Поставить 0.1.98 и 0.1.11, перезапустить и проверить снаружи"
status: done
revision: 10
createdAt: 2026-11-28T12:49:06.578Z
updatedAt: 2026-11-28T13:26:01.369Z
acceptance:
  - text: "Коммит содержит только перечисленные пути, state/ и .dsh/ не тронуты; git show --stat называет пакеты, исходники, тесты, документы, кейсы и карту."
    done: false
  - text: "kit-update --check --json до перезапуска называет план, --apply завершается успешно, после перезапуска --check --json даёт drift null и plan []."
    done: false
  - text: "Сервер отвечает на 3080 после перезапуска; загруженная версия таскборда и proof-guard названа из состояния развёртывания, а не из рабочего дерева."
    done: false
  - text: "Проверка снаружи: законное закрытие задачи проходит без дополнительного сохранения; запись проверки с отпечатком файла не блокирует закрытие после возврата файла; сохранившаяся правка продукта по-прежнему отказывает."
    done: false
boardId: task-mx0eptak-vvozv5
chore: true
choreReason: "Доставка принятого изменения на работающее развёртывание: коммит, установка, перезапуск и проверка снаружи. Владелец установку и перезапуск одобрил."
nonScope: ["Не менять код и кейсы; не пересобирать пакеты; не трогать state/ и .dsh/ в коммите."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["Коммит 88e42df, 24 файла; state/ и .dsh/ в коммите нет.", "kit-update --apply exit=0; post-check drift null, plan [], appliedHead 88e42df (.dsh/post-check.json); лог .dsh/deploy.log:81-87.", "Установлено: @cc/dsh-taskboard 0.1.98, @cc/dsh-proof-guard 0.1.11 в profiles/web/node_modules; сервер отвечает на 3080."]
resultSummary: "Taskboard 0.1.98 и proof-guard 0.1.11 установлены на развёртывание: коммит 88e42df, apply без ошибок, drift null, сервер поднят, версии в профиле совпадают с принятыми."
role: DEVOPS
scope: [scripts/kit-update.mjs, .dsh/deploy.log]
---

Доставь принятое изменение на работающее развёртывание и докажи результат снаружи. Сначала коммит: включить только пути из заметки задачи TASK-433 (plugins/taskboard, plugins/proof-guard, пакеты 0.1.98 и 0.1.11, удаления прежних пакетов, test/, документы, docs/analysis/, docs/cases/, designmap/pages/), не включать state/ и .dsh/. Затем установка: остановить сервер, node scripts/kit-update.mjs --apply, поднять через launcher и убедиться, что node scripts/kit-update.mjs --check --json даёт drift null и plan []. Потом проверка снаружи: сервер отвечает на 3080; версия таскборда и proof-guard в развёртывании — 0.1.98 и 0.1.11; закрытие задачи проходит без дополнительного сохранения. Учти: перезапуск убивает субагентов, поэтому запускай перезапуск отдельно от проверки и оставь след в логе, чтобы следующий заход прочитал его, а не угадывал.
