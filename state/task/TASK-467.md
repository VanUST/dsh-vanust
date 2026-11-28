---
id: TASK-467
kind: task
title: "Привязать решение к требованию и закоммитить изменение профиля"
status: done
revision: 5
createdAt: 2026-11-28T14:46:02.185Z
updatedAt: 2026-11-28T14:58:36.076Z
boardId: task-mx0iw6b7-4no8i7
chore: true
choreReason: "Правка профиля и решение DEC-004 не в коммите, а решение не видно в плане, потому что не связано с требованием."
nonScope: ["Не перезапускать сервер и не запускать apply.", "Не менять значение резерва и другие настройки."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["DEC-004 связан с REQ-300 через ядро (revision 2, link hash ee7f9e46…, event 3432), виды перегенерированы.", "Коммит 0226810: 12 файлов — profile/cordis.patch.yml с headroomTokens 32768, state/decision/DEC-004.md, state/plan.yaml, views, events.", "make verify → exit 0: 20/20 portability, boundaries gate ok, documentation ok (пин rc.5), preset-configs 0 refused, identity-guard patched.", "Сервер не перезапускался, apply не запускался."]
resultSummary: "Решение DEC-004 привязано через ядро и закоммичено вместе с профилем (0226810), make verify зелёный. Обнаружено: при переполнении бюджета план отбрасывает свежее решение, а основание ссылается на отклонённое требование — оба дефекта вынесены в отдельную задачу."
role: DEVOPS
scope: [state/, profile/cordis.patch.yml]
---

Свяжи решение DEC-004 с требованием и закоммить батч. Сделай: (1) через ядро состояния привяжи DEC-004 к REQ-300 (замер повторного использования префикса, где лежит основание изменения) и перегенерируй виды — решение должно появиться в state/plan.yaml в пределах бюджета 4096 B; (2) git add профиля, решения, видов и журнала; коммит с описанием изменения и его основания; (3) прогони make verify и приложи код возврата; (4) назови, что осталось за владельцем. Сервер не останавливай, apply не запускай.
