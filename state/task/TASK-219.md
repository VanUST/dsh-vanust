---
id: TASK-219
kind: task
title: "V1.10: доказательства red→green как условие закрытия REQ (FR11)"
status: done
revision: 1
createdAt: 2026-11-17T15:52:42.514Z
updatedAt: 2026-11-17T15:52:42.514Z
boardId: task-mwkukron-438ifl
ownerRole: BACKEND
---

Замкнуть доказательства на реестр (FR11): кейс без `reqId` и `authorRole` не создаётся (`test_req_required`); каждый TEST зеркалируется в ядро с reqId, ролью автора, замороженным хешем и ссылками на прогоны; и главное — REQ не может перейти в `done` без хотя бы одного TEST с пройденной парой red→green (`evidence_required`). Раннер уже умеет исполнять сохранённую команду, писать evidence-манифест и отвергать тавтологичный тест через red-прогон с negative control — переиспользуй это, не переизобретай. Докажи red-first: без гейта REQ закрывается, с гейтом — отказ.

Migrated from .dsh/taskboard.json (task task-mwkukron-438ifl, revision 7).
