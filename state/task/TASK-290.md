---
id: TASK-290
kind: task
title: "P1 fix 2: атака на W1 head/test и B1 junction"
status: done
revision: 4
createdAt: 2026-11-22T12:06:34.140Z
updatedAt: 2026-11-22T12:08:33.313Z
acceptance:
  - text: "Найден воспроизводимый обход или каждый проверенный путь отказан"
    done: false
  - text: "Для обхода: команда/фикстура, вывод, exit code"
    done: false
  - text: "P0/независимый контроль не сломаны"
    done: false
  - text: "Известные границы не выданы за новые"
    done: false
boardId: task-mwrsjxyw-urz7wc
nonScope: ["не править общий C:/dsh-kit", "не трогать живой профиль/:3080", "не исправлять найденное", "не менять docs/cases"]
owner:
  kind: agent
  label: CRITIC
  sessionId: 98b93a31-1d16-4c50-abda-ecedb6d2b32a
preset: critic
reqIds: [REQ-189, REQ-190, REQ-191, REQ-194]
resultEvidence: ["B1 DENY: junction на src, junction + newdir, junction наружу, docs/../../src; control tests/ allowed; product unchanged", "W1 REFUSED: same-head copy, modified test, product missing, test-only surface, non-git tree, cwd inside via junction; real previous commit accepted", "W1 BYPASS S4: fake git outside, correct product, same test bytes, marker -> red ok, green verified, gate true, task CLOSED", "P0 proof 29/29, targeted 34/34, proof-guard 6/6; independent control S2 passes", "B1'/junction residual closed; B2/B3/shell named"]
resultSummary: "Финальная атака fix 2: B1 junction/nearest ancestor закрыт; W1 механические проверки работают (same-head, test mismatch, product missing, test-only surface, cwd inside через junction), но W1 остаётся обходимым синтетическим красным: фальшивый git снаружи, правильный продукт, те же байты теста и маркер, из-за которого драйвер падает. Это подделка доказательства (B1), а не новый path-обход; гейт проверяет согласованность, не причину падения. Нужны D1/D2/D3 из ревью и человеческая оценка realism в пилоте; новый гейт не добавлять."
role: CRITIC
scope: ["одноразовая копия /tmp или scratch checkout", "plugins/proof-guard/**, plugins/test-cases/**, scripts/independent-verification-proof.mjs (чтение/копия)", "git temp trees, case_run red, CLI"]
sessions:
  - sessionId: 98b93a31-1d16-4c50-abda-ecedb6d2b32a
    label: CRITIC
    role: CRITIC
    status: sleeping
---

Атаковать P1 fix 2. Найди способ всё ещё записать продукт через junction/nearest ancestor или получить wrong-product red без реального прошлого продукта. Проверь same-head clone с продуктом, fake git, подмену драйвера при совпадающих байтах теста, product surface пустой/тест-онли, head null/равен green, cwd внутри через junction, testHash на red дерево. Работай на одноразовой копии; не чини. Известные границы B2/B3/shell/B1' не переоткрывай.
