# План: инициативы журнала

Сгенерированный вид из docs/analysis/*.json и журнала проекта (regenerateViews). Руками не правится; тексты требований остаются в записях анализа.

Инициатив: 54; с открытыми задачами: 0; с несделанными требованиями: 28.

| Инициатива | Этап | Подтверждено | Осталось | Открытые задачи |
|---|---|---|---|---|
| agent-surface-and-shell — Открытая поверхность: модель Codex в харнессе, вход внешнего агента, State наверху и адап… | ready | 7 из 8 | BR1 | — |
| architect-role-and-context-economy — Роль ARCHITECT: минималистичный пресет системного дизайнера и границы контекста у всех ро… | ready | 0 из 7 | FR-1, FR-2, FR-3, FR-4 +3 | — |
| batch-execution — Пакетная работа: две seats на спайк вместо ребёнка на строку | ready | 0 из 2 | FR1, NFR1 | — |
| batch-review — Пакетное ревью: один REVIEWER на несколько задач | ready | 0 из 1 | FR1 | — |
| behaviour-only-cases — Кейсы приёмки проверяют поведение через публичную поверхность | ready | 0 из 12 | BR1, FR1, FR2, FR3 +8 | — |
| client-load-performance — Клиент быстрее: измеренное открытие, интерактивность и бюджеты | ready | 0 из 6 | FR1, FR2, FR3, FR4 +2 | — |
| codex-context-bounds — Границы контекста и видимость квоты на маршруте Codex | ready | 5 из 8 | FR-5, FR-6, NFR-2 | — |
| designmap-instruments — Design map: the whole panel as canvas, always-on editing, instruments for readable drawin… | ready | 5 из 5 | — | — |
| designmap-pages — Карта дизайна v2: страницы-рисунки вместо модели проекта | ready | 0 из 9 | FR1, FR2, FR3, FR4 +5 | — |
| impeccable-design-quality — Дизайн-контур: impeccable (slop-детектор) и визуальный выбор вариантов | ready | 9 из 9 | — | — |
| independent-verification — Независимая проверка: происхождение доказательства, роль TESTER и условие приёмки без сам… | ready | 0 из 11 | BR1, FR1, FR2, FR3 +7 | — |
| kit-boot-convergence — Одна команда `dsh web`: сведение кита, отказ вместо тихого устаревшего запуска и явный пе… | ready | 0 из 2 | FR1, FR2 | — |
| openai-codex-signin — Вход в OpenAI Codex по подписке ChatGPT Plus/Pro без кнопки в GUI | ready | 0 из 4 | FR1, FR2, FR3, NFR1 | — |
| preset-playbooks — Плейбуки пресетов: правильный ход работы и два типа ложного завершения | ready | 0 из 3 | FR1, FR2, NFR1 | — |
| project-hygiene-guide-and-docs — Project hygiene: one working guide, durable docs only, a legacy audit, and the orchestrat… | ready | 0 из 6 | FR1, FR2, FR3, FR4 +2 | — |
| proof-guard-resolution — Запись проверки оболочки: разрешение и авторство | ready | 1 из 1 | — | — |
| risk-closure — Закрытие остаточных рисков независимой проверки | ready | 0 из 1 | FR1 | — |
| state-link-correction — Исправление связи в журнале: снятие связи | ready | 0 из 1 | R1 | — |
| state-panel-hide-chores — Скрыть chore-задачи из вида доски задач | ready | 1 из 1 | — | — |
| task-order-and-dependencies — Порядок шагов как контракт: правило в политике и отказ доски `dependency_open` | ready | 0 из 2 | FR1, FR2 | — |
| task-state-owner-control — Владелец меняет состояние задачи сам: ручной статус в панели Project state и доска без пр… | ready | 4 из 4 | — | — |
| analysis-record-schema-integrity — Analysis Record schema integrity | completed | 6 из 6 | — | — |
| architecture-boundaries — Границы архитектуры: опись и проверка | completed | 1 из 2 | R2 | — |
| cache-aware-tool-result-pruning — Точка обрыва кэша при обрезке результатов инструментов | completed | 0 из 4 | FR1, FR2, FR3, NFR1 | — |
| case-library-evidence-honesty — Библиотека кейсов: выдача case_update/case_verify, каталог в записи прогона, запрет приби… | completed | 3 из 5 | FR4, NFR1 | — |
| code-outline-tool — Оглавление кода для всех агентов: инструмент outline в каждом пресете | completed | 5 из 5 | — | — |
| context-output-economy — Экономия контекста на входе: убрать Headroom, сузить раздел RTK, читать файлы инструмента… | completed | 5 из 5 | — | — |
| delegation-basis-and-install-steps — Основание задачи при делегировании и остановка установщика Windows на сбойном шаге | completed | 0 из 3 | FR1, FR2, NFR1 | — |
| designmap-edit-loop — Карта дизайна: один пересчёт геометрии для человека и агента | completed | 13 из 13 | — | — |
| designmap-human-edits — Human visual edits: native Excalidraw tools plus an annotation layer beside the model | completed | 5 из 5 | — | — |
| designmap-readability — Design map readability: one owner for label geometry, validated scene, themed canvas | completed | 11 из 11 | — | — |
| designmap-redesign — Design map v1: semantic model, ELK layout, custom renderer, living doc | completed | 17 из 17 | — | — |
| devops-role-and-runtime-lane — DEVOPS role and the runtime lane: one agent on the running deployment | completed | 9 из 9 | — | — |
| documentation-owners — Документация: три владельца вместо расползания | completed | 1 из 1 | — | — |
| harness-hardening-non-ui — Устойчивость харнесса без изменения интерфейса: проекция, жизненный цикл задачи, доска, п… | completed | 3 из 7 | FR4, FR5, FR6, NFR1 | — |
| harness-seam — Шов харнесса: запуск субагента в одном месте | completed | 1 из 1 | — | — |
| harness-upgrade-rehearsal — Репетиция обновления харнесса | completed | 0 из 1 | R1 | — |
| kit-integrity-p0 — Целостность кита перед экосистемой состояния (P0) | completed | 8 из 8 | — | — |
| kit-tool-surface — Поверхность инструментов: удалить мёртвое, вернуть нужное, добиться outline | completed | 7 из 7 | — | — |
| presenter-role — Роль presentation maker: пресет и инструменты визуализации | completed | 9 из 9 | — | — |
| program-decisions — Стратегия в журнале: решения и порядок в плане | completed | 1 из 1 | — | — |
| project-state-ecosystem — Экосистема состояния проекта и экономика контекста — v1 | completed | 20 из 21 | FR16 | — |
| project-state-merge — Проектный журнал state/ и слияние после пула | completed | 4 из 4 | — | — |
| ptc-preset-migration — PTC для пресетов kit: волна 1 — gatherer и reviewer | completed | 5 из 5 | — | — |
| ptc-wave2-tool-families — PTC волна 2, безопасный рестарт и исправление tool-families | completed | 4 из 4 | — | — |
| ptc-wave3-audit-close — PTC волна 3, удаление babysitter и закрытие аудита | completed | 4 из 4 | — | — |
| request-cache — Замер повторного использования префикса | completed | 1 из 2 | R2 | — |
| shell-panel-navigation — Навигация панелей: выход в чат, скрытие окон, без дубля Tasks | completed | 6 из 7 | FR1 | — |
| speed-over-bureaucracy — Скорость и группировка: противовес бюрократии для всех корневых агентов | completed | 4 из 5 | NFR1 | — |
| state-counts-and-task-list — Счётчики у State и режим списка задач с сортировкой | completed | 3 из 3 | — | — |
| state-entities-manual-editing — Ручное редактирование требований, задач и тест-кейсов из панели состояния | completed | 0 из 4 | FR1, FR2, FR3, NFR1 | — |
| state-panel-status-and-tests-fixes — Дефекты панели состояния: нечитаемый список статусов, лишняя колонка Evidence, потерянная… | completed | 0 из 4 | FR1, FR2, FR3, NFR1 | — |
| state-task-specifics — Карточка задачи в реестре состояния: конкретика и переход к сессии субагента | completed | 4 из 4 | — | — |
| taskboard-write-integrity — Доска задач: запись строки и её проверка при закрытии | completed | 2 из 2 | — | — |

## Открытые задачи журнала (6)
- TASK-273 (open): Codex sign-in tool: codex_signin_start/status/cancel
- TASK-337 (review): Independent acceptance case: devops role and the one-live-deployment lane
- TASK-372 (blocked): Задержка отправки и размер контекста: есть ли связь
- TASK-383 (active): Отказ board_limit: назвать причину — долг проверки и minimal viable change
- TASK-438 (review): Приёмка шва харнесса: обе формы и отсутствие формы в оркестраторе
- TASK-470 (active): Объявить снятие связи потребителям и закоммитить батч

Записи анализа: docs/analysis/<initiative>.json.
