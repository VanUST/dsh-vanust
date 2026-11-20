# Project state

GENERATED — DO NOT EDIT.

REQ 171 · TASK 256 · TEST 77 · event 1141

## Gaps

- REQ without TASK: 170 (REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, …)
- TASK without reqId: 255
- TEST without reqId: 51

## Open requirements (8)

- REQ-111 proposed: Инструмент начинает вход в OpenAI (ChatGPT Plus/Pro) и отдаёт владельцу ссылку и код подтверждения.
- REQ-112 proposed: После подтверждения запись llm-pi-ai/openai-codex лежит в хранилище харнесса и маршрут openai-codex 
- REQ-113 proposed: Вход можно отменить и повторить, не оставив зависший поток.
- REQ-114 proposed: Секрет не печатается, а отказы названы.
- REQ-168 proposed: Результаты инструментов обрезаются начиная с самых новых, пока измеренный контекст не опустится под 
- REQ-169 proposed: Свежие результаты не обрезаются: последние protectResults результатов инструментов остаются целыми.
- REQ-170 proposed: Прежний обрезчик остаётся страховкой, а бюджет по умолчанию ниже порога компакции.
- REQ-171 proposed: Гейты кита и упаковка остаются зелёными.

## Open work (7)

- TASK-233 open: OpenAI Codex: вход по подписке через инструмент харнесса
- TASK-237 open: Stop the state feed from writing unidentified messages, and repair the sessions it corrupted
- TASK-243 open: Остаток окна Codex и цена модели — в сессии
- TASK-256 open: Обрезка результатов инструментов от хвоста: плагин tail-pruner
- TASK-240 review: Ограничить контекст на входе: проекция выдачи и task_list
- TASK-241 review: Абсолютный бюджет контекста ~500K вместо доли окна
- TASK-242 review: Allow-список ролей не действует на инструменты кита

