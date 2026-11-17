---
id: TEST-044
kind: test
title: "Specialists read files with tools not shell"
status: unverified
revision: 1
createdAt: 2026-11-17T15:52:44.514Z
updatedAt: 2026-11-17T15:52:44.514Z
authorRole: orchestrator
caseId: specialists-read-files-with-tools-not-shell
evidenceRefs: []
frozenHash: 4c93c80719f5de56e031d83b51bfab9e94250321b12f08a2e72a12048d758b49
---

Владелец потребовал, чтобы специалисты экономили контекст на входе: читали файлы инструментом read с диапазоном строк и искали grep/glob, а не переливали содержимое файлов через sed/cat/ls в shell. Измерение 2026-11-17: 75,3% байт выдачи shell приходит из команд вне фильтров, sed один даёт 3,84 МБ из 15,4 МБ.
