---
id: TASK-444
kind: task
title: "Удалить лишний документ и назвать настоящий источник плейбуков"
status: done
revision: 5
createdAt: 2026-11-28T13:18:41.222Z
updatedAt: 2026-11-28T13:21:06.396Z
boardId: task-mx0fru84-4fc64x
chore: true
choreReason: "Восстановленный файл оказался лишним документом: его содержание перенесено в архитектуру, а проверки его не читают; шапка проверки плейбуков ссылается на него как на источник, что неверно."
nonScope: ["Не менять поведение проверки плейбуков: только снять устаревшие утверждения о файле. Не трогать docs/ARCHITECTURE.md, GUIDE.md, TERMINOLOGY.md."]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["docs/PRESET-PLAYBOOKS.md удалён (Test-Path False); git status: D docs/PRESET-PLAYBOOKS.md, M scripts/check-prompt-playbooks.mjs, M scripts/audit-preset-composition.mjs.", "git diff по скриптам — только комментарии; node --check на оба exit 0; check-prompt-playbooks 15× PASS exit 0.", "В корне docs/ ровно три markdown-файла.", "make verify красный по независимой причине — state_version и document_date_missing в трёх документах; контроль на копии docs/ даёт те же пять отказов."]
resultSummary: "Лишний документ удалён, ложные утверждения о нём в шапке проверки плейбуков и в аудите заменены настоящим источником — профилем и CHILD_POLICY. Правка только в комментариях; docs/ содержит три markdown-файла."
role: BACKEND
scope: [docs/PRESET-PLAYBOOKS.md, scripts/check-prompt-playbooks.mjs, scripts/audit-preset-composition.mjs]
---

Убери лишний документ и исправь устаревшие утверждения о нём. Замер: docs/PRESET-PLAYBOOKS.md никем не читается — scripts/check-prompt-playbooks.mjs берёт данные из profile/cordis.patch.yml и plugins/orchestrator/orchestrator.mjs, а в шапке скрипта (строки 10 и 27) написано, что файл — единственная копия текста блоков. Содержание файла уже перенесено в §7 docs/ARCHITECTURE.md. Нужно: удалить docs/PRESET-PLAYBOOKS.md, исправить шапку check-prompt-playbooks.mjs и комментарий в audit-preset-composition.mjs так, чтобы они называли настоящий источник, и проверить, что после удаления docs/ содержит ровно три markdown-файла, а make verify зелёный.
