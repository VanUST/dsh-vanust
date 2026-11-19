---
id: TASK-204
kind: task
title: "Разведка: кто регистрирует scoped-инструменты и по какому пресету"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.163Z
updatedAt: 2026-11-17T15:52:42.163Z
acceptance:
  - text: "Таблица по каждому семейству scoped-инструментов в РАБОЧЕМ профиле (analysis_*, designmap_*, diagram, presentation, papers_*, case_*, skill_*, todo, job_*, delegate_task, bash): плагин-регистратор → есть ли гейт по пресету → какое значение он читает → `file:line` → в какой момент регистрирует (agent/created, selection, pre-step)"
    done: false
  - text: "Назван точный владелец гейта для каждой семьи и почему в V1.2 урезание блоков пресетов не изменило ни одного заголовка"
    done: false
  - text: "Ответ по механизму: как хост-плагин легально узнаёт пресет в силе на момент регистрации (какой сервис/проекция, что нужно в `inject`), и что означает ошибка `gateway/internal: cannot get property \"session\" without inject` — какой сервис отдаёт `session`, чего не хватало"
    done: false
  - text: "Явно перечислено, что определить не удалось"
    done: false
boardId: task-mwkr32nn-t7mo5h
nonScope: ["ничего не менять — только чтение и цитируемый отчёт", "не поднимать серверы и не запускать сессии", "не проектировать финальное решение — только точки и владельцы"]
owner:
  kind: agent
  label: CONTEXT
  sessionId: dafcdddc-9be0-4a41-b8a6-6a6cf5c68c19
ownerRole: CONTEXT
preset: gatherer
resultEvidence: ["plugins/designmap/index.js:54 (presets.includes(header.agentPreset)), diagrams/index.js:28-45, presentation/index.js:28-45, papers.mjs:434-453, test-cases.mjs:843-846 — все пять читают header.agentPreset", "analysis.mjs:243-244 и orchestrator.mjs:1255 — гейт по isRootAgent, не по пресету", "каскад: createSession без пресета → resolve(undefined) → defaultId=orchestrator → meta; agent-preset/selected (api-session-controller:394) заголовок не переписывает", "проекция — авторитет: agentPresets.presetForSession (dsh-agent-preset-registry:479-481); событие agent-preset/selected на ctx.root (dsh-agent-preset-registry:466-468)", "ошибка cannot get property session — чтение ctx.session; службы session нет, сессию отдают agents/sessions (dsh-agent:450, dsh-session:1820); исключение в agent/created отменяет создание сессии"]
resultSummary: "Владельцы гейтов названы: пять плагинов (designmap:54, diagrams:28-45, presentation:28-45, papers:434-453, test-cases:843-846) решают по header.agentPreset; analysis и delegate_task — по root-признаку. Профиль создаёт сессию с дефолтом orchestrator, поэтому на agent/created все восемь мест видны как оркестратор. Авторитет — проекция agentPresets.presetForSession; выбор приходит событием agent-preset/selected на ctx.root (реестр переиздаёт его на своём контексте, соседний ряд его не слышит). Ошибка cannot get property session — чтение ctx.session: службы session нет, сессию отдают agents/sessions; исключение в agent/created отменяет создание сессии. Резолвер уже существует в tool-families; нужна его общая точка и отложенная регистрация."
role: CONTEXT
scope: ["рабочий профиль, плагины кита и чекаут харнесса — чтение", "цитируемый отчёт с таблицей семейств и механизмом резолвера"]
sessions:
  - sessionId: dafcdddc-9be0-4a41-b8a6-6a6cf5c68c19
    label: CONTEXT
    role: CONTEXT
    status: sleeping
---

Назвать точно, кто регистрирует scoped-инструменты в сессию и по какому значению решает, и почему все восемь пресетов получают полный набор. V1.2 доказала: урезание блоков пресетов не изменило ни один заголовок; papers и test-cases читают `agent.session.header.agentPreset`, а у analysis/designmap гейта по пресету в коде нет — значит гейт в другом месте. Нужно: (1) по каждому семейству `analysis_*`, `designmap_*`, `diagram`, `presentation`, `papers_*`, `case_*`, `skill_*`, `todo`, `job_*`, `delegate_task`, `bash` — плагин, гейт, читаемое значение, `file:line`, момент регистрации; (2) каким образом хост-плагин легально читает пресет в силе на момент регистрации и что нужно в `inject`; (3) что означает ошибка `cannot get property \"session\" without inject` и какой сервис её снимает. Это вход для правки одного резолвера, а не шести копий.

Migrated from .dsh/taskboard.json (task task-mwkr32nn-t7mo5h, revision 6).
