---
id: TASK-194
kind: task
title: "P0.3: утверждения о возможностях из фактического набора + Playwright снят с оркестратора"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.908Z
updatedAt: 2026-11-17T15:52:41.908Z
acceptance:
  - text: "`node scripts/tool-families-proof.mjs` утверждает «playwright removed for orchestrator» и проходит 100%, exit 0; на старых байтах 0.1.8 этот же скрипт падает (red-first)"
    done: false
  - text: "Новый proof-скрипт политики оркестратора падает на старых байтах 0.1.48 и проходит на новых: раздел есть только для описанного пресета, литерала «you have no bash at all» нет, перечислено фактически снятое, текст одинаков при изменении реестра между вызовами"
    done: false
  - text: "Второй сервер: свежая сессия orchestrator — 0 инструментов `mcp__playwright__*` в заголовке первого запроса; свежий корень на `cordis` — в системном сообщении нет раздела `deployment:orchestrator-policy`; сессия, созданная orchestrator и переключённая на cordis до первого сообщения, тоже без раздела"
    done: false
  - text: "`node scripts/pack-plugin.mjs --dir plugins/tool-families` и `--dir plugins/orchestrator` выполнены; `make verify` — exit 0, включая tarball:matches-source и check-documentation"
    done: false
  - text: "Отчёт: файлы, команды с выводом и кодами возврата, хеши тарболов, что не проверено"
    done: false
boardId: task-mwko0l2j-gqluze
nonScope: ["§8.3 (ревизия карты дизайна), §8.5, §8.6, §8.7 — отдельные задачи P0.4, P0.2, P0.1, P0.5", "экосистема состояния v1 (state/, ccProjectState, state-feed) — не начинать", "живой сервер http://127.0.0.1:3080 не трогать; доказательство — только второй сервер", "не менять docs/analysis/kit-integrity-p0.json — запись анализа принадлежит оркестратору", "не менять CHILD_POLICY и не сокращать ROOT_POLICY ради экономии — только точечная замена утверждений о наборе инструментов", "не добавлять новых инструментов и не выдавать тулзы динамически"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["node scripts/tool-families-proof.mjs → 68/68, exit 0; старые байты 0.1.8 → 62/68, exit 1", "node scripts/orchestrator-policy-proof.mjs → 19/19, exit 0; старые байты 0.1.48 → 7/19, exit 1", "make verify → exit 0 (17/17 + documentation ok)", "grep «you have no `bash` at all» по plugins/ profile/ scripts/ → пусто; profile/cordis.patch.yml:296 deny содержит mcp__playwright__*", "второй сервер :3081: orchestrator-корень 67 инструментов / 0 playwright со строкой о снятии; переключённый на cordis — 109 / 24, раздела нет (reports/p03-policy/sessions/)", "живой :3080 не тронут: pid 3160705"]
resultSummary: "§8.2 и §8.4 закрыты. Политика оркестратора применяется только к своему пресету (гейт на сборке промпта, пустой раздел не попадает в системное сообщение) и утверждает о наборе инструментов только то, что владелец политики реально снял: tool-families 0.1.10 публикует сервис `toolFamilies` (`presetFor`, `factsFor`; `decide()` возвращает `matched` — шаблоны, действительно снявшие инструменты), оркестратор 0.1.52 цитирует только `factsFor.removed`, при отсутствии сервиса не утверждает ничего, текст заморожен на сессию. Литерал «you have no bash at all» удалён, `mcp__playwright__*` снят с orchestrator в профиле. Тарболы: tool-families 0.1.10 sha256 1fe88437…, orchestrator 0.1.52 sha256 df32ba09…. Не воспроизведён только случай «сессия создана сразу с cordis»: в сборке нет поверхности, задающей пресет создания; более трудный путь (переключение до первого сообщения) доказан на втором сервере."
role: BACKEND
scope: ["plugins/tool-families/tool-families.mjs и его README/package.json — отдать факты политики потребителю как cordis-сервис (additive, опциональный)", "plugins/orchestrator/orchestrator.mjs и его README/package.json — гейт раздела по пресету и вывод утверждения о возможностях из фактического набора", "profile/cordis.patch.yml — orchestrator.deny += 'mcp__playwright__*'; комментарий привести в соответствие", "scripts/tool-families-proof.mjs — ожидание «playwright removed for orchestrator»", "новый proof-скрипт для политики оркестратора (scripts/)", "перепаковка двух плагинов через scripts/pack-plugin.mjs", "документы, на которые падает check-documentation"]
---

Закрыть §8.2 и §8.4 обзора харнесса: (1) политика оркестратора не должна применяться к корню, чей пресет она не описывает, и не должна утверждать возможностей, которых у сессии нет; (2) пресет orchestrator не должен получать семейство mcp__playwright__*. Сейчас ROOT_POLICY регистрируется для любой корневой сессии, содержит литерал «you have no bash at all» (ложь на корне Creator, где bash есть: 109 инструментов в заголовке), а строка orchestrator в профиле снимает только mcp__godot__*, bash и pwsh. Решения зафиксированы в записи анализа docs/analysis/kit-integrity-p0.json (D1: раздел по пресету, не по «любому корню»; D2: утверждение о возможностях собирается из фактического набора инструментов сессии при первой сборке промпта и замораживается на сессию). Факты о политике принадлежат tool-families — оркестратор не должен заводить их второй источник.

Migrated from .dsh/taskboard.json (task task-mwko0l2j-gqluze, revision 14).
