---
id: TASK-443
kind: task
title: "Вернуть удалённый вход сборки и доказать зелёный прогон"
status: done
revision: 5
createdAt: 2026-11-28T13:16:11.135Z
updatedAt: 2026-11-28T13:18:49.110Z
boardId: task-mx0fom4t-j85iej
chore: true
choreReason: "Исполнитель документации удалил файл, который читает проверка плейбуков; нужно вернуть его из истории и доказать, что сборка снова зелёная."
nonScope: ["Не переносить файл в другой каталог и не править скрипты: сначала вернуть как было и доказать зелёный прогон. Не трогать docs/ARCHITECTURE.md и другие документы."]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["До восстановления: check-prompt-playbooks exit 0 и make verify exit 0 — файла не было, проверки зелёные.", "git checkout 88e42df -- docs/PRESET-PLAYBOOKS.md: sha256 b5c543e2…, 16083 байта, побайтно равен blob коммита.", "После восстановления: check-prompt-playbooks 15× PASS exit 0; make verify exit 0.", "check-prompt-playbooks.mjs читает profile/cordis.patch.yml и orchestrator.mjs, а не этот файл; check-documentation.mjs:86 считает его входом сборки."]
resultSummary: "Файл возвращён из истории и побайтно совпадает с коммитом; обе проверки зелёные. Посылка задачи неверна: проверка плейбуков этот файл не читает, красного прогона не было."
role: BACKEND
scope: [docs/PRESET-PLAYBOOKS.md]
---

Верни docs/PRESET-PLAYBOOKS.md из истории git: он был удалён вместе с остальными документами, хотя scripts/check-prompt-playbooks.mjs читает его как единственный источник текста плейбуков, и без него проверка сборки красная. Восстанови файл в том же месте (git checkout 88e42df -- docs/PRESET-PLAYBOOKS.md или эквивалент), затем докажи, что дерево снова целое: node scripts/check-prompt-playbooks.mjs и make verify — зелёные, и что файл побайтно совпадает с версией из коммита 88e42df (sha256). Ничего больше не меняй.
