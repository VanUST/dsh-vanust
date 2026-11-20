---
id: TASK-258
kind: task
title: "Карта установки и переносимости Linux/Windows"
status: done
revision: 4
createdAt: 2026-11-20T11:28:46.556Z
updatedAt: 2026-11-20T11:37:14.108Z
acceptance:
  - text: "Каждое утверждение о поведении подкреплено file:line; где строки нет — прямо сказано «документировано, не проверено»"
    done: false
  - text: "Есть таблица «шаг установки | Linux | Windows | чем доказано / что не доказано»"
    done: false
  - text: "Названы 5 главных рисков переносимости и установки, проранжированных, у каждого — что сделать"
    done: false
  - text: "Отчёт на русском, ≤ 500 строк, без выдуманных терминов"
    done: false
boardId: task-mwowbnya-rz5wf3
chore: true
choreReason: "Часть read-only архитектурного ревью: карта пути установки, правок не вносит."
nonScope: ["Не редактировать ни один файл и не запускать команды/сборку/установку", "Не оценивать качество моделей, промптов и политик ролей — это другая часть ревью", "Не перезапускать профиль :3080 и не трогать $DSH_HOME запущенной копии"]
owner:
  kind: agent
  label: CONTEXT
  sessionId: 843fdfed-7935-4a0f-a049-ab33dc1d7f72
preset: gatherer
resultEvidence: ["docs/review/HARNESS-ARCHITECTURE-REVIEW-2026-11-20.md §5", "install.sh:29-108, install.ps1:24-140, scripts/kit-update.mjs:533-545,567-573"]
resultSummary: "Карта установки и переносимости Linux/Windows с цитатами file:line: 7 шагов install.sh против 6 у install.ps1, отсутствие Windows-обёртки и сторожа живого сервера, отсутствие откатa, -Force затирание cordis.patch.yml, непроверенный Windows-провижининг, скрытые требования к машине. Отчёт лёг в §5 итогового ревью."
role: CONTEXT
scope: ["README.md, USERGUIDE.md, rules/DEPLOYMENT.md (§1–4)", "install.sh, install.ps1, Makefile", "scripts/kit-update.mjs, scripts/pack-plugin.mjs, scripts/provision-tools.mjs, scripts/provision-godot.mjs, scripts/lib/installer-steps.mjs", "scripts/check-portability.mjs, scripts/check-documentation.mjs", "profile/ (cordis.patch.yml и соседние файлы), plugins/inventory.json", "docs/HARNESS-OVERVIEW.md §2 (слои профиля) — только если нужен контекст"]
sessions:
  - sessionId: 843fdfed-7935-4a0f-a049-ab33dc1d7f72
    label: CONTEXT
    role: CONTEXT
    status: sleeping
---

Составить цитируемый отчёт о том, как dsh-kit устанавливается, запускается, обновляется и откатывается на чистой машине Linux и на Windows, и назвать каждый шаг, который работает только в POSIX, не проверен на Windows или опирается на неявное требование к машине. Ревью, не правки: ничего не менять и не запускать.
