---
id: TASK-500
kind: task
title: "Разблокировать и закоммитить батч"
status: done
revision: 5
createdAt: 2026-11-28T17:55:16.371Z
updatedAt: 2026-11-28T18:10:12.840Z
boardId: task-mx0pnj94-97e3n0
chore: true
choreReason: "Тест ворот собрался с машинным file:///C:/dsh-kit путём и валит переносимость; исправление внесено, нужен прогон и коммит батча."
nonScope: ["Не менять код и тексты по существу.", "Не трогать посторонние неотслеживаемые файлы."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["node --test plugins/orchestrator/test/architect-consult-gate.test.mjs → 7 pass, 0 fail, exit 0; скан новых файлов на file:/// и C:/dsh-kit — 0 совпадений.", "check-portability → exit 0, 20/20, [PASS] no-hand-built-file-url и [PASS] tarball:matches-source.", "make verify → exit 0 до и после коммита: 20/20, boundaries ok, documentation ok, 147 строк пресетов 0 отказов, schema-lint и context-budget 0 red.", "Коммит 7b86a55, 67 файлов, +2660/−808."]
resultSummary: "Блокер снят: тест больше не импортирует по машинному пути, переносимость зелёная, make verify зелёный, батч закоммичен (7b86a55)."
role: DEVOPS
scope: [packages/, plugins/state-feed/package.json, plugins/orchestrator/package.json, plugins/project-state/package.json, plugins/project-state-panel/package.json]
---

Разблокируй батч и закоммить его. Блокер: plugins/orchestrator/test/architect-consult-gate.test.mjs импортировал store.mjs по машинному пути file:///C:/dsh-kit/..., из-за чего check-portability падал на no-hand-built-file-url. Я заменил его на pathToFileURL(join(process.cwd(), ...)) — проверь, что тест зелёный и что других машинных путей в новых файлах нет. Затем: прогони make verify, если зелёный — подними версии там, где нужно, пересобери пакеты, удали прежние tgz, закоммить батч (state-feed, orchestrator, project-state, project-state-panel, taskboard если менялся, скрипты, документы, записи), приложи коммит и план kit-update. Если verify снова красный — назови причину и не коммить.
