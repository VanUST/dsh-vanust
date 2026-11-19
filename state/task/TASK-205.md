---
id: TASK-205
kind: task
title: "V1.3: гейт пяти хост-плагинов по пресету в силе"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.183Z
updatedAt: 2026-11-17T15:52:42.183Z
acceptance:
  - text: "Пять плагинов (designmap, diagrams, presentation, papers, test-cases) решают по пресету в силе: проекция agentPresets.presetForSession → запомненный выбор из agent-preset/selected → заголовок только как последний fallback; ни один гейт не бросает исключение (иначе agent/created отменяет создание сессии)"
    done: false
  - text: "Повторная регистрация при смене места: если выбор пришёл после agent/created, инструменты чужого пресета снимаются, свои регистрируются — всё до первого request/header"
    done: false
  - text: "Резолвер в одном месте: использовать существующий toolFamilies.presetFor (tool-families уже слушает agent-preset/selected на ctx.root), новую копию логики не заводить; при отсутствии сервиса — задокументированный fallback"
    done: false
  - text: "Исправлены обе ошибки размещения: research получает papers_*, gatherer не получает case_* (неизвестный пресет — пустой набор)"
    done: false
  - text: "Доказательство на РАБОЧЕМ профиле (не на копии установленного): восемь свежих сессий, заголовки — analysis_*/designmap_*/diagram/presentation только у orchestrator, papers_* только у research, case_* только по таблице, babysitter_* отсутствует; make verify exit 0"
    done: false
boardId: task-mwkrnoos-kn609z
nonScope: ["analysis_* и delegate_task остаются гейтованными по root-признаку — перенос на пресет это отдельное решение", "не менять allow-list tool-families и её политику", "не менять состав пресетов (блоки) — они ни при чём: гейтованных плагинов в них нет", "ядро состояния, state-feed, раннер — следующие задачи", "живой :3080; доказательство на копии РАБОЧЕГО профиля, а не установленного"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["reports/probes/v13/headers.json: 8 сессий на рабочем профиле; designmap_* 7 только у orchestrator, diagram/presentation у orchestrator+ux, papers_* 3 у research, case_* по таблице (gatherer 0), babysitter_* 0, playwright 24 у ux, headers=1 у всех", "make verify → exit 0 (17/17 + documentation ok), моя проверка", "перепаковано: designmap 0.1.20, diagrams 0.1.6, presentation 0.1.10, papers 0.1.6, test-cases 0.1.13", ":3083 погашен, web-v13 удалён, :3080 не тронут"]
resultSummary: "Гейт пяти хост-плагинов переведён на пресет в силе и доказан восемью живыми сессиями на рабочем профиле. Резолв одной точкой (toolFamilies.presetFor → проекция → заголовок), регистрация отложенная и не бросающая. Итог: designmap_* только у orchestrator, diagram/presentation у orchestrator и ux, papers_* 3 у research (было 0 у всех), case_* по таблице ролей (gatherer 0), babysitter ни у кого, Playwright 24 только у ux, по одному заголовку на сессию. Полные заголовки: 52/50/27/24/23/15/22/25. Пять плагинов перепакованы, make verify зелёный. FR2 отложен: для пяти PTC-пресетов счётчик инструментов слеп (1 run_code при 53 365 Б промпта) — нужен ваш выбор про байтовый бюджет."
role: BACKEND
scope: ["plugins/designmap, diagrams, presentation, papers, test-cases — гейт по пресету в силе с отложенной регистрацией", "использование toolFamilies.presetFor как единственной точки резолва (fallback задокументировать)", "доказательство на копии рабочего профиля: восемь свежих сессий и заголовки", "перепаковка изменённых плагинов, документы, make verify"]
---

Починить гейт пяти хост-плагинов: они решают по пресету СОЗДАНИЯ сессии (header.agentPreset = дефолт orchestrator), поэтому все восемь мест получают набор оркестратора, research не получает papers_*, а gatherer получает 5 case_*. Авторитет — проекция agentPresets.presetForSession; выбор места приходит событием agent-preset/selected, которое соседний ряд не слышит — слушать надо ctx.root, как уже сделано в tool-families. Резолвер не копировать шестью копиями: точка входа — существующий toolFamilies.presetFor. Регистрация должна переживать смену места после agent/created: снять набор чужого пресета и зарегистрировать свой до первого request/header. Гейт не имеет права бросать: исключение в agent/created отменяет создание сессии (наблюдалось как gateway/internal: failed to create session).

Migrated from .dsh/taskboard.json (task task-mwkrnoos-kn609z, revision 12).
