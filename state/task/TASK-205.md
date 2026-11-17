---
id: TASK-205
kind: task
title: "V1.3: гейт пяти хост-плагинов по пресету в силе"
status: done
revision: 1
createdAt: 2026-11-17T15:52:42.183Z
updatedAt: 2026-11-17T15:52:42.183Z
boardId: task-mwkrnoos-kn609z
ownerRole: BACKEND
---

Починить гейт пяти хост-плагинов: они решают по пресету СОЗДАНИЯ сессии (header.agentPreset = дефолт orchestrator), поэтому все восемь мест получают набор оркестратора, research не получает papers_*, а gatherer получает 5 case_*. Авторитет — проекция agentPresets.presetForSession; выбор места приходит событием agent-preset/selected, которое соседний ряд не слышит — слушать надо ctx.root, как уже сделано в tool-families. Резолвер не копировать шестью копиями: точка входа — существующий toolFamilies.presetFor. Регистрация должна переживать смену места после agent/created: снять набор чужого пресета и зарегистрировать свой до первого request/header. Гейт не имеет права бросать: исключение в agent/created отменяет создание сессии (наблюдалось как gateway/internal: failed to create session).

Migrated from .dsh/taskboard.json (task task-mwkrnoos-kn609z, revision 12).
