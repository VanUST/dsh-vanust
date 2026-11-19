---
id: TASK-201
kind: task
title: "V1.1: allow-list инструментов вместо deny-only"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.097Z
updatedAt: 2026-11-17T15:52:42.097Z
acceptance:
  - text: "`tool-families` поддерживает `allow` на пресет: остаются только совпавшие шаблоны, всё прочее снимается; `deny`/`projectDeny` работают как раньше; пресет без строки (standard, cordis, ptc, незнакомый) сохраняет полную поверхность"
    done: false
  - text: "Восемь строк профиля переписаны как allow-list по таблице дизайна: orchestrator ≤40, backend ≤16, reviewer ≤14, critic ≤14, gatherer ≤10, research ≤14, docs ≤14, ux ≤40 — с сохранением обязательных для роли инструментов (read/write/edit/glob/grep/bash где нужны, task_get/task_note, тестовые case_* по таблице)"
    done: false
  - text: "Proof-скрипт: таблица решений для всех пресетов + red-first на старых байтах 0.1.10 (там `allow` игнорируется и пресет получает лишнее)"
    done: false
  - text: "Второй сервер: по одной свежей сессии на каждый из восьми пресетов — в заголовке первого запроса число инструментов в пределах бюджета, чужие семейства (mcp__playwright__*, mcp__godot__*, hindsight_*) отсутствуют там, где не объявлены; набор не меняется между шагами (один request/header)"
    done: false
  - text: "`make verify` exit 0, тарболы перепакованы и совпадают с исходниками; документы обновлены"
    done: false
boardId: task-mwkpynfl-6m2cmm
nonScope: ["state-feed, ядро состояния, раннер, taskboard — следующие задачи v1", "context-budget.mjs и линтер схем — отдельные задачи", "живой :3080 не трогать; доказательство на втором сервере", "не менять поведение встроенных пресетов харнесса (standard, cordis, ptc)"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["node scripts/tool-families-proof.mjs → 92/92, exit 0; на байтах 0.1.10 → 15/92, exit 1", "reports/probes/v11-allowlist.md + v11/headers.json + v11/split.json: восемь сессий, глобальные в бюджете (33/13/11/11/9/12/13/37), Playwright только ux (24), Godot нигде, Hindsight только корень (4 read), один request/header у каждой", "make verify → exit 0; тарбол 0.1.13 совпадает с исходником; :3081 погашен, :3080 не тронут"]
resultSummary: "Allow-list работает и доказан: 92/92 в proof-скрипте, red-first 15/92 на старых байтах. Восемь живых сессий на :3081 показали по одному заголовку на пресет; по глобальным (подвластным политике) инструментам все в бюджете — 33/13/11/11/9/12/13/37 при 40/16/14/14/10/14/14/40; Playwright остался только у ux (24), Godot нигде, Hindsight только у корня (4 read-инструмента), task_* у воркеров 2. Полный заголовок при этом выше бюджета на 23–27 инструментов — это scoped-инструменты пресетов, которые tools.restrict не кроет (D11). Ликвидация разрыва — изменение состава пресетов, а не политики."
role: BACKEND
scope: ["plugins/tool-families — `allow` на пресет, сохранить deny/projectDeny, обновить README и сервис factsFor (removed = что реально снято)", "profile/cordis.patch.yml — восемь строк как allow-list по таблице дизайна", "scripts/tool-families-proof.mjs — таблица решений с allow, red-first на старых байтах", "второй сервер: по свежей сессии на каждый из восьми пресетов, заголовки первого запроса", "перепаковка tool-families, документы кита (README, rules/DEPLOYMENT.md при расхождении)"]
---

Перевести tool-families с deny-only на allow-list и переписать восемь пресетов кита как allow-list по измеренной базе и таблице дизайна §5.3. Сейчас политика перечисляет только запрещённое, поэтому любой новый хост-плагин (MCP, Hindsight, outline) протекает в каждую роль: у корня 109 инструментов и ~99 КБ схем, у backend 56 и 42 КБ, Hindsight 8 инструментов / 6.5 КБ в каждом дочернем заголовке, хотя за все дочерние журналы было 9 его вызовов. После изменения пресет объявляет только нужное: всё, что не совпало с `allow`, не выдаётся. Правило D8: allow-list применяется к восьми пресетам кита; пресет без строки (standard, cordis, ptc) сохраняет полную поверхность. Заодно моё замечание из probe 4: набор внутри процесса уже стабилен (один request/header), это надо зафиксировать проверкой, а не менять. Докажи red→green и прогони реальные заголовки по всем восьми пресетам.

Migrated from .dsh/taskboard.json (task task-mwkpynfl-6m2cmm, revision 12).
