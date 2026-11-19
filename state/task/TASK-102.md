---
id: TASK-102
kind: task
title: "P1: компакция 0.5/0.08 в профиле web"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.285Z
updatedAt: 2026-11-17T15:52:40.285Z
boardId: task-mwdl0z8a-yvnkpo
inline: true
nonScope: ["plugins/orchestrator/* — там незакоммиченные чужие правки", "не перезапускать сервер GUI без отдельного согласования", "не менять другие ряды профиля"]
resultEvidence: ["grep -c 'thresholdRatio: 0.5' → 7; grep -c 'retainRatio: 0.08' → 7", "python3 yaml.safe_load после снятия !!js тегов: 'YAML parsed OK, top-level entries: 26'", "Расчёт вступающих в силу чисел: threshold = floor(min(1e6×0.5, 1e6−256000−65536)) = 500 000; retain = floor((1e6−256000)×0.08) = 59 555"]
resultSummary: "P1 применён: во всех 7 группах compaction-basic профиля web добавлено config thresholdRatio 0.5 / retainRatio 0.08. Синтаксис проверен структурным разбором YAML, число правок сверено (7/7). Эффективные значения после перезапуска: порог 500 000 вместо 678 464, удержание 59 555 вместо 119 111. Живой процесс ещё работает на старом пороге — нужен рестарт сервера, который не делался."
scope: ["$DSH_HOME/profiles/web/cordis.patch.yml — строки compaction-basic (7 групп)"]
---

Применить P1 из согласованного дизайна: в профиле web задать compaction-basic thresholdRatio 0.5 и retainRatio 0.08 для всех групп компакции, чтобы порог срабатывал на ~500K с удержанием ~60K вместо 678K/119K.

Migrated from .dsh/taskboard.json (task task-mwdl0z8a-yvnkpo, revision 4).
