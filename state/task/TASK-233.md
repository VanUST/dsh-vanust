---
id: TASK-233
kind: task
title: "OpenAI Codex: вход по подписке через инструмент харнесса"
status: open
revision: 2
createdAt: 2026-11-18T12:27:33.179Z
updatedAt: 2026-11-18T12:27:33.179Z
acceptance:
  - text: "codex_signin_start возвращает ссылку https://auth.openai.com/codex/device и user code, поток продолжается в фоне"
    done: false
  - text: "codex_signin_status показывает pending → authorized после подтверждения; при отмене — cancelled"
    done: false
  - text: "Запись llm-pi-ai/openai-codex появляется в хранилище харнесса как grant; тест на fake authorization/credentials доказывает start/status/cancel и отсутствие секрета в выводе"
    done: false
  - text: "Повторный start при активном потоке возвращает ALREADY_IN_FLIGHT с текущими url/code"
    done: false
  - text: "Инструменты видны только пресету orchestrator (тест на fake-контексте)"
    done: false
  - text: "Тарбол собран, make verify — exit 0 (17/17 + документация)"
    done: false
boardId: task-mwm3jkus-fbj074
nonScope: ["живой :3080 и установленный профиль — не трогать; вход выполняется отдельным шагом после приёмки", "реальный сетевой вызов OpenAI в тестах — запрещён; только fake-сервисы", "другие плагины и тарболы", "docs/analysis/*.json — правит только оркестратор"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-111, REQ-112, REQ-113, REQ-114]
role: BACKEND
scope: ["plugins/codex-signin/ (index.mjs, package.json, README, test)", plugins/cc-dsh-codex-signin-0.1.0.tgz, "docs/cases/ (кейс на инструменты)", "reports/ (артефакты прогонов)"]
steps: ["Скелет плагина: defineTool, register в agent/created под preset orchestrator, named-отказы при отсутствии сервисов", "start/status/cancel поверх ctx.authorization.begin в фоне; состояние в памяти", "Тест на fake authorization/credentials: start→pending, notify→url/code, authorized, cancel, ALREADY_IN_FLIGHT, секрет не в выводе", "Кейс red→green, тарбол, make verify"]
stepsDone: 0
---

Новый хост-плагин @cc/dsh-codex-signin: три инструмента для пресета orchestrator. codex_signin_start запускает ctx.authorization.begin({key:'llm-pi-ai/openai-codex', method:'oauth', ...}) в фоне, interaction.prompt отвечает на select выбором device_code, notify перехватывает {message,url,code}; вызов возвращает {status:'pending', url, code, expiresAt} не позже 10 с. codex_signin_status отдаёт текущее состояние (idle/pending/authorized/cancelled/failed + url/code/ошибка). codex_signin_cancel вызывает ctx.authorization.cancel(key) и возвращает cancelled. Секреты не печатать. Тесты на fake-сервисах (никакой сети), кейс с красным→зелёным, тарбол, make verify.
