# Архитектура DSH kit

**Статус.** Единственный владелец границ подсистем, контрактов и инвариантов. Здесь же решения, которые ограничивают будущую работу: карта дизайна как рисунок, средства презентации, плейбуки пресетов, контракт шва с харнессом, устройство библиотеки кейсов и доска как журнал со снимком.

Дата проверки: 2026-11-28

Карта каталога и команды — [GUIDE.md](GUIDE.md); слова — [TERMINOLOGY.md](TERMINOLOGY.md); процедуры развёртывания и проверки кандидата харнесса — [rules/DEPLOYMENT.md](../rules/DEPLOYMENT.md); состояние плана — сгенерированный вид `state/views/plan.md`.

## Содержание

- [1. Границы подсистем](#1-границы-подсистем)
- [2. Запрос к модели и кэш](#2-запрос-к-модели-и-кэш)
- [3. План, архитектура и приёмка](#3-план-архитектура-и-приёмка)
- [4. Порядок результатов](#4-порядок-результатов)
- [5. Карта дизайна: рисунок, а не состояние](#5-карта-дизайна-рисунок-а-не-состояние)
- [6. Средства презентации](#6-средства-презентации)
- [7. Плейбуки пресетов](#7-плейбуки-пресетов)
- [8. Контракт шва с харнессом](#8-контракт-шва-с-харнессом)
- [9. Устройство библиотеки кейсов](#9-устройство-библиотеки-кейсов)
- [10. Доска задач: журнал и снимок](#10-доска-задач-журнал-и-снимок)

## 1. Границы подсистем

| Подсистема | Владеет | Не владеет |
|---|---|---|
| Харнесс | Сессиями, шагом модели, набором инструментов на шаге, сборкой и отправкой запроса, запуском субагентов и Web GUI | Требованиями, критериями приёмки и статусом задач кита |
| Профиль Cordis, пресеты и установщик кита | Составом ролей и подключением плагинов; закреплённой версией харнесса и переходом на следующую | Правилами выполнения задач и собственной реализацией шага модели |
| Плагины кита | Записью анализа, таскбордом, библиотекой кейсов, журналом проекта; каждый плагин меняет только своё состояние | Форматом запроса провайдера; панель не определяет условия приёмки |
| Оркестратор | Приоритетом, выбором объёма, порядком задач, вызовом ролей и приёмкой | Записью результата вместо исполнителя, проверкой вместо тестировщика, повторной реализацией правил журнала проекта |
| Провайдер модели | Сериализацией на своей стороне, совпадением префикса, счётчиками употребления токенов | Правилами кита, по которым инструмент попал в запрос |

**Направление зависимости.** Правила переходов и проверки плагинов принимают обычные данные кита и не импортируют модули харнесса. Подключение через Cordis, `ctx`, события и вызовы сессий остаются на входе конкретного плагина. Обёртка существует только для наблюдаемой границы; универсального API поверх харнесса нет. Сравнения схем и команды тестов с подменой среды — быстрые проверки, а не замена реальному запуску.

**Условие приёмки границы.** Изменение формы запуска на следующей совместимой версии не требует менять критерии задач и библиотеку кейсов: один и тот же сценарий проверяет старую и новую установки, а результат различает версию исходников, файлы в установке и состав плагинов, который реально загрузил процесс.

**Правки установленного харнесса.** У каждой правки есть причина, владелец, проверка поведения и условие удаления. Сначала на одноразовой установке прогоняется неизменённый харнесс; если проверка проходит без правки, правка снимается. При незнакомой форме файла правка не применяется. Порядок — [проверка кандидата](../rules/DEPLOYMENT.md#9-checking-a-candidate-harness-version-isolated), второй инструкции нет.

## 2. Запрос к модели и кэш

Порядок на закреплённой версии: входящие сообщения → выбор инструментов → сборка разделов системного промпта → `agent/pre-step` → обновление маршрута и контекста выполнения → выбор видимых разделов → добавление сообщений → сборка запроса адаптером. Обработчик `pre-step` не меняет задним числом выбранные инструменты или уже собранный раздел.

Инварианты, которые нельзя нарушать ради попадания в кэш:

- **Точка измерения — после сериализации в адаптере**, а не в плагине, который готовит свой текст. Тестовый транспорт проверяет сборку; счётчики проверяет только запрос к реальному провайдеру на этом маршруте.
- **Один изменённый фактор за сравнение.** Сначала разброс на базовой линии, затем допустимое ухудшение; без прогрева и одного фактора сравнение ничего не доказывает.
- **Неизменная конфигурация — неизменные имена, порядок и байты описаний инструментов.** В описание не попадают номера задач, текущее время и данные проекта.
- **Смена роли, разрешений или набора инструментов — законная причина изменить запрос.** Недоступный инструмент не удерживается ради кэша; в PTC неизменное имя `run_code` не доказывает неизменность сгенерированного SDK.
- **Переоткрытие и смена состава меряются отдельно**, новый префикс — отдельной серией.
- **Неизвестный счётчик не подменяется нулём.** Тела запросов, ключи и заголовки в журнал не пишутся; постоянный сбор в пользовательских сессиях не нужен.
- **Три разные операции не смешиваются:** сокращение результата до попадания в историю, обрезка старых результатов в видимой истории и компакция, заменяющая начало пересказом. Каждая мерится на одинаковом продолжении от одного состояния, с операцией и без неё.
- **После компакции или пропуска событий состояние восстанавливается по записи анализа и таскборду**, а не по устаревшему пересказу. В стабильном разделе промпта остаются правила чтения состояния; изменение выдаёт [плагин выдачи состояния](../plugins/state-feed/index.mjs).
- **Маршруты различаются.** На Flash режимы `in-history` и `addition-only` проверяются раздельно; на Pro они не считаются доступными без проверки; Codex меряется отдельно.

Протокол замера, числа и ограничения — в [записи анализа об измерении кэша](analysis/request-cache.json): она владеет замерами, эта страница — правилами.

## 3. План, архитектура и приёмка

- **План** — порядок результатов с зависимостями и условием завершения каждого (§4). Владелец определяет приоритет и принимает существенный компромисс; оркестратор обновляет порядок при изменении требований, завершении этапа или обнаружении препятствия. Статусы задач в план не копируются. Текущее состояние плана — сгенерированный вид `state/views/plan.md`, собранный из записей анализа и журнала: руками он не правится.
- **Принятая архитектура** — этот файл, общий для инициатив. Один контракт или инвариант описан в одном месте; запись анализа ссылается на его идентификатор либо предлагает изменение. Изменение принятой архитектуры — решение оркестратора по основанию архитектора, а не побочный эффект закрытия задачи.
- **Запись анализа** связывает результат для пользователя, требования, затронутые компоненты, изменения контрактов, критерии и доказательства; там видна разница между тем, что есть, и тем, что предлагается.
- **Приёмка читает запись прогона, а не текст описания:** что и где запустили, чей прогон, ожидаемый отказ на неверном продукте и успех на принятой версии там, где нужна независимость. Упоминание номера требования в тексте и наличие строк об исходах критерием не являются. Отказ на неверном продукте и успех относятся к одной версии драйвера и одному критерию; самопроверка драйвера отказа не заменяет. См. [устройство библиотеки кейсов](#9-устройство-библиотеки-кейсов).
- **Владельцы состояния:** таскборд — состояние исполнения, библиотека кейсов — прогон, запись анализа — трассировка инициативы. Панель и текст отчёта не решают отдельно, что работа принята; при недоступности источника новый статус «подтверждено» не ставится автоматически.
- **Пропорциональность.** Мелкая правка не запускает архитектурное ревью; изменение, нарушающее принятую границу, не доходит до приёмки.

## 4. Порядок результатов

Результаты идут по порядку: следующий опирается на предыдущий. Порядок меняется по доказательствам, а не по числу закрытых задач.

| № | Результат | Зависит от | Считается достигнутым, когда |
|---|---|---|---|
| 1 | **Запись доски не теряет подтверждённое и не пропускает подделку** | — | Кейсы приёмки зелёные на принятых байтах и красные на прежней версии; версия стоит на развёртывании |
| 2 | **Запись проверки оболочки разрешима и честна по авторству** | 1 | Ложная запись снимается владельцем области с причиной; сохранившаяся правка по-прежнему отказывает |
| 3 | **Запуск субагента знает две формы активации и живёт в одном месте** | 2 | Оркестратор не содержит полей формы; обе формы проверены; контракт шва (§8) перечислен документом |
| 4 | **Запрос измеряется через сессию харнесса, а не по догадкам** | 3 | По одному шагу видно, какой раздел изменился и где впервые разошлись отправленные байты; сравнение меняет один фактор |
| 5 | **Правила контекста меняются только по замерам** | 4 | У каждого изменения есть замер до/после, и поведение не ухудшилось |
| 6 | **Проверка соответствия архитектуре работает на одном пилоте** | 3 | Изменение, нарушающее принятую границу, не доходит до приёмки; перенос блока на карте не останавливает работу |

**Что решает владелец:** приоритет между результатами 4–6, если придётся выбирать; каждое обновление профиля (перезапуск сервера прерывает работающих субагентов); любое изменение внешних обязательств — публичные инструменты доски, формат журнала, маршруты.

**Чего в плане нет:** форка харнесса, переписывания журнала проекта, отдельной базы для плана, смены модели и массовой переработки старых кейсов. Это отдельные решения, а не побочный эффект текущей задачи.

**Почему замер нельзя заменить оценкой.** По [документации DeepSeek о кэше контекста](https://api-docs.deepseek.com/guides/kv_cache/) попадание в кэш требует сохранённого префикса, кэш строится секундами, живёт часами-днями и работает best-effort. Поэтому правило контекста принимается по замеру сессии харнесса, а не по ожиданию, что похожий запрос попадёт в кэш.

## 5. Карта дизайна: рисунок, а не состояние

Решение владельца: **рисунок не является состоянием проекта**. Карта показывает границы и решения; координаты, подписи и правки схемы контрактом не являются, расхождение с кодом не делает код неверным.

- **Страница — один файл сцены** `designmap/pages/<slug>.excalidraw`; он и есть истина. Нет модели, вида, наложений и манифеста, которые надо держать согласованными.
- **Два редактора — один документ:** агент правит страницу инструментом, человек — на полотне, оба пишут один файл.
- **Список страниц — это каталог:** одна страница — один файл, имя файла и есть заголовок. Пустая страница допустима, панель рисует пустое полотно.
- **Узел — фигура с привязанным текстом, связь — стрелка с привязками;** заметка и пометка человека — обычные элементы того же файла, а не отдельный слой.
- **Обратной совместимости нет:** старые карты могут исчезнуть, переносится только собственный рисунок.

Страницы карты: [текущая система](../designmap/pages/system.excalidraw) и [целевой процесс работы](../designmap/pages/target-workflow.excalidraw).

## 6. Средства презентации

Вопрос один: чем роль presentation maker делает презентации, дашборды и схемы, если документ открывается в песочнице превью — `iframe sandbox="allow-scripts"`, без сети и без соседних файлов. Ответ: **одна автономная страница** — она же превью, она же файл для владельца, она же печать.

| Слой | Чем закрыт | Где |
|---|---|---|
| Стили (темы, токены, кегли, сетка) | свой `theme.css` | `plugins/presentation/theme.css` |
| Движение (вход, фрагменты, счёт чисел, поток) | CSS-анимации, `prefers-reduced-motion`, `requestAnimationFrame` | `plugins/presentation/theme.css`, `player.mjs` |
| Движение по часам (сцена, таймлайн, пауза, подписи) | собственный рантайм на `Element.animate()` | `plugins/presentation/player.mjs`, `render-deck.mjs` |
| Графики (bar, line, donut, sparkline) | свой `charts.mjs`: координаты считаются в SVG | `plugins/presentation/charts.mjs` |
| Схемы (flow, state, arch, sequence) | инструмент `diagram`, готовый SVG вставляется в слайд | `plugins/diagrams/` |
| Проверка результата | Chromium через `playwright-core`, снимок каждого слайда | `scripts/presentation-proof.mjs` |

Внешняя библиотека анимации не подключена осознанно: страница не тянет ни сети, ни сборщика. Замер кандидатов и причины отказа от них — в истории репозитория и в комментарии [профиля](../profile/cordis.patch.yml); живые контракты — в коде плагина и в его README.

## 7. Плейбуки пресетов

Задача завершена, когда её утверждение верно **и** доска это говорит. Обе половины ломаются, и ломаются противоположно:

- **Ложное «верно»** — работа отчитана или закрыта, а утверждение неверно: не сделано, сделано в другом месте, не измерено. Журнал хранит факт, которого нет, и следующий агент на него опирается; поздно обнаруживается дорого, потому что доказательства выглядят полными.
- **Ложное «неверно»** — работа верна, а процесс её не принимает: проверка красная не по той причине, доказательство не того вида, задача ждёт стенда, роль отказывается выйти за узкое чтение брифа. Человек платит дважды, и обычный ремонт — ослабить проверку.

Лекарство одно: **условие приёмки названо до работы и говорит о поведении, а не об отчёте.** Пресет, который знает, что будут проверять, не подыгрывает и не перепроверяет сверх меры.

Что пресет встречает на пути: оркестрация (строка задачи и бриф — контракт: цель, объём, вне объёма, критерии, ограничения, требуемое доказательство; принимает оркестратор, специалист отчитывается); реестр состояния (требования, запись анализа, покрытие критериев, карта дизайна); библиотека кейсов (§9); проверки дерева (`make verify`, `make test`, `make cases`).

**Где живёт текст.** Общее правило читается один раз из `CHILD_POLICY` и остаётся независимым от инструментов; блок для конкретной роли — в её персоне, потому что анти-пример ролевой. Расхождение — дефект документации: блок правится в той же задаче, которая меняет механизм, а не в поздней уборке.

## 8. Контракт шва с харнессом

Здесь перечислены вызовы харнесса, которые делает кит, владелец каждого вызова и способ проверки. Новый вызов харнесса добавляется сюда в том же изменении.

Версию, на которой закреплён харнесс, называют установщики и [процедура развёртывания](../rules/DEPLOYMENT.md), а не этот файл: документ не повторяет состояние. Здесь только то, что реально вызывается, с владельцем и способом проверки.

### Запуск субагента

`ctx.subagents.startActivation(spec)` — единственный вызов, чья форма запроса зависит от версии харнесса.

- **Владелец формы:** `plugins/orchestrator/harness-seam.mjs` (`activationSpec`, `ACTIVATION_FORMS`). Больше нигде поля спеки не перечисляются; в `orchestrator.mjs` их нет.
- **Две формы:** вложенная (`spec.request.parent`, `maxDepth`, `outputSchema` внутри `spec.request`) и плоская (`spec.parent`/`spec.prompt`/`spec.agentPreset`/`spec.cwd`, где `SubagentActivationSpec extends Omit<SubagentStartRequest, 'label' | 'signal'>`). По умолчанию отправляются обе; каждая читает свои поля и игнорирует чужие.
- **Проверка:** `plugins/orchestrator/test/harness-seam.test.mjs` — обе формы на одном входе, по одной форме через `form`, неизвестная форма — явный отказ, оркестратор не собирает спеку; `scripts/dsh-migration-proof.mjs` — оба читателя на готовой спеке.
- **Переход на новую версию:** правится только `harness-seam.mjs`.

### Остальные вызовы харнесса

| Вызов | Владелец | Проверка |
|---|---|---|
| `ctx.subagents.getProvider(name)` | `orchestrator.mjs` (возможности провайдера в `delegate_task`) | `test/delegation-basis.test.mjs`, `test/board-limit.test.mjs` (фейковый runtime) |
| `ctx.subagents.sendMessage(parent, childId, blocks, {signal})` | `orchestrator.mjs` (переиспользование сессии роли) | `test/delegation-basis.test.mjs` |
| `ctx.subagents.interrupt(childId, {kind:'ancestor', agent})` | `orchestrator.mjs` (отказ в регистрации роли после старта) | `scripts/taskboard-close-stop-proof.mjs` (через taskboard) |
| `ctx.on('agent/created')`, `agent.ctx.on('session/event')` | `orchestrator.mjs` (учёт созданных агентов и их сессий) | косвенно, тестами делегирования |
| `ctx.get('taskboard'/'analysis'/'agentPresets'/'subagentModelSelection')` | `orchestrator.mjs` | косвенно, тестами делегирования и taskboard |

---

## 9. Устройство библиотеки кейсов

Раздел перенесён без изменений: это действующий контракт слоя приёмки, и его формулировки сверены с кейсами. Записи, прогоны и их поля описаны в [docs/cases/README.md](cases/README.md).

Status: **the case-library contract** (the runner, typed checks, suite, gate and provenance it
describes are shipped). This page owns what a case is, how it is recorded and run, and when it can
close a task; the deployment procedure and the working guide point here instead of restating it.

Subject: the acceptance layer — `@cc/dsh-test-cases`, the library in `docs/cases/`, the tester
preset, and the three Makefile gates (`verify`, `test`, `cases`). Trigger: the owner's four rules
for what a case is.

### 1. The four rules, as invariants

The four statements are one requirement seen from four sides: **evidence is a measured interaction
with a public surface, replayed by the workspace, judged against an oracle that did not come from
the code.**

| owner's rule | forbids | requires | becomes checkable as |
|---|---|---|---|
| **R1** a case verifies behaviour | a case that can only be red when a symbol, file, table or paragraph disappears | the product produces a *wrong result* for a real input, and the case notices | a declared failure kind; an interaction with the product (M2, M3) |
| **R2** a case runs automatically; otherwise a step-by-step procedure agents can execute | prose steps nobody ever executed; a driver nobody can compare with what the tester actually did | the script *is* the execution, recorded before the case exists | a probe bound to the driver's bytes (M4) |
| **R3** a case is any ordered set of executable operations and checks | the assumption that a case is a unit-test function | steps, per-step checks, artifacts, numbers read from logs or a benchmark | per-step results in the run record (M5) |
| **R4** a case never checks code, only behaviour | reading source, asserting on internals, grading a document | every judgement arrives through the interface | interactions + a declared surface, plus a lint for the residue (M2) |

Two things must be said about the rules themselves, or they will be applied where they do not
belong:

- **R1 and R4 are the same prohibition**, from the side of the *oracle* (what makes it red) and
  from the side of the *probe* (what it is allowed to touch). They are enforced together or not at
  all.
- **The rules govern the acceptance layer.** The implementer's own tests are white-box on purpose —
  they import modules, they are fast, they are not evidence, and they never close a task. The
  library already has that distinction (`purpose: acceptance | implementation`,
  `plugins/test-cases/README.md:75-82`); R4 must not be read as banning `make test`'s plugin tests,
  or the kit loses the cheap layer and keeps only the expensive one.

### 2. What the harness already enforces

Measured against the four rules, the surprise is that **R3 is largely shipped**, R2's middle step
does not exist at all, and R1/R4 are declarative.

| layer | shipped behaviour | anchor |
|---|---|---|
| execution | `case_run` runs the case's stored command through `ctx.shell` in a host (sandbox, caps, timeout) or `spawnExec` in the CLI; per-run timeout 1–600 s; 1–5 repeats; `head`/`dirty` recorded | `plugins/test-cases/lib/runner.mjs:69`, `:133`, `:203`, `:266` |
| measurement | the driver writes `CASE_SUMMARY` (`metrics`, `hashes`, `artifacts`); the plugin evaluates the comparator, so a claim in the driver's text cannot override the number; a declared metric the summary lacks fails (`metric_missing`) | `plugins/test-cases/lib/checks.mjs:135`; `README.md:184-215` |
| metrics that fit R3 | median/p95 over a series, baseline + `band` ratchet, `flaky` on a mixed series, hashed artifacts | `plugins/test-cases/lib/checks.mjs:184-210` |
| red | `case_run { mode:"red" }` runs the negative control and must fail; a wrong-product red runs in a real git tree (`WRONG_PRODUCT_TREE_INVALID`); `verified` needs a measured red | `README.md:143-146`, `:217-221` |
| provenance | author preset/session from the invocation (`AUTHOR_IMMUTABLE`), `runBy`, `testHash` pinning the test bytes, `realismReviewedBy/At` as an independent sign-off | `README.md:70-86`; `lib/acceptance.mjs:228-233` |
| acceptance rule | an automated acceptance case is acceptable only when measured, not stale, not self-authored, not self-run, author and runner are known presets, criteria covered | `lib/acceptance.mjs:184-272`, `:289-385` |
| consumer | `ctx.provide('cases', { gateForTask })`, consumed by `task_close`; 20 named reasons, first reason first | `plugins/test-cases/test-cases.mjs:518-602`; `README.md:295-321` |
| three gates | `verify` = readers only (portability, docs, glossary, schema bytes, context budget); `test` = plugin tests + proofs; `cases` = runs the library | `Makefile:138-144`, `:152-153`, `:159-160` |

So the work is not "add a runner". The runner, the typed checks, the red, the provenance and the
gate are the expensive parts, and they exist. What is missing is the part that makes the four rules
*hold*: what the case is allowed to touch, how the script is born, and what a run records besides
an exit code.

### 3. Six defects, each measured in this library

#### D1. A static check can be an acceptance case

`docs/cases/case-surface-per-role-matches-the-readme-table.json` is `verified`, names `REQ-179`,
and closes a task. Its driver is `plugins/test-cases/test/policy-docs.test.mjs`, which greps a
Markdown table (`:21`, `:71`, `:102`) before it checks the registry (`:114-127`). Both of its runs
record
`"summaryError": "no summary written (CASE_SUMMARY was not used)"` and `"metrics": {}` — the case
measured no number at all; its whole evidence is an exit code from a text comparison. Under R1 this
is not a case: it can be red only when a document and a source map disagree, never when the product
misbehaves.

#### D2. A fixture can stand in for the product

`docs/cases/panel-accessibility-stays-clean-under-axe.json` is `verified` and reports
`serious <= 0`, `violations <= 0`. Its driver loads `docs/cases/fixtures/a11y-page.html`
(`docs/cases/drivers/panel-a11y.mjs:24`), i.e. a hand-written page, not the panel. The measurement
is real and about the wrong object: the panel could become inaccessible and the case stays green.
Under R4 the case never touched the product. Nothing in the record says which object was measured —
`surfaceFiles` lists the driver and the fixture, which is a statement about *files*, not about a
surface.

#### D3. Nothing records what the driver touched

The record has no `surface` and the run has no interactions. `surfaceFiles` was added for drift
detection — "which product files does this case exercise" — and is the opposite of a surface: it
names the files the author *believes* are involved, never the interface the driver *called*. A test
that imports internals and asserts on their shape satisfies every present rule, including the
`SURFACE_FILES_REQUIRED` one.

#### D4. `failsWhen` is untyped, so an existence claim satisfies it

`failsWhen`/`trigger`/`oracle`/`realism` are prose, refused only when empty
(`lib/acceptance.mjs:228`). "The tool is not registered", "the file is absent" and "the page shows
the wrong count" all pass that gate. The record cannot say what *kind* of defect it catches, so the
gate cannot refuse the weakest kind.

#### D5. A case can be recorded without ever being executed, and no one can tell

`automated:false` plus a `reason` is a legal terminal shape (`README.md:40-42`), so a case may be
authored from reading and never run. Where a run did happen, the manual path (`case_verify`) records
`{command, output, exitCode, cwd}` typed by the caller (`README.md:44`), and `lastObservation`
stores the directory, not the actions. Nothing links the tester's exploration to the driver's
actions, so R2's step 2 — *verify the script resembles what I did* — has no mechanism and no
evidence today.

#### D6. A run is one process and one exit code, so "an ordered set of operations" cannot be judged

`CASE_SUMMARY` carries `metrics`, `hashes`, `artifacts`; a run record carries one `exitCode`, one
`durationMs`, a flat `checks` list (`README.md:225-255`). A driver that opens a page, clicks five
things and then measures a log line reports one metric and one exit code: a failure at operation 4
and a failure at operation 5 are indistinguishable, and "ordered actions" survive only as prose in
`steps`. Every case measured with `CASE_SUMMARY` (including the a11y case above) has this shape.

### 4. The architecture: two shelves, five mechanisms

Each mechanism closes one loop and states what it cannot close. Nothing here contradicts a shipped
rule; the additions are additive fields, one tool, and one gate vocabulary.

#### M1. Two shelves, and the gate only reads one

- `verify` — readers of artifacts: paths, packaging, docs, glossary, schema bytes. A rule that can
  only be red on a document belongs here and is called a **check of the tree**, not a case.
- `test` — the implementer's white-box tests (`purpose: implementation`). Fast, allowed to import
  anything, never evidence, never closes a task.
- `cases` — behaviour cases. Every one of them runs something and touches a surface.

The mechanical rule that keeps the shelves apart is M2: **a driver that cannot produce an
interaction with a declared surface is not an acceptance case.** A text comparison cannot produce
one, and a fixture page produces one against the fixture, not against the product's entry.

#### M2. Surface and interactions (R1, R4)

An automated acceptance case declares what it talks to:

```json
"surface": { "kind": "http", "entry": "<origin>/api/tasks" }
"surface": { "kind": "ui",   "entry": "<origin>/panel/tasks" }
"surface": { "kind": "cli",  "entry": "node plugins/test-cases/bin/cases.mjs" }
"surface": { "kind": "process", "entry": "docker compose up -d db-ui" }
"surface": { "kind": "api",  "entry": "@cc/dsh-taskboard#createTask" }
```

`api` is the algorithm's own interface — a public export of the package's declared entry, never an
internal path. That is what makes an algorithmic case legal under R4 while an assertion on a
private helper is not.

The driver reports what it actually did, in `CASE_SUMMARY`:

```json
"interactions": [
  { "kind": "http", "method": "POST", "path": "/api/tasks", "status": 201, "bytes": 412 },
  { "kind": "ui", "url": "/panel/tasks", "action": "click", "target": "[role=button][name=Close]" },
  { "kind": "cli", "argv": ["cases", "close", "T-1"], "exit": 1 },
  { "kind": "process", "event": "ready", "line": "listening on :3080", "afterMs": 812 },
  { "kind": "log", "source": "service.log", "pattern": "requests=1", "count": 1 }
]
```

`case_run` stores them in the run and refuses to verify a v2 acceptance case that has none
(`NO_INTERACTION`), or whose interaction falls outside the declared entry
(`INTERACTION_OUTSIDE_ENTRY`). `case_get` shows them, so a reviewer reads the actions instead of
the author's summary of them.

**Boundary.** Interactions are self-reported, the same class as the run artifact: a driver can
claim an interaction it never made. The default changes though — a doc test now has to *invent* an
interaction, which is a lie with a name, instead of omitting it. If the cost is acceptable on this
host, one real witness closes part of it (**M2b**): the runner already spawns the driver in its own
process group (`lib/runner.mjs:80`), so it can sample the group's descendants and require at least
one whose command line matches the declared `cli`/`process` entry (or a listening port for
`http`/`ui`). That makes "never started the product" impossible; it still does not prove the driver
used *only* the surface.

#### M3. A typed failure kind (R1)

`failsWhen` stays the sentence a human reads; a new field says what kind of defect the case can
catch:

```json
"failureMode": "wrong-result"      // a wrong number, state, page, exit code, latency
"failureMode": "missing-behaviour" // the capability is absent or refuses; legitimised by a wrong-product red
"failureMode": "structure"         // a symbol, file, table or paragraph is absent or different
```

An automated acceptance case may not be `structure` (`STRUCTURE_CASE`); a human may waive one with
`{reason, by:"human"}`. `missing-behaviour` is allowed because red-first *is* its evidence: before
the change the product really does have no such behaviour, and the case fails for a user-visible
reason. The existing `realismReviewedBy` sign-off now covers the failure kind as well as the
scenario — it stays a sign-off, not a proof.

#### M4. The probe: the script is the execution (R2)

New tool `case_probe(driver, surface, { runs, timeoutMs, cwd })`, for the tester (and for the
implementer, on its own implementation cases):

1. executes a driver that is **not yet a case**, through the same executor as `case_run`;
2. writes `docs/cases/probes/<probeId>/` — `run.json` with the driver's bytes hash, the
   interactions, the summary metrics, the artifacts, `head`/`dirty`, and the calling session and
   preset;
3. returns the probe id and the same output the run would return.

`case_record` on an automated acceptance case then requires `probeId` (`UNOBSERVED`), pins
`testHash` to the probe's driver hash, and renders the record's `steps` **from the probe's
interactions** instead of taking prose. A driver edited after its probe is refused at record time
and at run time (`OBSERVATION_VOID`), because the pinned hash no longer matches.

This is exactly the owner's workflow with the comparison removed by construction:

> 1) execute actions via agent → the probe is that execution; 2) the agent writes down the script
> → the script *is* what the probe ran; 3) it goes to the library → recording copies the observed
> interactions as the case's steps.

**Boundary.** A probe directory can be written by someone who did not run it — the B1 forgery class,
unchanged. What it removes is the *silent* path: a case with no probe cannot be recorded at all
without a human waiver, and a driver that changed after its probe is visibly void.

#### M5. Steps, so an ordered set is judged in order (R3)

The driver contract gains `steps`:

```json
"steps": [
  { "id": "open",   "name": "open the panel", "ok": true,  "metrics": { "loadMs": 240 } },
  { "id": "close",  "name": "click Close",    "ok": false, "metrics": {}, "error": "500 from PATCH /tasks/T-1" },
  { "id": "settle", "name": "row leaves the list", "ok": false }
]
```

- a step that reports `ok:false` fails the run and names itself (`step 2 of 3: "click Close"`), with
  its own artifacts under the run directory;
- a check may name a step (`"step": "settle"`), so a metric from one operation is judged without
  collapsing the whole run into one namespace;
- the probe (M4) and the run share the shape, so a probe with steps `open, close, settle` and a
  driver missing `settle` is `STEP_DIVERGED` — the mechanical form of "the script resembles what I
  did".

The contract stays `CASE_SUMMARY` rather than a test framework's own format, on purpose: Node's
runner already gives subtests and switchable reporters, so a `node --test` driver can later map
subtests onto steps through an adapter, while a Playwright walk, a `curl` sequence or a benchmark
loop keeps writing the same JSON without being forced through a test framework.

With M5, the owner's three shapes are ordinary cases: a UI button is `ui` interactions + a step per
action; a log-checking latency budget is a `process` interaction for readiness, a `log`
interaction and a `p95 <= 250` check; an ordered command set is a `cli` step per command.

### 5. The tester's procedure

This is the procedure the tester persona carries (`profile/cordis.patch.yml`):

| # | step | evidence it leaves |
|---|---|---|
| 1 | read the requirement and its acceptance criteria; write the oracle from them, never from the implementation | `oracle`, `criterionId` |
| 2 | explore the product through its public surface (shell, HTTP, browser, the running service) | the tester's session log |
| 3 | encode the exploration as a driver that emits `interactions` and `steps` | the driver file |
| 4 | `case_probe` the driver until it shows the behaviour you saw | probe: interactions, metrics, artifacts, driver hash |
| 5 | `case_record { probeId }` | a case whose steps are the observed interactions, its test bytes pinned |
| 6 | `case_run { mode:"red", redSource:"wrong-product", cwd:<previous tree> }` — it must fail there | measured red, with the tree named |
| 7 | `case_run` green against the change | measured green, checks evaluated |
| 8 | another preset replays it; the gate judges independence from the task row | `runBy`, `authorPreset`, gate verdict |

Rules that ride along: the tester writes only under `docs/cases/` and the test roots
(`profile/cordis.patch.yml:308-320`); a driver's expected result never comes from the code it
tests; when the product passes a case that should have failed, the case is wrong or the red was
never real — say so, do not make it green.

### 6. The gate, and the migration

New reasons, all about the record's shape rather than its evidence:

```
SURFACE_MISSING           an automated acceptance case declares no surface
NO_INTERACTION            its measured run touched no declared surface
INTERACTION_OUTSIDE_ENTRY an interaction is not under the declared entry
STRUCTURE_CASE            failureMode is "structure" (human waiver possible)
UNOBSERVED                no probe ran the driver it was recorded with
OBSERVATION_VOID          the driver's bytes changed after its probe
STEP_DIVERGED             a probed step is missing from the run (P3)
```

Migration is the sensitive part. The library holds records written under the current
`schemaVersion: 1`, and INV-FAILCLOSED says a legacy record blocks rather than passes quietly. The
proposal is therefore: **v2 rules apply to v2 records**; a v1 record keeps its present verdict, and
`make cases --audit` prints the migration queue (exit-code-only cases, cases without a surface,
documented-only cases). A config flag `cases.strict: true` flips the gate to fail-closed on v1 too;
it is flipped when the queue is empty. The two known offenders are fixed in P0 either way, because
they are wrong now, not because of the new schema.

### 7. Phases, each with its proof

**P0 — audit and the static check (no schema change).**
`cases.mjs audit [--json]` lists four groups without writing: `documented` (no driver),
`unmeasured` (no runner evidence), `exit-code-only` (every measured run has no `CASE_SUMMARY`) and
`legacy-v1`. `scripts/check-role-table.mjs` joins `make verify` and refuses a README role row that
disagrees with `DEFAULT_ROLE_TOOLS`.
The text half of `policy-docs.test.mjs` is **not** removed in P0: the case that points at it closes
tasks today, and deleting its driver before the replacement exists would leave that task with no
acceptable evidence. P1 removes it together with re-recording the registration half as an
`api`-surface case.
The a11y case's disposition is the **author's or a human's** edit, not an agent's: the record is
`source: human`, and `case_update` refuses anyone else (`AUTHOR_ONLY`). P0 only puts it in the
audit queue; P1 records the replacement driver against the panel.
*Proof:* `--audit` names the exit-code-only case; the new verify check exits 1 on an edited role row
and 0 after the restore; `git status` shows no case record touched. *Not changed:* schema, runner,
gate.

**P1 — surface, interactions, failure kind (R1, R4).**
Add `surface`, `interactions`, `failureMode`; store interactions in the run; gate reasons
`SURFACE_MISSING`, `NO_INTERACTION`, `INTERACTION_OUTSIDE_ENTRY`, `STRUCTURE_CASE`; `case_get`
shows interactions.
*Proof:* a driver that imports a module and asserts on internals is refused
(`NO_INTERACTION`); the split registration driver passes and its interactions are in `case_get`; a
doc-table case recorded as `structure` is refused by `case_gate` while a `wrong-result` one is not.
*Not changed:* probe, steps.

**P2 — the probe (R2).**
`case_probe`, `probeId`, `OBSERVATION_VOID`, `UNOBSERVED`; steps rendered from the probe.
*Proof:* recording an automated acceptance case without a probe is refused; probe → record → edit
one byte of the driver → `case_run` refuses `OBSERVATION_VOID`; the probe artifact carries the
interactions and the session that produced them.

**P3 — steps (R3).**
`CASE_SUMMARY.steps`, per-step checks, the failed step named in the run, panel and CLI;
`STEP_DIVERGED`.
*Proof:* a three-step driver failing at step 2 reports `step 2 of 3` with its artifact; a probe
with three steps and a driver performing two is refused; a `process` case (start → readiness →
load → log metric → stop) reads its p95 from the service's own log and fails on a 260 ms sample.

**P4 — migration (done).** `cases.strict` is on, the audit queue is empty, README and this
document carry the corrected text, the three words are in the glossary, and the tester persona names
the §5 procedure. *Proof:* `make cases` is green with strict on; the glossary check accepts the
rows; a tester case names the procedure it follows.

### 8. Decisions for the owner

- **Q1. Is a fixture page a legal acceptance surface?** *Proposal: no.* A fixture may back an
  implementation case; an acceptance case must name the product's entry. This is the a11y case.
- **Q2. Is a public exported function a legal surface (`api`)?** *Proposal: yes* — that is the
  algorithm's interface, which is what R4 protects. Non-exported paths never.
- **Q3. Does `automated:false` survive?** *Proposal: only as `observed`* — a case with a probe and
  no driver yet, which cannot close a task and whose age `make cases` reports. No documented-only
  rest state without an executed probe.
- **Q4. When does the gate turn strict on existing records?** *Proposal:* after the audit queue is
  empty, with `cases.strict` as the reversible switch; not immediately.
- **Q5. Who may call `case_probe`?** *Proposal:* the tester for acceptance cases; the implementer
  for its own implementation cases, which never close anything.

### 9. What this architecture still cannot prove

- Interactions and probes are self-reported records on disk; whoever can write the run and the case
  can forge the pair (B1). M2b narrows it; the journal, not this rule, closes it.
- A driver may still read the product's source. The lint (P0's split) refuses the common shape
  (imports of internals, reads of source paths) and a packed-surface isolation mode
  (`surface.isolation: "packed"` — the case runs against the installed artifact, where the source is
  not present) removes the access for the cases that opt in. Neither is a proof.
- `realism`, `failureMode` and the wrong-result judgement are sign-offs by another preset, not
  measurements.
- A probe proves the driver ran on this host and tree; reproducibility across machines depends on
  the case's `fixture` and `cwd` declarations, which stay prose.

---

## 10. Доска задач: журнал и снимок

Решение и его граница проверки. Историю заходов и то, что осталось за границей, хранить рядом с решением: без них следующий читатель повторит уже отвергнутое.

Статус: **подключено и измерено на копии реальной доски** (2026-11-27, третий заход). Хранилище
`plugins/taskboard/lib/store.mjs` подключено к `mutate` и к чтению доски: операция пишет одно
событие, доска читается снимком и хвостом, экспорт остаётся производным. Замер на копии доски
autolabel_pipeline (13 315 629 Б, 1553 задачи): закрытие 5,3 мс (было 453), десять закрытий 98,1 мс
(было 3914), чтение списка 11,7 мс (было 110,9), размер `taskboard.json` между 30 операциями не
изменился ни на байт. Ниже — записка второго захода; числа и остаток работы обновлены в разделе
«Подключено».
`plugins/taskboard/lib/store.mjs` читает доску как «снимок + хвост журнала», пишет одно событие
на операцию, строит событие-генезис при миграции и восстанавливает доску из журнала после
повреждённого снимка. На копии реальной доски проекта autolabel_pipeline (13 315 629 Б, 1553
задачи) двадцать операций через настоящий `createService` дают **побайтно равный** экспорт:
sha256 `94596f0bab2da3f01c52bf6c3bc2428ea877ac7f93fe7fdbbbc493af53475410` у свёрнутой доски и у
файла, который записал старый код. В `taskboard.mjs` хранилище **не подключено**: `mutate` :983
по-прежнему читает и пишет доску целиком. Остаток — подключение и одно решение владельца (§«Что
осталось»); полумигрированного состояния нет: старый путь записи не менялся.

### Какие инварианты сохраняются

- **Журнал остаётся append-only JSONL** и остаётся сливаемым через scripts/state-merge.mjs: строки
  опознаются идентификаторами (boardId, caseId, analysisRef), выбор стороны при конфликте запрещён
  (AGENTS.md). Файл событий — `.dsh/taskboard.events.ndjson` рядом с доской (store.mjs pathsFor).
  С 2026-11-28 каждая запись несёт сведения проверки в самой строке:
  `check: {prev, hash, rows}` — `rows` это sha256 каждой записанной строки, `hash` покрывает
  событие, `prev` связывает его с предыдущим (D-ONE анализа taskboard-write-integrity).
- **`taskboard.json` остаётся** производным экспортом для панели и внешних потребителей.
- **CAS по revision** и **блокировка доски** (`withBoardLock`, каталог-замок рядом с доской) не меняются.
- **Номера `seq`** монотонны: в plugins/project-state/lib/core.mjs уже есть счётчик state/events.seq
  с восстановлением по хвосту журнала (коммит 8453cf6).
- **Проекции state/views/** пересобираются из состояния и побайтно совпадают (проверено: хеш
  3e9ad79bcf6a11c2 до и после правок прошлой задачи).
- Существующий **журнал строк** `.dsh/taskboard-journal.ndjson` (хеш-цепочка, lib/journal.mjs)
  НЕ получает новых записей с 2026-11-28: он остаётся только на чтение для строк, записанных до
  перехода, и по-прежнему отказывает при подмене такой строки. Это заменило прежний пункт «журнал
  не меняется» по решению D-ONE: две записи на одно изменение расходятся при сбое, а вызовы по
  месту пропускали часть изменений.

### Что становится источником истины

Журнал событий доски — `.dsh/taskboard.events.ndjson`. Одно событие на операцию:

    {"at":"…","op":"update","revision":42,"rows":[<полная строка задачи>],"removed":[],"agents":[…]}

Правило свёртки: строки применяются по id (последняя запись побеждает, новая строка добавляется в
конец — порядок задач в экспорте сохраняется), `removed` удаляет, `agents` заменяется целиком
(260 строк ≈ 40 КБ — дешевле, чем отслеживать их по одной), `revision` — номер записи. Поле `order`
несёт только операция, которая переставляет доску (сейчас таких нет).

Первое событие при миграции — **генезис**: вся доска целиком одним событием. Без него журнал не
может восстановить доску после битого снимка — проверено прототипом и повторно этим заходом.

### Как читается доска

Снимок `.dsh/taskboard.snapshot.json` (`{version, at, offset, board}`) плюс хвост журнала от
`offset`. В процессе — кеш по паре (размер + mtime снимка, размер + mtime журнала): совпали —
чтения нет вообще.

Замер на копии доски autolabel_pipeline (13 315 629 Б, 1553 задачи, 260 агентов), стенд
`/tmp/board-scale/proof.mjs`:

| путь | медиана |
|---|---|
| сегодня: `JSON.parse` всей доски | **110,9 мс** |
| снимок + хвост, холодное чтение (снимок 13,7 МБ) | 127,4 мс |
| снимок + хвост, кеш тёплый (два stat) | **0,021 мс** |
| запись: перезапись всей доски старым кодом | 295 мс (прошлый замер) |
| запись: одно событие в журнал | **750–852 Б на операцию**, 4–5,6 мс при журнале 0 / 1 / 10,5 МБ |

Двадцать операций (создание, обновление, заметка, закрытие ×5) дали журнал 11,4 МБ, потому что в
нём лежит генезис на 11,4 МБ; сами операции — 748 Б медиана.

### Когда пишется снимок

По порогу: когда хвост журнала перерос `SNAPSHOT_EVERY = 400` событий (≈ 300–340 КБ) или по явной
команде экспорта. Экспорт доски пишется тем же атомарным путём, что и сегодня (temp + rename), затем
`offset` снимка сдвигается на текущий размер журнала. Порог проверен: после 401 события
`tailLength()` возвращает 401.

### Что проверено

Команда: `cd /tmp/board-scale && node proof.mjs` (exit 0), копия `/tmp/state-cost/proj/taskboard.json`.

- **Эквивалентность**: свёрнутая доска побайтно равна экспорту старого кода —
  `folded sha256 94596f0bab2da3f01c52bf6c3bc2428ea877ac7f93fe7fdbbbc493af53475410`,
  `export sha256` тот же, `BYTE EQUAL: true`, 1558 задач с обеих сторон.
- **Миграция**: на копии только с экспортом `migrate()` дал
  `{"migrated":true,"genesis":true,"exportUnchanged":true,"rows":1553}`; экспорт не переписан
  (sha256 до и после `f8cc70dc151fdb29`).
- **Битый снимок**: обрезанный до трети снимок — `source recovered`, в логе
  `taskboard: snapshot … is unreadable (Unterminated string in JSON at position 4038240 …); rebuilding the board from the journal`,
  восстановленная доска побайтно равна ожидаемой (`BYTE EQUAL: true`).
- **Журнала нет**: `source export`, доска побайтно равна экспорту — старая доска читается как сегодня.
- **Тесты плагинов**: `node --test plugins/project-state/test/*.test.mjs` — 40/40, exit 0.

### Подключено (третий заход)

- **Запись**: `mutate` (:983) читает доску через хранилище, оборачивает её в `trackBoard` и после
  операции пишет одно событие: строки, которые колбэк тронул, удалённые id, `agents` при изменении,
  `order` при перестановке. Затронутые строки собираются по факту записи в прокси, а не диффом всей
  доски: обёртка создаётся только для строк, которые колбэк прочитал.
- **Чтение**: `readBoard` читает снимок и хвост (`storeFor(path).load()`). Доска меньше
  `EXPORT_LIVE_LIMIT` (512 КБ) по-прежнему читается из экспорта и экспорт пишется на каждой
  операции — поведение маленькой доски не изменилось; больше порога — снимок + хвост, экспорт по
  порогу 400 событий. Это же правило держит панель: она читает `taskboard.json` напрямую
  (client.js:9, :248), и для маленькой доски файл свежий как раньше.
- **`writeBoard`** (публичная полная запись) дописывает событие `genesis`/`board` и снимок, поэтому
  журнал остаётся источником истины и после полной записи; файл не переписывается задним числом.
- **Замер** (`cd /tmp/board-scale && node live.mjs`, exit 0): 20 операций (создание, обновление,
  заметка, закрытие ×5) — экспорт `13315629 -> 13315629` байт (не изменился), журнал
  `0 -> 11418831` Б (генезис 11,4 МБ + события ≈ 550–750 Б на операцию); закрытия 4,9 / 5,2 / 5,3 /
  5,8 / 6,1 мс, медиана 5,3; десять закрытий 98,1 мс, максимум 11,2; чтение списка 11,72 мс; после
  30 операций размер экспорта тот же.
- **Эквивалентность** (`cd /tmp/board-scale && node eq.mjs`, exit 0): после КАЖДОЙ из 20 операций
  доска, свёрнутая из снимка и хвоста **свежим процессом чтения**, побайтно равна доске, которую
  держит рабочий процесс — `checks 20, mismatches 0`, итоговый sha256
  `05bcc7615778df8e5da3c76dc8b9417dca8a7ed166fb103f2a220de5bad7c62f`. Это и есть проверка, что
  запись не теряет ни одной изменённой строки: пропущенная строка разошлась бы с холодной свёрткой.
- **Сборка**: `node scripts/pack-plugin.mjs --dir plugins/taskboard` с новой версией пакета — в
  `files` добавлен `lib/store.mjs`; содержимое архива побайтно равно исходникам (taskboard.mjs
  `37e2ba4b4a47394d`, lib/store.mjs `a7c64a05e25a1eed`). В профиль не устанавливалось.

### Проверка в записи (четвёртый заход, 2026-11-28)

- **Почему.** Сведения проверки писались отдельным журналом только из `create`/`update`/`close`,
  вне блокировки `mutate`; завершение субагента, привязка, заметка, пауза и смена статуса
  владельцем меняли строку без записи, и закрытие отказывало законному изменению
  (`TASK_JOURNAL_MISMATCH`). Замер: первое событие свежей доски было `op:"update"`, поэтому
  журнал без экспорта и снимка доску не восстанавливал.
- **Формат.** `{"at","op","revision","rows","removed","agents","order","check":{"prev","hash","rows"}}`:
  одна строка несёт и изменение, и его проверку. `rows` — sha256 каждой записанной строки,
  `prev`/`hash` — цепочка. Первое событие свежей доски — `genesis` с `version`, поэтому один
  журнал восстанавливает доску без экспорта и снимка.
- **Переход.** Старый журнал без genesis не переписывается и не получает genesis задним числом;
  доска читается через снимок или экспорт, как раньше. Строка, подтверждённая только старым
  журналом, закрывается; строка, изменённая после его последней записи, по-прежнему отказывает —
  подтверждение не пересчитывается молча. Одна законная запись (update/note/закрытие) фиксирует
  строку в новом журнале, после чего закрытие проходит.
- **Чтение.** `readBoard` читает журнал (снимок + хвост), а не экспорт: отставший экспорт больше
  не воскрешает старую строку. Закрытие сравнивает экспорт с подтверждённой доской: отставший
  (позади) допустим; совпадающая ревизия с другими байтами или экспорт впереди журнала — отказ.
- **Оборванная и испорченная запись.** Хвост без перевода строки не применяется и обрезается
  перед следующей записью; полная строка, которая не разбирается, — повреждение: чтение
  останавливается перед ней, закрытие отказывает.
- **Замер** (Windows, копия доски 12 938 998 Б, 1553 строки): миграция 59 мс (генезис 12,8 МБ +
  снимок), запись события 1 мс медиана (8501–8559 Б на изменение одной строки), чтение после
  записи 12 мс (перечитывает снимок 13 МБ), рабочая доска 471 КБ — холодное чтение 6 мс, тёплое 0.
  Хвост журнала читается с байтового смещения, а не целиком: на этом стенде чтение после записи
  упало с 19 до 12 мс, остальные 12 мс — разбор снимка.
- **Проверено.** `node --test test/write-integrity.test.mjs` — AC-1/AC-2/AC-3, exit 0;
  `node --test "plugins/taskboard/test/*.test.mjs"` — 75/75, exit 0. Независимый зелёный прогон
  кейсов — за TESTER.

### Граница проверки

Что проверка ловит, а что нет — чтобы не обещать больше измеренного.

- **Полная запись без сведений проверки после начала проверяемой истории.** Строки, которые она
  записала, не подтверждаются: их закрытие отказывает. Если такая запись удаляет строки, удалённые
  строки теряют подтверждение вместе с отметками. При том же номере ревизии подмена видна по
  сравнению экспорта с журналом. При большем номере она неотличима от записи прежней версии
  кита — законного случая при смешанной установке — поэтому остальные строки продолжают
  закрываться, а затронутые не подтверждаются. Это осознанный компромисс, а не пропущенная
  проверка: превратить его в отказ всей доски значит сломать журнал, который писала прежняя
  версия.
- **Согласованная подмена всех файлов** (журнал, снимок и экспорт переписаны вместе) не
  обнаруживается: независимого свидетеля вне этих файлов нет. Пропажа журнала при живом снимке
  обнаруживается, потому что снимок ссылается на записи, которых нет.
- **Сохранность при отказе питания** ограничена тем, что успела записать файловая система. Одна
  запись под блокировкой даёт либо полную строку, либо оборванный хвост, который отбрасывается;
  это проверено прогоном, но не имитацией отключения питания на каждой платформе.

### Что осталось после третьего захода (история)

Раздел сохранён как запись состояния на 2026-11-27 и **не является списком текущих работ**:
подключение хранилища к `mutate` и чтения через хранилище уже сделаны, версия пакета — та, что называют профиль и установщик.

1. **Подключить хранилище к `mutate`** (plugins/taskboard/taskboard.mjs:983). Нужно знать, какие
   строки изменились: колбэк меняет строки на месте (:1656–1670), поэтому либо колбэк объявляет
   затронутые id (16 мест вызова :1304, :1394, :1487, :1551, :1631, :1782, :1799, :1954, :1975,
   :2008, :2034, :2143, :2205, :2266, :2360, :2382 плюс `closeOne`), либо `mutate` оборачивает строки
   в отслеживающую обёртку и собирает изменённые. Диф «до/после» не годится: сериализация 1553 строк
   ≈ 90 мс на операцию, экономия съедается.
2. **Все чтения — через хранилище**: `readBoard` вызывается в 9 местах (:986, :1012, :1348, :1363,
   :1377, :1502, :1514, :2071, :2315). Пока они читают экспорт, а экспорт пишется по порогу, они
   видят доску на момент последнего снимка.
3. **Решение владельца**: критерий «размер `taskboard.json` не меняется между операциями» делает
   экспорт устаревшим между снимками по определению. Пять тестов читают экспорт сразу после
   операции и требуют строку на месте (test/batch-review.test.mjs:139,146; test/dead-child-close.test.mjs:127;
   test/journal.test.mjs:47; test/owner-status.test.mjs:156–170). Это проверка старого контракта;
   после подключения их нужно переписать на чтение через хранилище — это смена требования, а не
   починка теста, и её должен подтвердить владелец. Альтернатива — писать экспорт на каждой
   операции: тогда закрытие остаётся ~300 мс и критерий записи не выполняется.
4. **Пересобрать** `plugins/cc-dsh-taskboard-<версия>.tgz` после подключения.

### Почему за один заход не сделано целиком

Запись устроена так: `mutate(cwd, operation)` читает доску, даёт колбэку **изменить строки на
месте** и затем пишет доску целиком (`writeBoardNow`, :667–671). Подключение хранилища — это смена
источника истины для 16 точек записи и 9 точек чтения плюс смена контракта экспорта, от которого
зависят панель, зеркало и пять тестов. Оценка прошлого захода — 2–3 часа; в 45–60 минут это
влезает только с риском тихой потери строк, а тихая потеря строк в доске задач дороже ещё одного
захода. Хранилище и его доказательство готовы; подключение — отдельный, механический, но
многоточечный шаг.
