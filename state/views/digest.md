# Project state

GENERATED — DO NOT EDIT.

REQ 178 · TASK 270 · TEST 83 · event 1267

## Gaps

- REQ without TASK: 177 (REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, …)
- TASK without reqId: 269
- TEST without reqId: 51

## Open requirements (4)

- REQ-111 proposed: Инструмент начинает вход в OpenAI (ChatGPT Plus/Pro) и отдаёт владельцу ссылку и код подтверждения.
- REQ-112 proposed: После подтверждения запись llm-pi-ai/openai-codex лежит в хранилище харнесса и маршрут openai-codex 
- REQ-113 proposed: Вход можно отменить и повторить, не оставив зависший поток.
- REQ-114 proposed: Секрет не печатается, а отказы названы.

## Open work (13)

- TASK-233 open: OpenAI Codex: вход по подписке через инструмент харнесса
- TASK-237 open: Stop the state feed from writing unidentified messages, and repair the sessions it corrupted
- TASK-243 open: Остаток окна Codex и цена модели — в сессии
- TASK-270 active: Догоняющий коммит и push после 9f11674
- TASK-240 review: Ограничить контекст на входе: проекция выдачи и task_list
- TASK-241 review: Абсолютный бюджет контекста ~500K вместо доли окна
- TASK-242 review: Allow-список ролей не действует на инструменты кита
- TASK-261 review: Проекция: полный текст снова читается агентом
- TASK-263 review: Проверки: отказ на пустом входе, негативный контроль, make test
- TASK-264 review: Установка: Node 24.9, сохранение слоя, сторож сервера, бэкап и откат, обёртка Windows
- TASK-265 review: Сведение: make verify, make test, тарболы, кейс компакции, живой профиль
- TASK-267 review: Кейсы таскборда: негативный контроль через CASE_NEGATIVE_CONTROL
- TASK-269 review: Коммит и push изменений в origin/main

