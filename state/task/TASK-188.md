---
id: TASK-188
kind: task
title: "Удалить babysitter из кита"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.782Z
updatedAt: 2026-11-17T15:52:41.782Z
acceptance:
  - text: "plugins/babysitter/ и plugins/cc-dsh-babysitter-*.tgz отсутствуют; scripts/babysitter-selftest.mjs удалён"
    done: false
  - text: "plugins/inventory.json без babysitter (23); README.md и USERGUIDE.md — 23 плагина; NOTICE без @a5c-ai/babysitter"
    done: false
  - text: "grep -rni babysitter по supply-файлам не даёт ссылок; profile/cordis.patch.yml и rules/DEPLOYMENT.md не трогать — их закроет оркестратор после BACKEND"
    done: false
  - text: "docs/PLUGIN-PROOFS.md — 23 строки; docs/HARNESS-OVERVIEW.md без строки babysitter/§8.1"
    done: false
  - text: "check-documentation и check-portability (после удаления профильного ряда) зелёные; provision-tools --check без babysitter"
    done: false
boardId: task-mwkmqjy0-1jgv1w
nonScope: ["живой :3080 и :3081 — не трогать", "profile/cordis.patch.yml — ряд babysitter удалит оркестратор после BACKEND, чтобы не потерять его правки docs/critic", "rules/DEPLOYMENT.md — секцию babysitter удалит оркестратор после BACKEND по той же причине", "docs/PTC-MODE-ANALYSIS.md — отдельная задача BACKEND"]
owner:
  kind: agent
  label: DOCS
  sessionId: 151d8d73-fe98-48fc-82a6-91585d009f01
ownerRole: DOCS
preset: docs
resultEvidence: ["git rm: plugins/babysitter/, cc-dsh-babysitter-0.1.6/0.1.7.tgz, scripts/babysitter-selftest.mjs, 5 .babysitter tracked", "inventory 23, tarballs 23; README/USERGUIDE 23; NOTICE/install/start/kit-update/provision/.gitignore without babysitter", "profile row and DEPLOYMENT section removed by orchestrator; orchestrator 0.1.48", "docs/HARNESS-OVERVIEW and docs/PLUGIN-PROOFS 23; designmap 0.1.17 = source", "check-documentation ok 23; check-portability 17/17; provision-tools 19/19; make verify 0"]
resultSummary: "Плагин babysitter удалён целиком: исходники, оба tarball, selftest и 5 отслеживаемых файлов .babysitter сняты; inventory 23, tarballs 23; проводка убрана из provisioning, kit-update, README/USERGUIDE/NOTICE, install-комментариев; docs/HARNESS-OVERVIEW и PLUGIN-PROOFS на 23 плагина; designmap 0.1.17; все гейты зелёные."
role: DOCS
scope: [scripts/babysitter-selftest.mjs, docs/PLUGIN-PROOFS.md, "docs/HARNESS-OVERVIEW.md — версии designmap и пометка portability-находки", "reports/plugin-audit/FINDINGS.md — читать как источник"]
sessions:
  - sessionId: 151d8d73-fe98-48fc-82a6-91585d009f01
    label: DOCS
    role: DOCS
    status: sleeping
---

Убрать плагин babysitter из кита целиком, по навыку remove-a-tool-from-dsh-kit: исходники, tarballs 0.1.6/0.1.7, selftest, строка инвентаря, provisioning, start/install/kit-update, README/USERGUIDE/NOTICE, docs/HARNESS-OVERVIEW, docs/PLUGIN-PROOFS; счётчики 24→23; профильный ряд и секцию DEPLOYMENT оставить оркестратору.

Migrated from .dsh/taskboard.json (task task-mwkmqjy0-1jgv1w, revision 12).
