---
id: TASK-488
kind: task
title: "Собрать батч: правила документации и панель"
status: done
revision: 5
createdAt: 2026-11-28T17:19:28.088Z
updatedAt: 2026-11-28T17:53:21.546Z
boardId: task-mx0odhmq-4w6szr
chore: true
choreReason: "Накопился батч: три правки политики оркестратора (документация проекта, пустой проект, отсутствующие файлы) и правки клиента панели — нужны пересборка и один перезапуск."
nonScope: ["Не перезапускать сервер и не запускать apply — шаг владельца.", "Не менять тексты политики по существу: только сборка и коммит."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["Коммит aa7d65f: 54 файла, +1500/−96 — правило документации, правки клиента панели и README, кейсы, запись анализа, состояние.", "pack-plugin: orchestrator 0.1.84 → 0.1.85 (sha256 33bf3896…), project-state-panel 0.1.51 → 0.1.52 (9789b88c…), taskboard 0.1.98 → 0.1.99 (4bfa4821…); прежние tgz удалены.", "make verify после коммита: exit 0 — 20/20 portability, boundaries gate ok, documentation ok, 147 строк пресетов 0 отказов, identity-guard patched.", "kit-update --check: plan = install-plugins orchestrator 0.1.85, panel 0.1.52, taskboard 0.1.99; записи профиля нет — профиль не менялся."]
resultSummary: "Батч собран и закоммичен (aa7d65f): правило документации проекта, правки клиента панели и её README; пакеты orchestrator 0.1.85, panel 0.1.52 и taskboard 0.1.99 пересобраны, make verify зелёный, план обновления содержит только три пакета."
role: DEVOPS
scope: [packages/, plugins/orchestrator/package.json, plugins/project-state-panel/package.json]
---

Собери и закоммить батч так, чтобы один перезапуск владельца применил всё. Состав: (1) plugins/orchestrator/orchestrator.mjs — правило документации проекта (docs/GUIDE.md — навигация, docs/ARCHITECTURE.md — границы и владельцы, docs/TERMINOLOGY.md — слова, и эти три заводятся в проекте без документов до первой содержательной работы), правило для пустого проекта и правило про отсутствующие документы; (2) plugins/project-state-panel — правки клиента (одно чтение вместо двух, живой регион объявлений, axe 0 нарушений, контраст) и README; (3) кейсы и состояние. Сделай: подними версии orchestrator и project-state-panel, пересобери пакеты и удали прежние, закоммить, прогони make verify и приложи код, приложи план kit-update (только профиль и пакеты). Сервер не перезапускай.
