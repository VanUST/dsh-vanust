---
id: TASK-499
kind: task
title: "Батч: архитектура в контексте, панель, расхождение"
status: done
revision: 5
createdAt: 2026-11-28T17:53:20.781Z
updatedAt: 2026-11-28T17:56:54.614Z
boardId: task-mx0pl22f-x5x411
chore: true
choreReason: "Накопился большой батч: архитектура в контексте, правила политики, вкладка плана, счётчики плана, сигнал расхождения, предел раздела и комментарий проверки — нужны пересборка и один перезапуск."
nonScope: ["Не менять тексты политики и код по существу: только сборка, коммит, прогон.", "Не трогать неотслеживаемые посторонние файлы."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["Коммит 7b86a55: 67 файлов, +2660/−808 — доставка архитектуры, правило документации, ворота консультации, вкладка плана, счётчики, сигнал расхождения.", "Пакеты: state-feed 0.1.10 → 0.1.11 (6f2f1dcd…), orchestrator 0.1.85 → 0.1.86 (5e1022e4…), project-state 0.1.24 → 0.1.25 (86340ac8…), project-state-panel 0.1.52 → 0.1.53 (5c989d63…); прежние tgz удалены.", "make verify → exit 0; kit-update --check: план install-plugins пяти пакетов, записи профиля нет."]
resultSummary: "Батч собран и закоммичен после разблокировки: четыре пакета пересобраны, план обновления содержит пять установок, включая недоставленный taskboard 0.1.99."
role: DEVOPS
scope: [packages/, plugins/state-feed/package.json, plugins/orchestrator/package.json, plugins/project-state/package.json, plugins/project-state-panel/package.json]
---

Собери и закоммить батч так, чтобы один перезапуск владельца применил всё. Состав: (1) plugins/state-feed — раздел архитектуры в первом сообщении, предел 12 288 (0.1.11+); (2) plugins/orchestrator — правила документации проекта, пустой проект, отсутствующие документы, владение архитектурным файлом, ворота архитектурной консультации (0.1.86+); (3) plugins/project-state — счётчики плана в renderPlan/renderPlanYaml (0.1.25+); (4) plugins/project-state-panel — вкладка плана (0.1.53+); (5) scripts/check-boundaries.mjs — сигнал расхождения архитектуры и сжатый вывод, плюс комментарий §3; (6) docs/ARCHITECTURE.md, docs/GUIDE.md и записи анализа. Подними версии, пересобери, удали прежние пакеты, закоммить, прогони make verify и приложи код и план kit-update. Верни: коммит, версии, sha256, вывод verify, план.
