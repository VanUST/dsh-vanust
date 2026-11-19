---
id: TASK-238
kind: task
title: "Починить гейт delegation_brief: REQ, который реестр реально может иметь"
status: done
revision: 5
createdAt: 2026-11-18T14:47:03.684Z
updatedAt: 2026-11-18T14:58:41.852Z
acceptance:
  - text: "delegation_brief accepts proposed/open/accepted REQs and refuses done/rejected/dropped with a named reason; the message no longer tells the caller to accept something no tool can accept"
    done: false
  - text: "brief.test.mjs покрывает оба случая: proposed рендерится, done/rejected отказывают feature_required; node --test plugins/delegation-brief/test/*.test.mjs — exit 0"
    done: false
  - text: "Тарбол 0.1.5 собран и установлен; make verify exit 0"
    done: false
boardId: task-mwm8iziu-w41c5o
inline: true
reqId: REQ-083
reqIds: [REQ-083]
resultEvidence: ["node --test plugins/delegation-brief/test/brief.test.mjs -> 7 pass, 0 fail; the planned REQ renders, done/rejected refuse feature_required", "make verify -> exit 0, 17/17 portability and packaging checks", "plugins/cc-dsh-delegation-brief-0.1.5.tgz installed in ~/.npm/dsh/profiles/web -> dsh-delegation-brief 0.1.5"]
resultSummary: "Гейт delegation_brief теперь принимает proposed/open/accepted — статусы, которые реестр реально может иметь (analysis_upsert зеркалит planned в proposed), и отказывает done/rejected/dropped с названной причиной. Тест обновлён: planned REQ рендерится, done/rejected отказывают. Тарбол 0.1.5 собран и установлен в профиль."
steps: ["Смягчить гейт: принимать proposed/open/accepted, отказывать done/rejected/dropped", "Обновить тест под реальные статусы реестра", "Пересобрать тарбол и установить, make verify"]
stepsDone: 3
---

delegation_brief отказывает feature_required для любого REQ, который не accepted, но статус accepted не выставляет ни один инструмент: analysis_upsert зеркалит planned в proposed, proven в done, deferred/rejected в rejected. В итоге бриф не рендерится ни для одного REQ, который реально есть в реестре. Принимать proposed/open/accepted, отказывать done/rejected/dropped с названной причиной; обновить тест и сообщение; тарбол 0.1.5.
