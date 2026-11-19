---
id: TASK-243
kind: task
title: "Остаток окна Codex и цена модели — в сессии"
status: open
revision: 1
createdAt: 2026-11-18T15:41:04.372Z
updatedAt: 2026-11-18T15:41:04.372Z
acceptance:
  - text: "команда/панель показывает used_percent и reset"
    done: false
  - text: "цена astra названа относительно gpt-6-luna"
    done: false
  - text: "недоступность сети не ломает сессию"
    done: false
boardId: task-mwmagg1t-ldkxtf
nonScope: ["правка @deepseek-ai/dsh-llm-pi-ai"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-132, REQ-133]
role: BACKEND
scope: ["plugins/ (новый плагин квоты)", profile/cordis.patch.yml, plugins/inventory.json, docs]
steps: ["доступ к учётным данным", "запрос /wham/usage", "вывод и предупреждение", proof]
stepsDone: 0
---

Плагин читает GET https://chatgpt.com/backend-api/wham/usage с OAuth-учётными данными харнесса и показывает used_percent/reset для 5-часового и недельного окна; при выборе дорогой модели маршрута openai-codex (gpt-6-astra) называет цену относительно самой дешёвой. Сеть недоступна — тихо пропустить.
