---
id: TASK-233
kind: task
title: "OpenAI Codex: вход по подписке через инструмент харнесса"
status: open
revision: 1
createdAt: 2026-11-18T12:27:33.179Z
updatedAt: 2026-11-18T12:27:33.179Z
boardId: task-mwm3jkus-fbj074
reqIds: [REQ-111, REQ-112, REQ-113, REQ-114]
steps: ["Скелет плагина: defineTool, register в agent/created под preset orchestrator, named-отказы при отсутствии сервисов", "start/status/cancel поверх ctx.authorization.begin в фоне; состояние в памяти", "Тест на fake authorization/credentials: start→pending, notify→url/code, authorized, cancel, ALREADY_IN_FLIGHT, секрет не в выводе", "Кейс red→green, тарбол, make verify"]
stepsDone: 0
---

Новый хост-плагин @cc/dsh-codex-signin: три инструмента для пресета orchestrator. codex_signin_start запускает ctx.authorization.begin({key:'llm-pi-ai/openai-codex', method:'oauth', ...}) в фоне, interaction.prompt отвечает на select выбором device_code, notify перехватывает {message,url,code}; вызов возвращает {status:'pending', url, code, expiresAt} не позже 10 с. codex_signin_status отдаёт текущее состояние (idle/pending/authorized/cancelled/failed + url/code/ошибка). codex_signin_cancel вызывает ctx.authorization.cancel(key) и возвращает cancelled. Секреты не печатать. Тесты на fake-сервисах (никакой сети), кейс с красным→зелёным, тарбол, make verify.
