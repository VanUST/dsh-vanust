---
id: TASK-500
kind: task
title: "Разблокировать и закоммитить батч"
status: active
revision: 2
createdAt: 2026-11-28T17:55:16.371Z
updatedAt: 2026-11-28T17:55:16.789Z
boardId: task-mx0pnj94-97e3n0
chore: true
choreReason: "Тест ворот собрался с машинным file:///C:/dsh-kit путём и валит переносимость; исправление внесено, нужен прогон и коммит батча."
nonScope: ["Не менять код и тексты по существу.", "Не трогать посторонние неотслеживаемые файлы."]
owner:
  kind: agent
  label: DEVOPS
  sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
preset: devops
role: DEVOPS
scope: [packages/, plugins/state-feed/package.json, plugins/orchestrator/package.json, plugins/project-state/package.json, plugins/project-state-panel/package.json]
sessions:
  - sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
    label: DEVOPS
    role: DEVOPS
    status: active
---

Разблокируй батч и закоммить его. Блокер: plugins/orchestrator/test/architect-consult-gate.test.mjs импортировал store.mjs по машинному пути file:///C:/dsh-kit/..., из-за чего check-portability падал на no-hand-built-file-url. Я заменил его на pathToFileURL(join(process.cwd(), ...)) — проверь, что тест зелёный и что других машинных путей в новых файлах нет. Затем: прогони make verify, если зелёный — подними версии там, где нужно, пересобери пакеты, удали прежние tgz, закоммить батч (state-feed, orchestrator, project-state, project-state-panel, taskboard если менялся, скрипты, документы, записи), приложи коммит и план kit-update. Если verify снова красный — назови причину и не коммить.
