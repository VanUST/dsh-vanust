---
id: TASK-463
kind: task
title: "Версия харнесса из одного источника"
status: done
revision: 5
createdAt: 2026-11-28T14:18:15.749Z
updatedAt: 2026-11-28T14:27:51.369Z
boardId: task-mx0hwg4p-eeut1k
chore: true
choreReason: "Версия харнесса записана в пяти местах и её пришлось править одновременно, иначе kit-update планировал откат; правило должно жить в одном месте."
nonScope: ["Не менять сам пин и не менять проверяемые документы по существу; только источник значения и чтение его потребителями."]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["check-documentation --pin-only: exit 0, 7 заявок PASS — install.ps1 объявляет пин 0.2.2-rc.5, install.sh выводит его из install.ps1, kit-update.mjs читает объявление, документы (README, GUIDE, DEPLOYMENT) сверяются с ним.", "Правка только install.ps1 на копии дерева (rc.9): проверка отказывает, 4 строки документов расходятся, exit 1; install.sh без правок передаёт npm новый пин.", "Тесты проверки документации 14/14; node scripts/test-all.mjs 89/89 passed, exit 0.", "install.sh без объявления в install.ps1 останавливается, а не ставит что даст npm."]
resultSummary: "Версия харнесса объявлена в одном месте — строка $DSH_VERSION в install.ps1; install.sh выводит её и останавливается без объявления, проверка документации сверяет с ней README, GUIDE и правила. Правка одного файла расходится с документами и ловится, тесты и гейт зелёные."
role: BACKEND
scope: [scripts/kit-pin.json, install.ps1, install.sh, scripts/check-documentation.mjs, scripts/test/check-documentation.test.mjs]
---

Сведи версию харнесса к одному источнику. Сейчас пин записан в install.ps1, install.sh, README.md, docs/GUIDE.md и rules/DEPLOYMENT.md; при обновлении пришлось править все пять, иначе kit-update планировал откат. Сделай: (1) один файл-источник (например scripts/kit-pin.json или значение в существующем конфиге — выбери существующее, не добавляй новое без нужды); (2) установщики читают его; проверка документации читает его и сверяет с текстом документов; (3) докажи: правка одного файла меняет то, что видит установщик и проверка, без правки остальных; при несовпадении документа с источником проверка отказывает; (4) гейты документации и verify зелёные на текущем значении.
